import type { Sim } from '../sim/sim';
import type { Fx } from '../sim/types';
import { WEAPON_TYPES, POWERUP_COLOR, WEAPON_INFO, SPECIAL_CHARGE } from '../sim/arena';
import { SpriteCache, colorOfLook } from './sprites';
import { titaniumBlock, steelRod, drawWeapon, drawPowerup, flame, titaniumFill, shade } from './art';

export interface DrawOptions {
  hud?: boolean;
  /** Push the HUD down by this many CSS pixels (room for page chrome). */
  hudTop?: number;
  /** Lighter effects for small previews. */
  lite?: boolean;
}

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Geist", system-ui, -apple-system, Segoe UI, sans-serif';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number }
interface Light { x: number; y: number; r: number; a: number; color: string; t: number; life: number }
interface Ring { x: number; y: number; r0: number; r1: number; t: number; life: number; color: string; width: number }
interface Floater { x: number; y: number; text: string; t: number; color: string; big?: boolean }
const SPECIAL_COLOR: Record<string, string> = { sword: '#E2E8F0', spear: '#FDE68A', hammer: '#FB923C', match: '#F97316', rod: '#67E8F9', shield: '#38E1F5' };

let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}

/** Canvas 2D renderer for a Sim, with its own camera, particles and lights. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private sprites: SpriteCache;
  private sim: Sim | null = null;
  private viewR = 300;
  private camX = 0;
  private camY = 0;
  private camVX = 0;
  private camVY = 0;
  private shake = 0;
  private clock = 0;
  private particles: Particle[] = [];
  private lights: Light[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private lookColors: string[] = [];
  private roster: { h: number; name: string; look: number; group: number; maxHp: number; dead: boolean; hp: number }[] = [];
  private tmp = { x: 0, y: 0 };
  private seg = [0, 0, 0, 0];
  private scale = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.sprites = new SpriteCache(() => this.sim?.assets ?? {});
  }

  get viewRadius(): number {
    return this.viewR;
  }

  fit(sim: Sim): void {
    this.sim = sim;
    const v = sim.def.settings.view;
    this.viewR = v > 0 ? v : sim.contentRadius() * 1.04 + 10;
    this.camX = 0; this.camY = 0; this.camVX = 0; this.camVY = 0;
    if (sim.settings.camera === 'follow' && sim.focus(this.tmp)) { this.camX = this.tmp.x; this.camY = this.tmp.y; }
    this.particles = []; this.lights = []; this.rings = []; this.floaters = [];
    this.lookColors = [];
    this.roster = [];
  }

  resize(dprCap = 2): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  private colorOf(sim: Sim, lookId: number): string {
    let c = this.lookColors[lookId];
    if (!c) {
      const l = sim.looks[lookId];
      if (!l) return '#E7E9EC';
      c = colorOfLook(l, sim.assets);
      if (l.t !== 'flag' && l.t !== 'image') this.lookColors[lookId] = c;
    }
    return c;
  }

  /* --------------------------------- Effects --------------------------------- */

  /** Turn sim events into particles, lights and rings. */
  ingest(sim: Sim, fx: Fx[]): void {
    for (const f of fx) {
      switch (f.k) {
        case 'bounce':
        case 'hit': {
          const col = this.colorOf(sim, f.l);
          const k = Math.min(1, f.s / 900);
          this.light(f.x, f.y, f.r * (2.5 + k * 4), 0.15 + k * 0.35, col, 0.35);
          if (f.s > 260) this.sparks(f.x, f.y, 2 + (k * 4) | 0, col, 120 + f.s * 0.25, 1.5);
          break;
        }
        case 'shatter': this.dissolve(f); break;
        case 'boom':
          this.light(f.x, f.y, f.big ? 700 : 220, 0.9, '#FFFFFF', 0.7);
          this.ring(f.x, f.y, 10, f.big ? 900 : 200, 0.7, '#FFFFFF', 4);
          this.sparks(f.x, f.y, f.big ? 60 : 18, '#FDE68A', f.big ? 900 : 380, 3);
          this.shake = Math.max(this.shake, f.big ? 1 : 0.4);
          break;
        case 'clank':
          this.light(f.x, f.y, 140, 0.55 * f.s, '#E2E8F0', 0.25);
          this.sparks(f.x, f.y, 10, '#FFE7B0', 420, 2);
          this.shake = Math.max(this.shake, 0.35 * f.s);
          break;
        case 'pop':
          this.ring(f.x, f.y, 4, 26, 0.35, this.colorOf(sim, f.l), 2);
          break;
        case 'fall':
          break;
        case 'pickup':
          this.ring(f.x, f.y, 6, 60, 0.45, POWERUP_COLOR[f.kind as keyof typeof POWERUP_COLOR] ?? '#FFFFFF', 3);
          this.light(f.x, f.y, 120, 0.6, POWERUP_COLOR[f.kind as keyof typeof POWERUP_COLOR] ?? '#FFFFFF', 0.4);
          break;
        case 'special': {
          const col = SPECIAL_COLOR[f.kind] ?? '#FFFFFF';
          this.ring(f.x, f.y, 10, 140, 0.6, col, 5);
          this.ring(f.x, f.y, 10, 90, 0.45, '#FFFFFF', 2);
          this.light(f.x, f.y, 260, 0.9, col, 0.6);
          this.sparks(f.x, f.y, 24, col, 520, 2.5);
          this.floaters.push({ x: f.x, y: f.y - 24, text: f.name, t: this.clock, color: col, big: true });
          this.shake = Math.max(this.shake, 0.45);
          break;
        }
        case 'damage':
          if (f.amount > 0) {
            this.light(f.x, f.y, 90, 0.5, '#FF5A6A', 0.25);
            this.sparks(f.x, f.y, 5, '#FFB3BA', 260, 1.8);
            this.shake = Math.max(this.shake, Math.min(0.3, 0.1 + f.amount * 0.06));
          }
          if (f.amount > 0) this.floaters.push({ x: f.x, y: f.y, text: `−${fmt(f.amount)}`, t: this.clock, color: '#FF7A85' });
          else if (f.blocked) this.floaters.push({ x: f.x, y: f.y, text: 'blocked', t: this.clock, color: '#67E8F9' });
          break;
        case 'clash':
          this.sparks(f.x, f.y, 6, '#FFFFFF', 300, 1.5);
          this.light(f.x, f.y, 80, 0.4, '#FFFFFF', 0.2);
          break;
        case 'zap':
          this.light(f.x2, f.y2, 120, 0.7, '#A5F3FC', 0.3);
          break;
        case 'end':
          this.light(this.camX, this.camY, this.viewR * 2, 0.35, '#FFFFFF', 1.2);
          break;
      }
    }
    if (this.particles.length > 5000) this.particles.splice(0, this.particles.length - 5000);
    if (this.lights.length > 48) this.lights.splice(0, this.lights.length - 48);
  }

  private light(x: number, y: number, r: number, a: number, color: string, life: number) {
    this.lights.push({ x, y, r, a, color, t: this.clock, life });
  }
  private ring(x: number, y: number, r0: number, r1: number, life: number, color: string, width: number) {
    this.rings.push({ x, y, r0, r1, t: this.clock, life, color, width });
  }
  private sparks(x: number, y: number, n: number, color: string, speed: number, size: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.35 + Math.random() * 0.4, size: size * (0.6 + Math.random() * 0.8), color, grav: 300 });
    }
  }

  /** A wall turns to powder: particles sampled along its visible length. */
  private dissolve(f: Extract<Fx, { k: 'shatter' }>): void {
    const view = this.viewR * 1.6;
    const color = f.color;
    const light = shade(color, 0.45);
    let budget = 900;
    for (let k = 0; k + 5 < f.arcs.length && budget > 0; k += 6) {
      const [cx, cy, R, a0, span] = f.arcs.slice(k, k + 5);
      // Only the part of the arc near the camera.
      const toCam = Math.atan2(this.camY - cy, this.camX - cx);
      const vis = Math.min(span, (view * 2) / Math.max(R, 1));
      let start = a0, len = span;
      if (span > vis) {
        let rel = toCam - a0;
        rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        start = a0 + Math.max(0, Math.min(span - vis, rel - vis / 2));
        len = vis;
      }
      const n = Math.min(budget, Math.max(12, Math.round((len * R) / 5)));
      budget -= n;
      for (let j = 0; j < n; j++) {
        const a = start + (len * (j + Math.random())) / n;
        const px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R;
        const out = (Math.random() - 0.3) * 160;
        this.particles.push({
          x: px, y: py, vx: Math.cos(a) * out + (Math.random() - 0.5) * 70, vy: Math.sin(a) * out + (Math.random() - 0.5) * 70 - 30,
          life: 0, max: 0.9 + Math.random() * 1.1, size: 1.2 + Math.random() * 2.2, color: Math.random() < 0.3 ? light : color, grav: 160,
        });
      }
      this.light(cx + Math.cos(start + len / 2) * R, cy + Math.sin(start + len / 2) * R, 120, 0.35, color, 0.4);
    }
    for (let k = 0; k + 4 < f.segs.length && budget > 0; k += 5) {
      const [x0, y0, x1, y1] = f.segs.slice(k, k + 4);
      const n = Math.min(budget, Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6)));
      budget -= n;
      for (let j = 0; j < n; j++) {
        const u = Math.random();
        this.particles.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160 - 40, life: 0, max: 0.8 + Math.random(), size: 1.5 + Math.random() * 2, color, grav: 200 });
      }
    }
  }

  /* ---------------------------------- Draw ----------------------------------- */

  draw(sim: Sim, opts: DrawOptions = {}, realDt = 1 / 60): void {
    if (this.sim !== sim) this.fit(sim);
    this.clock += realDt;
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const w = sim.world;

    // Camera
    if (sim.settings.camera === 'follow' && sim.focus(this.tmp)) {
      const dz = this.viewR * 0.3;
      const dx = this.tmp.x - this.camX, dy = this.tmp.y - this.camY;
      const d = Math.hypot(dx, dy);
      let tx = this.camX, ty = this.camY;
      if (d > dz) { tx = this.tmp.x - (dx / d) * dz; ty = this.tmp.y - (dy / d) * dz; }
      const k = 7, c = 2 * Math.sqrt(k);
      const dt = Math.min(0.05, realDt);
      this.camVX += ((tx - this.camX) * k - this.camVX * c) * dt;
      this.camVY += ((ty - this.camY) * k - this.camVY * c) * dt;
      this.camX += this.camVX * dt;
      this.camY += this.camVY * dt;
    }
    this.shake = Math.max(0, this.shake - realDt * 2.5);
    const sh = this.shake * this.shake * this.viewR * 0.02;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;

    if (opts.hud) this.updateRoster(sim);
    // Leave room for health cards when fighters are on screen.
    const L = this.layout = this.hudLayout(sim, W, H, opts);
    const scale = (this.scale = Math.min(W - L.rx, H - L.top - L.bottom) / (2 * this.viewR));
    const midY = L.top + (H - L.top - L.bottom) / 2;
    this.drawBackground(W, H, opts.lite);
    g.setTransform(scale, 0, 0, scale, W / 2 - (this.camX + ox) * scale, midY - (this.camY + oy) * scale);
    const px = 1 / scale;
    const halfW = W / 2 / scale, halfH = H / 2 / scale;
    void midY;
    const vx0 = this.camX - halfW, vx1 = this.camX + halfW, vy0 = this.camY - halfH, vy1 = this.camY + halfH;

    // Lights (additive, under everything solid)
    g.globalCompositeOperation = 'lighter';
    this.lights = this.lights.filter((l) => this.clock - l.t < l.life);
    for (const l of this.lights) {
      const k = 1 - (this.clock - l.t) / l.life;
      const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      gr.addColorStop(0, hexA(l.color, l.a * k * 0.5));
      gr.addColorStop(1, hexA(l.color, 0));
      g.fillStyle = gr;
      g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    // Zones
    for (const z of sim.zones) {
      if (!z.alive || !z.visible) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.2 + z.x * 0.01);
      if (z.shape === 'circle') {
        const gr = g.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r * 1.6);
        gr.addColorStop(0, hexA(z.color, 0.32 + pulse * 0.1));
        gr.addColorStop(0.6, hexA(z.color, 0.12));
        gr.addColorStop(1, hexA(z.color, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(z.x, z.y, z.r * 1.6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hexA(z.color, 0.8);
        g.lineWidth = px * 1.5;
        g.beginPath(); g.arc(z.x, z.y, z.r, 0, Math.PI * 2); g.stroke();
      } else {
        g.fillStyle = hexA(z.color, 0.14);
        g.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
        g.strokeStyle = hexA(z.color, 0.7);
        g.lineWidth = px * 1.5;
        g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
      }
      if (z.label) {
        g.fillStyle = '#FFFFFF';
        g.font = `600 ${z.r * 0.9}px ${SANS}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(z.label, z.x, z.y + z.r * 0.05);
      }
    }

    // Ground flames
    for (const f of sim.arena.flames) {
      const age = sim.time - f.born;
      const k = Math.max(0, 1 - age / 4);
      flame(g, f.x, f.y, f.r * (0.8 + age * 0.15) * (0.6 + k * 0.4), this.clock);
    }

    if (this.roster.length && !opts.lite) this.drawFloor(px);
    this.drawWalls(sim, px, vx0, vy0, vx1, vy1, opts.lite);
    if (this.roster.length) this.drawTrails(sim, px);
    for (const sl of sim.sledges) this.drawSledge(sim, sl);

    // Tethers
    if (w.tetherAliveCount > 0) {
      g.lineWidth = px * 1.4;
      g.lineCap = 'round';
      const P = this.tmp;
      for (let t = 0; t < w.tetherHigh; t++) {
        if (!w.tAlive[t]) continue;
        const i = w.tBody[t];
        w.tetherAnchor(t, P);
        const col = this.colorOf(sim, sim.look[i]);
        g.strokeStyle = hexA(col, 0.65);
        g.beginPath();
        g.moveTo(w.x[i], w.y[i]);
        g.lineTo(P.x, P.y);
        g.stroke();
        g.fillStyle = col;
        g.beginPath(); g.arc(P.x, P.y, px * 2.5, 0, Math.PI * 2); g.fill();
      }
    }

    // Pickups
    const t = this.clock;
    if (sim.arena.pickupCfg) {
      const s = sim.arena.pickupCfg.size;
      for (const p of sim.arena.pickups) drawPowerup(g, p.x, p.y, s, POWERUP_COLOR[p.kind], p.kind, t);
    }

    this.drawBalls(sim, px, opts.lite);

    // Weapons
    if (sim.arena.weaponCfgs.length) {
      for (let i = 0; i < w.highWater; i++) {
        if (sim.arena.wType[i] < 0 || !sim.inPlay(i)) continue;
        sim.arena.weaponSeg(i, this.seg);
        const [ax, ay, bx, by] = this.seg;
        const ang = Math.atan2(by - ay, bx - ax);
        const len = Math.hypot(bx - ax, by - ay);
        g.save();
        g.translate(ax, ay);
        g.rotate(ang);
        drawWeapon(g, WEAPON_TYPES[sim.arena.wType[i]], 0, len, w.r[i], t, sim.arena.wHits[i]);
        g.restore();
      }
    }
    // Lightning
    for (const z of sim.arena.zaps) this.bolt(z.x, z.y, z.x2, z.y2, px);

    // Rings and particles
    this.rings = this.rings.filter((r) => this.clock - r.t < r.life);
    for (const r of this.rings) {
      const k = (this.clock - r.t) / r.life;
      g.strokeStyle = hexA(r.color, (1 - k) * 0.8);
      g.lineWidth = r.width * px * (1 - k * 0.6);
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOut(k), 0, Math.PI * 2);
      g.stroke();
    }
    const dt = Math.min(0.05, realDt);
    let alive = 0;
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy += p.grav * dt;
      p.vx *= 1 - 1.2 * dt;
      p.vy *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.particles[alive++] = p;
      const k = 1 - p.life / p.max;
      g.globalAlpha = k;
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size * px, p.y - p.size * px, p.size * 2 * px, p.size * 2 * px);
    }
    this.particles.length = alive;
    g.globalAlpha = 1;

    // Floating damage numbers
    this.floaters = this.floaters.filter((f) => this.clock - f.t < (f.big ? 1.4 : 0.9));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of this.floaters) {
      const life = f.big ? 1.4 : 0.9;
      const k = (this.clock - f.t) / life;
      g.globalAlpha = 1 - k * k;
      g.fillStyle = f.color;
      g.font = f.big ? `700 ${30 * px * 1.6 * (1 + 0.25 * (1 - k))}px ${SANS}` : `600 ${16 * px * 1.6}px ${MONO}`;
      g.fillText(f.text, f.x, f.y - 26 - k * 30);
    }
    g.globalAlpha = 1;

    // Falling balls: off the plane toward the viewer, drawn on top.
    this.drawFalling(sim);

    if (opts.hud) this.drawHud(sim, W, H, (opts.hudTop ?? 0) * (W / Math.max(1, this.canvas.clientWidth)));
  }

  private drawBackground(W: number, H: number, lite?: boolean): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0F1013';
    g.fillRect(0, 0, W, H);
    const t = this.clock;
    const m = Math.max(W, H);
    // Drifting soft light fields
    const fields = lite ? 1 : 3;
    for (let k = 0; k < fields; k++) {
      const fx = W * (0.5 + 0.38 * Math.sin(t * (0.05 + k * 0.023) + k * 2.1));
      const fy = H * (0.5 + 0.34 * Math.cos(t * (0.041 + k * 0.017) + k * 1.3));
      const r = m * (0.55 + 0.1 * Math.sin(t * 0.3 + k));
      const gr = g.createRadialGradient(fx, fy, 0, fx, fy, r);
      gr.addColorStop(0, `rgba(255,255,255,${0.045 + 0.015 * Math.sin(t * 0.7 + k * 1.7)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // Vignette
    const vg = g.createRadialGradient(W / 2, H / 2, m * 0.25, W / 2, H / 2, m * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    if (!lite) {
      const tile = grain();
      g.save();
      g.globalAlpha = 0.5;
      g.translate(-((t * 997) % 160) | 0, -((t * 613) % 160) | 0);
      g.fillStyle = g.createPattern(tile, 'repeat')!;
      g.fillRect(0, 0, W + 160, H + 160);
      g.restore();
    }
  }

  private drawWalls(sim: Sim, px: number, vx0: number, vy0: number, vx1: number, vy1: number, lite?: boolean): void {
    const g = this.ctx;
    const w = sim.world;
    const cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
    const diag = Math.hypot(vx1 - vx0, vy1 - vy0) / 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Glow would wash densely packed ring stacks into one solid color.
    let rings = 0;
    for (let c = 0; c < w.colAlive.length && rings <= 60; c++) if (w.colAlive[c] && w.colRadial[c]) rings++;
    const dense = rings > 60;
    for (let pass = 0; pass < (lite ? 1 : 2); pass++) {
      const glow = !lite && pass === 0;
      if (glow) g.globalCompositeOperation = 'lighter';
      // Connected segments of one collider are stroked as a single path.
      let open = false, openCol = -1, openHt = 0, lastX = NaN, lastY = NaN;
      const flush = () => {
        if (!open) return;
        open = false;
        this.strokeWall(sim, openCol, openHt, glow, px);
      };
      for (let p = 0; p < w.pieceCount; p++) {
        if (!w.pAlive[p]) continue;
        const col = w.pCol[p];
        const kind = sim.colKind[col];
        if (kind === 'hammer' || kind === 'stop') continue;
        const titanium = sim.colMaterial[col] === 'titanium';
        if (titanium && glow) continue;
        if (glow && dense && w.colRadial[col]) continue;
        const b = p * 12, D = w.pData, sc = w.colScale[col];
        const c = w.colCos[col], s = w.colSin[col], ox = w.colX[col], oy = w.colY[col];
        const ht = w.pHt[p];
        if (w.pKind[p] === 1) {
          flush();
          const acx = ox + (c * D[b] - s * D[b + 1]) * sc;
          const acy = oy + (s * D[b] + c * D[b + 1]) * sc;
          const R = D[b + 2] * sc;
          const dd = Math.hypot(acx - cx, acy - cy);
          if (dd - R > diag + ht * 4 || R - dd > diag + ht * 4) continue;
          const a0 = Math.atan2(D[b + 5], D[b + 4]) + w.colAngle[col];
          const span = D[b + 3];
          g.beginPath();
          if (R > diag * 1.5 && span > (diag * 3) / R) {
            // Only the visible stretch of big rings.
            // The window around the camera can wrap past 0, so test it in three shifted copies.
            const toCam = Math.atan2(cy - acy, cx - acx);
            const vis = Math.min(Math.PI, (diag * 2.2) / R);
            const TAU = Math.PI * 2;
            const rel = (((toCam - a0) % TAU) + TAU) % TAU;
            let drew = false;
            for (const shift of [-TAU, 0, TAU]) {
              const s0 = Math.max(0, rel + shift - vis), s1 = Math.min(span, rel + shift + vis);
              if (s1 <= s0) continue;
              g.moveTo(acx + Math.cos(a0 + s0) * R, acy + Math.sin(a0 + s0) * R);
              g.arc(acx, acy, R, a0 + s0, a0 + s1);
              drew = true;
            }
            if (!drew) continue;
          } else g.arc(acx, acy, R, a0, a0 + span);
          open = true; openCol = col; openHt = ht;
          flush();
          continue;
        }
        const x0 = ox + (c * D[b] - s * D[b + 1]) * sc, y0 = oy + (s * D[b] + c * D[b + 1]) * sc;
        const x1 = ox + (c * D[b + 2] - s * D[b + 3]) * sc, y1 = oy + (s * D[b + 2] + c * D[b + 3]) * sc;
        const joins = open && openCol === col && Math.abs(x0 - lastX) < 1e-6 && Math.abs(y0 - lastY) < 1e-6;
        if (!joins) {
          flush();
          g.beginPath();
          g.moveTo(x0, y0);
          open = true; openCol = col; openHt = ht;
        }
        g.lineTo(x1, y1);
        lastX = x1; lastY = y1;
      }
      flush();
      g.globalCompositeOperation = 'source-over';
    }
  }

  private strokeWall(sim: Sim, col: number, ht: number, glow: boolean, px: number): void {
    const g = this.ctx;
    const color = sim.colColor[col] ?? '#8EC5FF';
    if (glow) {
      g.strokeStyle = hexA(color, 0.16);
      g.lineWidth = ht * 2 + 14 * px;
      g.stroke();
      return;
    }
    if (sim.colMaterial[col] === 'titanium') {
      g.strokeStyle = '#3A4049';
      g.lineWidth = ht * 2 + 2 * px;
      g.stroke();
      g.strokeStyle = '#C7CED6';
      g.lineWidth = ht * 2;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = Math.max(px, ht * 0.35);
      g.stroke();
      return;
    }
    const grad = sim.colGrad[col];
    const w = sim.world;
    if (grad && typeof (g as any).createConicGradient === 'function') {
      const ctr = sim.colGradCenter[col] ?? [w.colX[col], w.colY[col]];
      const cg = (g as any).createConicGradient(w.colAngle[col], ctr[0], ctr[1]) as CanvasGradient;
      const stops = [...grad, grad[0]];
      stops.forEach((c, k) => cg.addColorStop(k / (stops.length - 1), c));
      g.strokeStyle = cg;
    } else g.strokeStyle = color;
    g.lineWidth = Math.max(ht * 2, px * 1.5);
    g.stroke();
    g.strokeStyle = hexA('#FFFFFF', 0.35);
    g.lineWidth = Math.max(px, ht * 0.5);
    g.stroke();
  }

  private drawSledge(sim: Sim, sl: Sim['sledges'][number]): void {
    const g = this.ctx, w = sim.world, c = sl.cfg;
    const L = c.length, hl = c.headLength, hw = c.headWidth, bw = c.stopWidth, R = c.reach;
    const frame = (angle: number, f: () => void) => {
      g.save();
      g.translate(c.x, c.y);
      g.rotate(angle);
      f();
      g.restore();
    };
    for (const [k, id] of sl.stops.entries()) {
      if (!w.colAlive[id]) continue;
      frame(w.colAngle[id], () => {
        if (k === 0) titaniumBlock(g, L - hl / 2, -hw / 2 - bw, R, -hw / 2);
        if (k === 1) titaniumBlock(g, -R, hw / 2, -L + hl / 2, hw / 2 + bw);
        if (k === 2) titaniumBlock(g, L - hl / 2, hw / 2, R, hw / 2 + bw);
        if (k === 3) titaniumBlock(g, -R, -hw / 2 - bw, -L + hl / 2, -hw / 2);
      });
    }
    if (!w.colAlive[sl.hammer]) return;
    frame(w.colAngle[sl.hammer], () => {
      // Shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(-L - hl / 2 + 6, -hw / 2 + 8, 2 * L + hl, hw);
      steelRod(g, -L + hl / 2 - 4, L - hl / 2 + 4, c.handle / 2);
      titaniumBlock(g, L - hl / 2, -hw / 2, L + hl / 2, hw / 2);
      titaniumBlock(g, -L - hl / 2, -hw / 2, -L + hl / 2, hw / 2);
      // Pivot cap
      const pg = g.createRadialGradient(-4, -4, 0, 0, 0, 16);
      pg.addColorStop(0, '#FFFFFF'); pg.addColorStop(1, '#5F6772');
      g.fillStyle = pg;
      g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill();
    });
  }

  private drawBalls(sim: Sim, px: number, lite?: boolean): void {
    const g = this.ctx, w = sim.world;
    const n = w.aliveCount;
    const halos = !lite && n < 350;
    const ready = sim.readiness;
    if (halos) {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < w.highWater; i++) {
        if (!w.alive[i] || sim.fallT[i] > 0 || sim.alpha[i] <= 0) continue;
        const r = w.r[i] * 2.2;
        const col = this.colorOf(sim, sim.look[i]);
        const gr = g.createRadialGradient(w.x[i], w.y[i], w.r[i] * 0.6, w.x[i], w.y[i], r);
        gr.addColorStop(0, hexA(col, 0.22 * sim.alpha[i]));
        gr.addColorStop(1, hexA(col, 0));
        g.fillStyle = gr;
        g.fillRect(w.x[i] - r, w.y[i] - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over';
    }
    const t = this.clock;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || sim.fallT[i] > 0) continue;
      const a = sim.alpha[i];
      if (a <= 0) continue;
      const r = w.r[i];
      const look = sim.looks[sim.look[i]];
      const square = w.shape[i] === 1;
      const spr = this.sprites.get(look, r * 2 * this.scale, square);
      if (a < 1) g.globalAlpha = a;
      g.drawImage(spr, w.x[i] - r, w.y[i] - r, r * 2, r * 2);
      // Fighters get a crisp rim so dark looks read on the dark ground; buffs color it.
      if (sim.maxHp[i] > 0 && look.t !== 'imp') {
        const reds = sim.arena.redCount(i);
        const lw = Math.max(px * 1.5, r * 0.08);
        g.lineWidth = reds ? lw * 1.8 : lw;
        g.strokeStyle = reds ? '#FF4D5E' : 'rgba(255,255,255,0.75)';
        g.beginPath();
        if (square) g.rect(w.x[i] - r - lw / 2, w.y[i] - r - lw / 2, r * 2 + lw, r * 2 + lw);
        else g.arc(w.x[i], w.y[i], r + lw / 2, 0, Math.PI * 2);
        g.stroke();
        const sh = sim.arena.shield[i];
        if (sh > 0) {
          g.strokeStyle = 'rgba(56,225,245,0.85)';
          g.lineWidth = lw;
          for (let k = 0; k < sh; k++) {
            const pad = lw * (2.4 + k * 1.8);
            g.beginPath();
            if (square) g.rect(w.x[i] - r - pad, w.y[i] - r - pad, (r + pad) * 2, (r + pad) * 2);
            else g.arc(w.x[i], w.y[i], r + pad, 0, Math.PI * 2);
            g.stroke();
          }
        }
        if (sim.arena.burnUntil[i] > sim.time) flame(g, w.x[i], w.y[i] - r * 0.9, r * 0.7, t + i);
      }
      if (ready < 1) {
        // Charge-up pulse during the starting pose.
        const k = (t * 1.6) % 1;
        g.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.5})`;
        g.lineWidth = px * 2;
        g.beginPath();
        g.arc(w.x[i], w.y[i], r * (1.2 + k * 1.6), 0, Math.PI * 2);
        g.stroke();
      }
      if (a < 1) g.globalAlpha = 1;
    }
  }

  private trails = new Map<number, number[]>();

  /** Fading afterimages behind fighters, so motion reads at a glance. */
  private drawTrails(sim: Sim, px: number): void {
    const g = this.ctx, w = sim.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || sim.maxHp[i] <= 0 || !sim.inPlay(i)) { this.trails.delete(i); continue; }
      let tr = this.trails.get(i);
      if (!tr) { tr = []; this.trails.set(i, tr); }
      tr.push(w.x[i], w.y[i]);
      if (tr.length > 28) tr.splice(0, 2);
      const col = this.colorOf(sim, sim.look[i]);
      const n = tr.length / 2;
      g.lineCap = 'round';
      for (let k = 1; k < n; k++) {
        const a = k / n;
        g.strokeStyle = hexA(col, a * 0.35);
        g.lineWidth = Math.max(px, w.r[i] * 1.4 * a);
        g.beginPath();
        g.moveTo(tr[(k - 1) * 2], tr[(k - 1) * 2 + 1]);
        g.lineTo(tr[k * 2], tr[k * 2 + 1]);
        g.stroke();
      }
    }
  }

  /** A lit floor with a faint grid for arenas. */
  private drawFloor(px: number): void {
    const g = this.ctx;
    const R = this.viewR / 1.04;
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.2);
    glow.addColorStop(0, 'rgba(120,140,170,0.10)');
    glow.addColorStop(1, 'rgba(120,140,170,0)');
    g.fillStyle = glow;
    g.fillRect(-R, -R, R * 2, R * 2);
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.lineWidth = px;
    const step = 30;
    g.beginPath();
    for (let x = -Math.floor(R / step) * step; x <= R; x += step) { g.moveTo(x, -R); g.lineTo(x, R); }
    for (let y = -Math.floor(R / step) * step; y <= R; y += step) { g.moveTo(-R, y); g.lineTo(R, y); }
    g.stroke();
  }

  private drawFalling(sim: Sim): void {
    const g = this.ctx, w = sim.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || sim.fallT[i] === 0) continue;
      const k = Math.min(1, (sim.time - sim.fallT[i]) / 1.3);
      const sc = 1 + k * k * 3.2;
      const r = w.r[i] * sc;
      const x = w.x[i] + (w.x[i] - this.camX) * k * 0.6;
      const y = w.y[i] + k * k * this.viewR * 0.9;
      g.globalAlpha = Math.max(0, 1 - k * k);
      const spr = this.sprites.get(sim.looks[sim.look[i]], r * 2 * this.scale, w.shape[i] === 1);
      g.drawImage(spr, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }

  private bolt(x0: number, y0: number, x1: number, y1: number, px: number): void {
    const g = this.ctx;
    g.strokeStyle = 'rgba(165,243,252,0.95)';
    g.lineWidth = px * 2.5;
    g.beginPath();
    g.moveTo(x0, y0);
    const n = 7;
    for (let k = 1; k < n; k++) {
      const u = k / n;
      g.lineTo(x0 + (x1 - x0) * u + (Math.random() - 0.5) * 18, y0 + (y1 - y0) * u + (Math.random() - 0.5) * 18);
    }
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = px;
    g.stroke();
  }

  /* ----------------------------------- HUD ----------------------------------- */

  private drawHud(sim: Sim, W: number, H: number, top: number): void {
    const g = this.ctx;
    const u = Math.min(W, H) / 100;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const pad = Math.max(16, u * 3);
    const s = sim.def.settings;
    let y = pad + top;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    if (s.clock !== 'none') {
      const t = s.clock === 'down' ? Math.max(0, s.clockFrom - (sim.outcome?.time ?? sim.time)) : sim.outcome?.time ?? sim.time;
      const fs = Math.max(20, u * 4.4);
      g.font = `500 ${fs}px ${MONO}`;
      g.fillStyle = '#F1F3F5';
      g.fillText(formatClock(t), pad, y);
      y += fs * 1.35;
    }
    const fs = Math.max(12, u * 2.1);
    g.font = `500 ${fs}px ${MONO}`;
    for (const c of sim.counters.values()) {
      if (!c.show) continue;
      if (c.place === 'center') {
        // Big score in the middle of the sim.
        const L = this.layout;
        const cy = L.top + (H - L.top - L.bottom) / 2;
        const text = formatNum(sim.counterValue(c));
        let big = Math.max(28, u * 7);
        // Fit inside the innermost ring when there's a ring stack around the center.
        const R0 = sim.snapBack[0]?.R0;
        if (R0) {
          const rPx = R0 * this.scale * 0.82;
          big = Math.min(big, (rPx * 1.55) / (text.length * 0.62), rPx * 0.9);
        }
        g.save();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `600 ${big}px ${MONO}`;
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = big * 0.4;
        g.fillStyle = '#FFFFFF';
        g.fillText(text, W / 2, cy);
        g.restore();
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.font = `500 ${fs}px ${MONO}`;
        continue;
      }
      const label = c.name.toUpperCase();
      g.fillStyle = '#8A919C';
      g.fillText(label, pad, y);
      const nameW = g.measureText(label + '  ').width;
      g.fillStyle = '#F1F3F5';
      g.fillText(formatNum(sim.counterValue(c)), pad + nameW, y);
      y += fs * 1.55;
    }
    this.drawHpBars(sim, W, H, u, top);
    if (sim.outcome) {
      const a = Math.min(1, sim.sinceEnd / 0.6);
      const size = Math.max(20, u * 4.6);
      g.font = `500 ${size}px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const text = sim.outcome.label;
      const tw = g.measureText(text).width;
      const cx = W / 2, cy = H - pad * 2.6 - size * 0.4;
      const bw = tw + size * 2, bh = size * 2.1;
      const rise = (1 - easeOut(a)) * size;
      g.save();
      g.globalAlpha = a;
      g.translate(0, rise);
      const bg = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      bg.addColorStop(0, 'rgba(24,26,31,0.86)');
      bg.addColorStop(1, 'rgba(32,35,42,0.86)');
      g.fillStyle = bg;
      g.beginPath(); roundRect(g, cx - bw / 2, cy - bh / 2, bw, bh, bh / 2); g.fill();
      const edge = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      edge.addColorStop(0, 'rgba(255,90,31,0.0)');
      edge.addColorStop(0.5, 'rgba(255,90,31,0.9)');
      edge.addColorStop(1, 'rgba(255,90,31,0.0)');
      g.strokeStyle = edge;
      g.lineWidth = Math.max(1.5, u * 0.25);
      g.stroke();
      g.fillStyle = '#F5F6F8';
      g.fillText(text, cx, cy + size * 0.04);
      g.restore();
    }
  }

  /** Health bars down the sides of the arena (or along the top and bottom on tall screens). */
  private layout = { rx: 0, top: 0, bottom: 0, wide: true, cardH: 44, step: 50, cols: 2, topRows: 0, botRows: 0, topStart: 0, botStart: 0 };

  /** Where health cards go and how much room they take. */
  private hudLayout(sim: Sim, W: number, H: number, opts: DrawOptions) {
    const out = { rx: 0, top: 0, bottom: 0, wide: true, cardH: 44, step: 50, cols: 2, topRows: 0, botRows: 0, topStart: 0, botStart: 0 };
    if (!opts.hud) return out;
    const k = W / Math.max(1, this.canvas.clientWidth);
    const hudTop = (opts.hudTop ?? 0) * k;
    // In the full sim view, keep the action clear of the top bar and the control bar.
    const barRoom = (opts.hudTop ? 84 : 0) * k;
    out.top = hudTop;
    out.bottom = barRoom;
    if (!this.roster.length) return out;
    const u = Math.min(W, H) / 100;
    out.cardH = Math.max(44, u * 7.5);
    out.step = out.cardH + u * 1.5;
    out.wide = W / H > 1.15;
    if (out.wide) {
      out.rx = Math.min(W * 0.46, Math.max(0, 2 * Math.min(300, W * 0.22) - (W - H)));
      return out;
    }
    const n = this.roster.length;
    out.cols = Math.min(Math.ceil(n / 2), W > 700 ? 3 : 2);
    out.topRows = Math.ceil(Math.ceil(n / 2) / out.cols);
    out.botRows = Math.ceil(Math.floor(n / 2) / out.cols);
    const pad = Math.max(16, u * 3);
    const clockH = sim.settings.clock !== 'none' ? Math.max(20, u * 4.4) * 1.35 : 0;
    out.topStart = hudTop + pad + clockH;
    out.top = out.topStart + out.topRows * out.step + u;
    out.bottom = out.botRows * out.step + pad + barRoom;
    out.botStart = H - out.bottom + u;
    return out;
  }

  private updateRoster(sim: Sim): void {
    const w = sim.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || sim.maxHp[i] <= 0) continue;
      const h = w.handleAt(i);
      if (!this.roster.some((r) => r.h === h)) this.roster.push({ h, name: sim.nameOf(h), look: sim.look[i], group: w.group[i], maxHp: sim.maxHp[i], dead: false, hp: sim.hp[i] });
    }
  }

  private drawHpBars(sim: Sim, W: number, H: number, u: number, top: number): void {
    const w = sim.world;
    if (!this.roster.length) return;
    for (const r of this.roster) {
      const i = w.indexOf(r.h);
      if (i < 0 || !sim.inPlay(i)) { r.dead = true; r.hp = 0; } else { r.hp = sim.hp[i]; r.maxHp = Math.max(r.maxHp, sim.maxHp[i]); }
    }
    const g = this.ctx;
    const wide = W / H > 1.15;
    const arenaPx = Math.min(W, H) * 0.98;
    const sideW = wide ? (W - arenaPx) / 2 : W;
    const n = this.roster.length;
    const left = this.roster.filter((_, k) => k % 2 === 0), right = this.roster.filter((_, k) => k % 2 === 1);
    const card = (r: (typeof this.roster)[number], x: number, y: number, cw: number) => {
      const ch = Math.max(44, u * 7.5);
      g.save();
      g.globalAlpha = r.dead ? 0.38 : 1;
      g.fillStyle = 'rgba(20,22,27,0.82)';
      g.beginPath(); roundRect(g, x, y, cw, ch, ch * 0.22); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.stroke();
      const icon = ch * 0.56;
      const look = sim.looks[r.look];
      const spr = this.sprites.get(look, icon, true);
      g.drawImage(spr, x + ch * 0.22, y + (ch - icon) / 2, icon, icon);
      const tx = x + ch * 0.22 + icon + ch * 0.22;
      g.fillStyle = '#F1F3F5';
      g.font = `500 ${Math.max(11, ch * 0.26)}px ${SANS}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(fitText(g, r.name, cw - (tx - x) - ch * 0.9), tx, y + ch * 0.16);
      g.textAlign = 'right';
      g.font = `500 ${Math.max(10, ch * 0.24)}px ${MONO}`;
      g.fillStyle = '#AEB4BD';
      g.fillText(r.dead ? 'out' : fmt(r.hp), x + cw - ch * 0.22, y + ch * 0.17);
      const by = y + ch * 0.62, bh = Math.max(4, ch * 0.16), bw = cw - (tx - x) - ch * 0.22;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); roundRect(g, tx, by, bw, bh, bh / 2); g.fill();
      const f = Math.max(0, Math.min(1, r.hp / Math.max(1, r.maxHp)));
      if (f > 0) {
        const gr = g.createLinearGradient(tx, 0, tx + bw, 0);
        gr.addColorStop(0, f < 0.3 ? '#FF4D5E' : '#4ADE80');
        gr.addColorStop(1, f < 0.3 ? '#FB923C' : '#5EEAD4');
        g.fillStyle = gr;
        g.beginPath(); roundRect(g, tx, by, Math.max(bh, bw * f), bh, bh / 2); g.fill();
      }
      const i = w.indexOf(r.h);
      if (i >= 0 && !r.dead && sim.arena.wType[i] >= 0) {
        // Weapon name under the name, and the special's charge as a thin meter.
        const type = WEAPON_TYPES[sim.arena.wType[i]];
        const active = sim.arena.specUntil[i] > sim.time;
        const f2 = active ? 1 : sim.arena.wCharge[i] / SPECIAL_CHARGE;
        const my = by + bh + 4, mh = Math.max(3, bh * 0.45);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(tx, my, bw, mh);
        g.fillStyle = active ? SPECIAL_COLOR[type] : 'rgba(255,214,102,0.85)';
        g.fillRect(tx, my, bw * f2, mh);
        g.font = `500 ${Math.max(9, ch * 0.18)}px ${MONO}`;
        g.textAlign = 'left';
        g.fillStyle = active ? SPECIAL_COLOR[type] : '#8A919C';
        g.fillText(active ? WEAPON_INFO[type].special.toUpperCase() : WEAPON_INFO[type].name.toUpperCase(), tx, y + ch * 0.4);
      }
      if (i >= 0 && !r.dead) {
        let pipX = tx;
        for (let k = 0; k < sim.arena.shield[i]; k++) { g.fillStyle = '#38E1F5'; g.fillRect(pipX, by + bh + 3, bh * 1.2, bh * 0.6); pipX += bh * 1.6; }
        for (let k = 0; k < sim.arena.redCount(i); k++) { g.fillStyle = '#FF4D5E'; g.fillRect(pipX, by + bh + 3, bh * 1.2, bh * 0.6); pipX += bh * 1.6; }
      }
      g.restore();
      return ch;
    };
    if (wide && sideW > 120) {
      const cw = Math.min(sideW - u * 4, u * 30);
      for (const [list, side] of [[left, 0], [right, 1]] as const) {
        let y = H * 0.5 - (list.length * (u * 9)) / 2;
        for (const r of list) {
          const x = side === 0 ? (sideW - cw) / 2 : W - sideW + (sideW - cw) / 2;
          y += card(r, x, y, cw) + u * 1.5;
        }
      }
    } else {
      const L = this.layout;
      const cw = (W - u * 4 - (L.cols - 1) * u * 1.5) / L.cols;
      left.forEach((r, k) => card(r, u * 2 + (k % L.cols) * (cw + u * 1.5), L.topStart + Math.floor(k / L.cols) * L.step, cw));
      right.forEach((r, k) => card(r, u * 2 + (k % L.cols) * (cw + u * 1.5), L.botStart + Math.floor(k / L.cols) * L.step, cw));
    }
  }
}

function fitText(g: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (g.measureText(s).width <= maxW) return s;
  while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k) * (1 - k);
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v < 10 ? v.toFixed(1) : String(Math.round(v));
}

export function formatClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatNum(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const hexCache = new Map<string, string>();
export function hexA(hex: string, a: number): string {
  const q = Math.round(a * 100) / 100;
  const k = hex + q;
  let v = hexCache.get(k);
  if (v) return v;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${q})`;
  if (hexCache.size < 4000) hexCache.set(k, v);
  return v;
}
