import { dmath } from '@engine/index';
import type { PieceDef } from '@engine/index';
import type { Sim, GroupInfo } from './sim';

export interface SledgeCfg {
  x: number;
  y: number;
  /** Pivot to head center. */
  length: number;
  headLength: number;
  headWidth: number;
  handle: number;
  /** Total swing, radians. */
  swing: number;
  /** Start tilt from vertical toward the left, radians. */
  tilt: number;
  hold: number;
  swingTime: number;
  /** Outer end of the stop blocks (usually just past the container wall). */
  reach: number;
  stopWidth: number;
}

/** A solid block as thick edges plus a fat core, in a frame where x runs along the block. */
export function solidBlock(x0: number, y0: number, x1: number, y1: number, edge = 3): PieceDef[] {
  const pieces: PieceDef[] = [
    { kind: 'segment', ax: x0, ay: y0, bx: x1, by: y0, halfThickness: edge },
    { kind: 'segment', ax: x1, ay: y0, bx: x1, by: y1, halfThickness: edge },
    { kind: 'segment', ax: x1, ay: y1, bx: x0, by: y1, halfThickness: edge },
    { kind: 'segment', ax: x0, ay: y1, bx: x0, by: y0, halfThickness: edge },
  ];
  const w = x1 - x0, h = y1 - y0;
  if (w >= h) pieces.push({ kind: 'segment', ax: x0 + h / 2, ay: (y0 + y1) / 2, bx: x1 - h / 2, by: (y0 + y1) / 2, halfThickness: h / 2 - 0.5 });
  else pieces.push({ kind: 'segment', ax: (x0 + x1) / 2, ay: y0 + w / 2, bx: (x0 + x1) / 2, by: y1 - w / 2, halfThickness: w / 2 - 0.5 });
  return pieces;
}

/**
 * Doubling sledge: a two-headed hammer pivoting at its center that rests
 * against titanium stops, then slams to the other side. Balls caught in the
 * closing gap between a head and a stop are swallowed (hidden, out of the
 * physics) and come back as the head pulls away, so pressure never jams the
 * hammer or squeezes balls through walls.
 */
export class Sledge {
  readonly hammer: number;
  readonly stops: number[] = [];
  readonly thA: number;
  readonly thB: number;
  /** Body index -> head (+1 top, -1 bottom). */
  hidden = new Map<number, number>();
  private crushQueue: number[] = [];
  private prevSwinging = false;
  /** Seconds since the last slam (for screen shake). */
  lastSlam = -10;

  constructor(private sim: Sim, readonly g: GroupInfo, readonly cfg: SledgeCfg) {
    const c = cfg;
    const L = c.length, hl = c.headLength, hw = c.headWidth;
    // Screen angles: -90° is straight up. Start tilted left.
    this.thA = -dmath.HALF_PI - c.tilt;
    this.thB = this.thA + c.swing;
    // The handle sits behind the balls (no collision), so both halves stay connected.
    const pieces: PieceDef[] = [
      ...solidBlock(L - hl / 2, -hw / 2, L + hl / 2, hw / 2),
      ...solidBlock(-L - hl / 2, -hw / 2, -L + hl / 2, hw / 2),
    ];
    this.hammer = sim.addCollider(g, 'hammer', { x: c.x, y: c.y, angle: this.thA, rotates: true, pieces, restitution: 0.6 }, L + hl / 2);
    sim.colMaterial[this.hammer] = 'titanium';
    const bw = c.stopWidth, R = c.reach;
    const stop = (angle: number, x0: number, y0: number, x1: number, y1: number) => {
      const id = sim.addCollider(g, 'stop', { x: c.x, y: c.y, angle, pieces: solidBlock(x0, y0, x1, y1), restitution: 0.6 }, R);
      sim.colMaterial[id] = 'titanium';
      this.stops.push(id);
    };
    stop(this.thA, L - hl / 2, -hw / 2 - bw, R, -hw / 2);
    stop(this.thA, -R, hw / 2, -L + hl / 2, hw / 2 + bw);
    stop(this.thB, L - hl / 2, hw / 2, R, hw / 2 + bw);
    stop(this.thB, -R, -hw / 2 - bw, -L + hl / 2, -hw / 2);
  }

  private get cycle(): number {
    return 2 * (this.cfg.hold + this.cfg.swingTime);
  }

  /** Hammer angle at time t, plus whether it's mid-swing and which way (+1 toward B). */
  pose(t: number): { th: number; swinging: boolean; dir: number } {
    const { hold, swingTime } = this.cfg;
    const tc = ((t % this.cycle) + this.cycle) % this.cycle;
    const d = this.thB - this.thA;
    if (tc < hold) return { th: this.thA, swinging: false, dir: 1 };
    if (tc < hold + swingTime) {
      const u = (tc - hold) / swingTime;
      return { th: this.thA + d * u * u, swinging: true, dir: 1 };
    }
    if (tc < 2 * hold + swingTime) return { th: this.thB, swinging: false, dir: -1 };
    const u = (tc - 2 * hold - swingTime) / swingTime;
    return { th: this.thB - d * u * u, swinging: true, dir: -1 };
  }

