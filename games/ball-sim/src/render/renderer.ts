import type { Sim } from '../sim/sim';
import { SpriteCache, colorOfLook } from './sprites';

export interface DrawOptions {
  /** Draw clock, counters and outcome label. */
  hud?: boolean;
  /** Extra zoom factor on top of the fitted camera. */
  zoom?: number;
}

const GROUND = '#0A0B0D';
const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Geist", system-ui, -apple-system, Segoe UI, sans-serif';

/** Canvas 2D renderer for a Sim. Stateless except for caches. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private sprites: SpriteCache;
  private sim: Sim | null = null;
  private viewR = 300;
  private lookColors: string[] = [];
  private lookColorsFor: Sim | null = null;
  private tmp = { x: 0, y: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.sprites = new SpriteCache(() => this.sim?.assets ?? {});
  }

  /** Fit the camera to a sim. Call once per sim (not per frame, so destroyed walls don't rezoom). */
  fit(sim: Sim): void {
    this.sim = sim;
    const v = sim.def.settings.view;
    this.viewR = v > 0 ? v : sim.contentRadius() * 1.06 + 12;
  }

  /** Resize backing store to element size times DPR (capped). */
  resize(dprCap = 2): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  private colorOf(sim: Sim, i: number): string {
    if (this.lookColorsFor !== sim) { this.lookColors = []; this.lookColorsFor = sim; }
    const id = sim.look[i];
    let c = this.lookColors[id];
    if (!c) {
      c = colorOfLook(sim.looks[id], sim.assets);
      // Flags resolve their real color after load. Don't cache the fallback.
      if (sim.looks[id].t === 'solid' || sim.looks[id].t === 'gradient' || sim.looks[id].t === 'pattern') this.lookColors[id] = c;
    }
    return c;
  }

  draw(sim: Sim, opts: DrawOptions = {}): void {
    if (this.sim !== sim) this.fit(sim);
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const w = sim.world;
    const scale = (Math.min(W, H) / (2 * this.viewR)) * (opts.zoom ?? 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    g.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    const px = 1 / scale; // one device pixel in world units

    // Zones
    for (const z of sim.zones) {
      if (!z.alive || !z.visible) continue;
      g.fillStyle = hexA(z.color, 0.1);
      g.strokeStyle = hexA(z.color, 0.55);
      g.lineWidth = px * 1.2;
      g.setLineDash([px * 4, px * 4]);
      g.beginPath();
      if (z.shape === 'circle') g.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      else g.rect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      g.fill();
      g.stroke();
      g.setLineDash([]);
    }

    // Walls
    g.lineCap = 'round';
    for (let p = 0; p < w.pieceCount; p++) {
      if (!w.pAlive[p]) continue;
      const col = w.pCol[p];
      const b = p * 12;
      const D = w.pData;
      g.strokeStyle = sim.colColor[col] ?? '#4A515C';
      g.lineWidth = Math.max(w.pHt[p] * 2, px * 1.5);
      g.beginPath();
      const c = w.colCos[col], s = w.colSin[col], ox = w.colX[col], oy = w.colY[col];
      if (w.pKind[p] === 0) {
        g.moveTo(ox + c * D[b] - s * D[b + 1], oy + s * D[b] + c * D[b + 1]);
        g.lineTo(ox + c * D[b + 2] - s * D[b + 3], oy + s * D[b + 2] + c * D[b + 3]);
      } else {
        const cx = ox + c * D[b] - s * D[b + 1], cy = oy + s * D[b] + c * D[b + 1];
        const a0 = Math.atan2(D[b + 5], D[b + 4]) + w.colAngle[col];
        g.arc(cx, cy, D[b + 2], a0, a0 + D[b + 3]);
      }
      g.stroke();
    }

    // Tethers
    if (w.tetherAliveCount > 0) {
      g.lineWidth = px * 1.25;
      g.lineCap = 'butt';
      const P = this.tmp;
      for (let t = 0; t < w.tetherHigh; t++) {
        if (!w.tAlive[t]) continue;
        const i = w.tBody[t];
        w.tetherAnchor(t, P);
        g.strokeStyle = hexA(this.colorOf(sim, i), 0.6);
        g.beginPath();
        g.moveTo(w.x[i], w.y[i]);
        g.lineTo(P.x, P.y);
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.fillRect(P.x - px * 1.5, P.y - px * 1.5, px * 3, px * 3);
      }
    }

    // Balls
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i]) continue;
      const r = w.r[i];
      const look = sim.looks[sim.look[i]];
      const spr = this.sprites.get(look, r * 2 * scale);
      g.drawImage(spr, w.x[i] - r, w.y[i] - r, r * 2, r * 2);
      if (sim.maxHp[i] > 0) {
        const f = Math.max(0, Math.min(1, sim.hp[i] / sim.maxHp[i]));
        g.lineWidth = Math.max(px * 2, r * 0.14);
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.arc(w.x[i], w.y[i], r + g.lineWidth * 1.4, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = f > 0.35 ? '#E7E9EC' : '#FF5A1F';
        g.beginPath();
        g.arc(w.x[i], w.y[i], r + g.lineWidth * 1.4, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
        g.stroke();
      }
    }

    // Explosion rings
    if (sim.flash.length) {
      sim.flash = sim.flash.filter((f) => sim.time - f.t < 0.6);
      for (const f of sim.flash) {
        const k = (sim.time - f.t) / 0.6;
        g.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.5})`;
        g.lineWidth = px * 2;
        g.beginPath();
        g.arc(f.x, f.y, f.r * (0.3 + 0.7 * k), 0, Math.PI * 2);
        g.stroke();
      }
    }

    if (opts.hud) this.drawHud(sim, W, H);
  }

  private drawHud(sim: Sim, W: number, H: number): void {
    const g = this.ctx;
    const u = Math.min(W, H) / 100; // 1% of the short side
    g.setTransform(1, 0, 0, 1, 0, 0);
    const pad = Math.max(16, u * 3);
    const s = sim.def.settings;
    let y = pad;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    if (s.clock !== 'none') {
      const t = s.clock === 'down' ? Math.max(0, s.clockFrom - (sim.outcome?.time ?? sim.time)) : sim.outcome?.time ?? sim.time;
      g.font = `400 ${Math.max(20, u * 4.4)}px ${MONO}`;
      g.fillStyle = '#E7E9EC';
      g.fillText(formatClock(t), pad, y);
      y += Math.max(20, u * 4.4) * 1.35;
    }
    const fs = Math.max(12, u * 2.1);
    g.font = `400 ${fs}px ${MONO}`;
    for (const c of sim.counters.values()) {
      if (!c.show) continue;
      g.fillStyle = '#868D98';
      g.fillText(c.name.toUpperCase(), pad, y);
      const nameW = g.measureText(c.name.toUpperCase() + '  ').width;
      g.fillStyle = '#E7E9EC';
      g.fillText(formatNum(c.value), pad + nameW, y);
      y += fs * 1.5;
    }
    if (sim.outcome) {
      const a = Math.min(1, sim.sinceEnd / 0.5);
      const size = Math.max(18, u * 4);
      g.font = `500 ${size}px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const text = sim.outcome.label;
      const tw = g.measureText(text).width;
      const cx = W / 2, cy = H - pad * 2.2;
      g.fillStyle = `rgba(10,11,13,${0.72 * a})`;
      roundRect(g, cx - tw / 2 - size * 0.8, cy - size * 1.15, tw + size * 1.6, size * 1.65, size * 0.3);
      g.fill();
      g.fillStyle = `rgba(231,233,236,${a})`;
      g.fillText(text, cx, cy);
      g.fillStyle = `rgba(255,90,31,${a})`;
      g.fillRect(cx - size * 0.6, cy + size * 0.18, size * 1.2, Math.max(1, size * 0.06));
    }
  }
}

export function formatClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const hexCache = new Map<string, string>();
export function hexA(hex: string, a: number): string {
  const k = hex + a;
  let v = hexCache.get(k);
  if (v) return v;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  hexCache.set(k, v);
  return v;
}
