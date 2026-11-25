import type { Look } from '../sim/types';
import { lookColor } from '../sim/looks';

const BASE = (import.meta as any).env?.BASE_URL ?? '/';
const SIZES = [12, 16, 24, 32, 48, 64, 96, 128, 192, 256];

const images = new Map<string, HTMLImageElement>();
const imageReady = new Set<string>();
const imageColor = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

/** Called when a flag or uploaded image finishes loading, so caches can refresh. */
export function onImagesChanged(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function loadImage(key: string, src: string): HTMLImageElement {
  let img = images.get(key);
  if (img) return img;
  img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    imageReady.add(key);
    imageColor.set(key, averageColor(img!));
    version++;
    for (const f of listeners) f();
  };
  img.src = src;
  images.set(key, img);
  return img;
}

function averageColor(img: HTMLImageElement): string {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    // Weight saturated pixels more so flags don't average to brown.
    let r = 0, gg = 0, b = 0, wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 0.2 + (mx - mn) / 255;
      r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
    }
    const hex = (v: number) => Math.round(v / wsum).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(gg)}${hex(b)}`;
  } catch {
    return '#E7E9EC';
  }
}

export function flagUrl(code: string): string {
  return `${BASE}flags/${code}.svg`;
}

/** Color that represents a look (tethers, HP arcs). Uses the real image average once loaded. */
export function colorOfLook(l: Look, assets: Record<string, string>): string {
  if (l.t === 'flag') {
    const key = `flag:${l.code}`;
    loadImage(key, flagUrl(l.code));
    return imageColor.get(key) ?? lookColor(l);
  }
  if (l.t === 'image') {
    const key = `img:${l.asset}`;
    if (assets[l.asset]) loadImage(key, assets[l.asset]);
    return imageColor.get(key) ?? '#E7E9EC';
  }
  return lookColor(l);
}

function bucket(px: number): number {
  for (const s of SIZES) if (s >= px) return s;
  return SIZES[SIZES.length - 1];
}

/**
 * Pre-drawn circular sprites per look and size bucket. Drawing thousands of
 * balls becomes one drawImage each.
 */
export class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private seenVersion = version;

  constructor(private assets: () => Record<string, string>) {}

  get(look: Look, diameterPx: number): HTMLCanvasElement {
    if (this.seenVersion !== version) {
      this.cache.clear();
      this.seenVersion = version;
    }
    const size = bucket(diameterPx);
    const key = `${size}|${JSON.stringify(look)}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const ready = drawLook(g, look, size, this.assets());
    if (ready) this.cache.set(key, c);
    return c;
  }
}

/** Draws a look into a size x size circle. Returns false if an image is still loading. */
export function drawLook(g: CanvasRenderingContext2D, look: Look, size: number, assets: Record<string, string>): boolean {
  const r = size / 2;
  g.save();
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  let ready = true;
  switch (look.t) {
    case 'solid':
      g.fillStyle = look.c;
      g.fillRect(0, 0, size, size);
      break;
    case 'gradient': {
      let grad: CanvasGradient;
      if (look.kind === 'radial') grad = g.createRadialGradient(r * 0.7, r * 0.7, 0, r, r, r);
      else {
        const a = (look.angle * Math.PI) / 180;
        const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
        grad = g.createLinearGradient(r - dx, r - dy, r + dx, r + dy);
      }
      const cs = look.c.length ? look.c : ['#fff'];
      cs.forEach((c, i) => grad.addColorStop(cs.length === 1 ? 0 : i / (cs.length - 1), c));
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      break;
    }
    case 'pattern':
      drawPattern(g, look.p, look.c, look.scale, look.angle, size);
      break;
    case 'flag':
    case 'image': {
      const key = look.t === 'flag' ? `flag:${look.code}` : `img:${look.asset}`;
      const src = look.t === 'flag' ? flagUrl(look.code) : assets[look.asset];
      if (src) loadImage(key, src);
      const img = images.get(key);
      if (img && imageReady.has(key)) {
        // Cover-fit the image in the circle.
        const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      } else {
        g.fillStyle = '#2A2F37';
        g.fillRect(0, 0, size, size);
        ready = !src;
      }
      break;
    }
  }
  g.restore();
  // Hairline rim so light looks still read against each other.
  g.beginPath();
  g.arc(r, r, r - 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  g.stroke();
  return ready;
}

function drawPattern(g: CanvasRenderingContext2D, p: string, c: [string, string], scale: number, angle: number, size: number) {
  const r = size / 2;
  g.fillStyle = c[0];
  g.fillRect(0, 0, size, size);
  g.fillStyle = c[1];
  const n = Math.max(1, Math.round(scale)) + 1;
  g.save();
  g.translate(r, r);
  g.rotate((angle * Math.PI) / 180);
  switch (p) {
    case 'stripes': {
      const w = size / (n * 2);
      for (let x = -size; x < size; x += w * 2) g.fillRect(x, -size, w, size * 2);
      break;
    }
    case 'dots': {
      const step = size / (n + 0.5);
      for (let y = -size; y < size; y += step)
        for (let x = -size; x < size; x += step) {
          g.beginPath();
          g.arc(x + ((Math.round(y / step) & 1) ? step / 2 : 0), y, step * 0.22, 0, Math.PI * 2);
          g.fill();
        }
      break;
    }
    case 'checker': {
      const s = size / (n + 1);
      for (let y = -size, row = 0; y < size; y += s, row++)
        for (let x = -size, col = 0; x < size; x += s, col++) if ((row + col) & 1) g.fillRect(x, y, s, s);
      break;
    }
    case 'split':
      g.fillRect(0, -size, size, size * 2);
      break;
    case 'rings': {
      const step = r / (n + 0.5);
      for (let k = n; k >= 0; k--) {
        g.beginPath();
        g.arc(0, 0, step * (k + 0.5), 0, Math.PI * 2);
        g.fillStyle = k % 2 ? c[1] : c[0];
        g.fill();
      }
      break;
    }
    case 'quarters':
      g.fillRect(0, -size, size, size);
      g.fillRect(-size, 0, size, size);
      break;
  }
  g.restore();
}