  beforeStep(): void {
    const sim = this.sim, w = sim.world;
    if (!w.colAlive[this.hammer]) return;
    const next = this.pose(sim.time + sim.dt);
    w.setColliderVelocity(this.hammer, 0, 0, (next.th - w.colAngle[this.hammer]) / sim.dt);
    const now = this.pose(sim.time);
    if (now.swinging && !next.swinging) {
      // Slam.
      this.lastSlam = sim.time;
      const c = this.cfg;
      const ct = dmath.cos(next.th), st = dmath.sin(next.th);
      sim.emit({ k: 'clank', x: c.x + ct * c.length, y: c.y + st * c.length, s: 1 });
      sim.emit({ k: 'clank', x: c.x - ct * c.length, y: c.y - st * c.length, s: 0.8 });
    }
    this.prevSwinging = now.swinging;
  }

  /** Local hammer-frame coords of a point for frame angle th. */
  private local(x: number, y: number, th: number): [number, number] {
    const dx = x - this.cfg.x, dy = y - this.cfg.y;
    const c = dmath.cos(th), s = dmath.sin(th);
    return [c * dx + s * dy, -s * dx + c * dy];
  }

  afterStep(): void {
    const sim = this.sim, w = sim.world;
    if (!w.colAlive[this.hammer]) {
      // Hammer gone (ring burst etc.): release everything.
      for (const i of this.hidden.keys()) this.reveal(i);
      return;
    }
    const th = w.colAngle[this.hammer];
    const pose = this.pose(sim.time);
    const { length: L, headLength: hl, headWidth: hw } = this.cfg;
    const hw2 = hw / 2;
    if (pose.swinging) {
      const target = pose.dir > 0 ? this.thB : this.thA;
      for (let i = 0; i < w.highWater; i++) {
        if (!sim.inPlay(i) || w.frozen[i]) continue;
        const r = w.r[i];
        const [lx, ly] = this.local(w.x[i], w.y[i], th);
        const head = lx > 0 ? 1 : -1;
        const hx = Math.abs(lx);
        if (hx < L - hl / 2 - r * 0.5 || hx > L + hl / 2 + r * 0.5) continue;
        // Which local side leads: top head moves +y toward B, bottom head moves -y.
        const lead = pose.dir * head;
        const [, lyT] = this.local(w.x[i], w.y[i], target);
        const ahead = lead > 0 ? ly - hw2 : -hw2 - ly;
        const toStop = lead > 0 ? hw2 - lyT : lyT + hw2;
        if (ahead < -r * 0.3 || toStop < -r * 0.3) continue;
        if (ahead + toStop < 2 * r * 0.98) this.hide(i, head, true);
      }
    }
    // Reveal swallowed balls once the head no longer covers them.
    if (this.hidden.size) {
      for (const [i, head] of this.hidden) {
        if (!w.alive[i]) { this.hidden.delete(i); continue; }
        const [lx, ly] = this.local(w.x[i], w.y[i], th);
        const dx = Math.max(0, Math.abs(lx - head * L) - hl / 2);
        const dy = Math.max(0, Math.abs(ly) - hw2);
        if (Math.hypot(dx, dy) >= w.r[i] * 0.9) this.reveal(i);
      }
    }
    // Fade revealed balls back in.
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] && !w.frozen[i] && sim.alpha[i] < 1) sim.alpha[i] = Math.min(1, sim.alpha[i] + sim.dt / 0.25);
    }
  }

  private hide(i: number, head: number, crushed: boolean): void {
    const sim = this.sim, w = sim.world;
    w.frozen[i] = 1;
    w.mask[i] = 0;
    w.vx[i] = 0;
    w.vy[i] = 0;
    sim.alpha[i] = 0;
    this.hidden.set(i, head);
    if (crushed) {
      this.crushQueue.push(i);
      sim.emit({ k: 'swallow', x: w.x[i], y: w.y[i], n: 1 });
    }
  }

  private reveal(i: number): void {
    const sim = this.sim, w = sim.world;
    this.hidden.delete(i);
    if (!w.alive[i]) return;
    w.frozen[i] = 0;
    w.mask[i] = sim.savedMask[i];
    w.soft[i] = 0.8;
    sim.alpha[i] = Math.max(sim.alpha[i], 0.05);
  }

  /** Copies of swallowed balls start swallowed too, next to the original. */
  onCreate(i: number, from: number): void {
    if (from < 0 || !this.hidden.has(from)) return;
    const sim = this.sim, w = sim.world;
    const a = sim.rng.range(0, dmath.TAU);
    w.x[i] = w.x[from] + dmath.cos(a) * w.r[from] * 0.5;
    w.y[i] = w.y[from] + dmath.sin(a) * w.r[from] * 0.5;
    this.hide(i, this.hidden.get(from)!, false);
  }

  fireCrushes(): void {
    if (!this.crushQueue.length) return;
    const q = this.crushQueue;
    this.crushQueue = [];
    const w = this.sim.world;
    for (const i of q) if (w.alive[i]) for (const f of this.sim.hooks.crushed) f(i, w.x[i], w.y[i]);
  }
}
