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

  get(look: Look, diameterPx: number, square = false): HTMLCanvasElement {
    if (this.seenVersion !== version) {
      this.cache.clear();
      this.seenVersion = version;
    }
    const size = bucket(diameterPx);
    const key = `${size}|${square ? 's' : 'c'}|${JSON.stringify(look)}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const ready = drawLook(g, look, size, this.assets(), square);
    if (ready) this.cache.set(key, c);
    return c;
  }
}

/** Draws a look into a size x size circle. Returns false if an image is still loading. */
export function drawLook(g: CanvasRenderingContext2D, look: Look, size: number, assets: Record<string, string>, square = false): boolean {
  const r = size / 2;
  g.save();
  g.beginPath();
  if (square) roundRectPath(g, 0, 0, size, size, size * 0.16);
  else g.arc(r, r, r, 0, Math.PI * 2);
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
    case 'imp':
      drawImp(g, size);
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
  // Soft top light so every ball reads as a solid object.
  if (look.t !== 'imp') {
    const shine = g.createRadialGradient(r * 0.7, r * 0.55, 0, r * 0.7, r * 0.55, r * 1.2);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    shine.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = shine;
    g.fillRect(0, 0, size, size);
  }
  g.restore();
  g.beginPath();
  if (square) roundRectPath(g, 0.5, 0.5, size - 1, size - 1, size * 0.16);
  else g.arc(r, r, r - 0.5, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  g.stroke();
  return ready;
}

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
}

/** The boss: a grinning purple imp with horns, drawn flat with soft shading. */
function drawImp(g: CanvasRenderingContext2D, size: number): void {
  const s = size, r = s / 2;
  const face = g.createRadialGradient(r * 0.8, r * 0.7, r * 0.1, r, r, r);
  face.addColorStop(0, '#C084FC');
  face.addColorStop(0.7, '#9333EA');
  face.addColorStop(1, '#6B21A8');
  g.fillStyle = face;
  g.fillRect(0, 0, s, s);
  // Horns live outside the clip in the renderer; here a hint of brow shadow.
  g.fillStyle = 'rgba(40,0,70,0.35)';
  g.beginPath();
  g.ellipse(r, r * 0.62, r * 0.7, r * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  // Eyes
  for (const sx of [-1, 1]) {
    const ex = r + sx * r * 0.34, ey = r * 0.8;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(ex, ey, r * 0.17, r * 0.13, sx * -0.35, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1F0A33';
    g.beginPath();
    g.arc(ex + sx * r * 0.03, ey + r * 0.02, r * 0.075, 0, Math.PI * 2);
    g.fill();
    // Angry brows
    g.strokeStyle = '#3B0764';
    g.lineWidth = r * 0.08;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - sx * r * 0.2, ey - r * 0.24);
    g.lineTo(ex + sx * r * 0.14, ey - r * 0.12);
    g.stroke();
  }
  // Grin
  g.fillStyle = '#2E1065';
  g.beginPath();
  g.moveTo(r - r * 0.5, r * 1.18);
  g.quadraticCurveTo(r, r * 1.75, r + r * 0.5, r * 1.18);
  g.quadraticCurveTo(r, r * 1.38, r - r * 0.5, r * 1.18);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.moveTo(r - r * 0.4, r * 1.24);
  g.quadraticCurveTo(r, r * 1.42, r + r * 0.4, r * 1.24);
  g.lineTo(r + r * 0.36, r * 1.3);
  g.quadraticCurveTo(r, r * 1.5, r - r * 0.36, r * 1.3);
  g.closePath();
  g.fill();
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
