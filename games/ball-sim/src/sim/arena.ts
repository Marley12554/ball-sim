import { dmath } from '@engine/index';
import type { Sim } from './sim';

export const POWERUP_KINDS = ['red', 'green', 'cyan', 'magenta'] as const;
export type PowerupKind = (typeof POWERUP_KINDS)[number];
export const POWERUP_COLOR: Record<PowerupKind, string> = {
  red: '#FF4D5E', green: '#4ADE80', cyan: '#38E1F5', magenta: '#E359F0',
};

export const WEAPON_TYPES = ['sword', 'spear', 'hammer', 'match', 'rod', 'shield'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** Per-type numbers. Damage grows with hits landed or with time, so fights escalate. */
export const WEAPON_STATS: Record<WeaponType, { len: number; spin: number; dmg: number; knock: number; grow: number }> = {
  sword: { len: 3.3, spin: 4.4, dmg: 1, knock: 260, grow: 0.25 },
  spear: { len: 4.2, spin: 2.7, dmg: 1, knock: 220, grow: 0.08 },
  hammer: { len: 3.0, spin: 2.3, dmg: 2, knock: 560, grow: 0.25 },
  match: { len: 2.7, spin: 3.3, dmg: 0.5, knock: 140, grow: 0.5 },
  rod: { len: 2.9, spin: 2.1, dmg: 0.5, knock: 120, grow: 0.2 },
  shield: { len: 2.1, spin: 1.7, dmg: 1, knock: 380, grow: 0.5 },
};

/** What each weapon does, for the panel and the health cards. */
export const WEAPON_INFO: Record<WeaponType, { name: string; does: string; special: string; specialDoes: string }> = {
  sword: { name: 'Sword', does: 'Fast slashes. Every hit adds damage.', special: 'Whirlwind', specialDoes: 'Spins twice as fast and hits harder for a few seconds.' },
  spear: { name: 'Spear', does: 'Long reach that grows with hits. Hurts more at speed.', special: 'Lunge', specialDoes: 'Dashes at the nearest enemy. The next hit does triple damage.' },
  hammer: { name: 'Sledgehammer', does: 'Slow, heavy hits and huge knockback that keeps growing.', special: 'Quake', specialDoes: 'A shockwave that damages and throws back everyone nearby.' },
  match: { name: 'Match', does: 'Sets enemies on fire. Each hit adds burn time and leaves flames.', special: 'Inferno', specialDoes: 'Surrounds itself with a ring of fire.' },
  rod: { name: 'Lightning rod', does: 'Zaps the nearest enemy on a timer, chaining to a second.', special: 'Storm', specialDoes: 'Strikes every enemy in range at once.' },
  shield: { name: 'Shield', does: 'Blocks weapons and bashes. Gets stronger with every block.', special: 'Bulwark', specialDoes: 'Gains 3 shield and reflects damage for a few seconds.' },
};

/** Hits (or zaps and blocks) needed to charge a special. */
export const SPECIAL_CHARGE = 5;

export interface PickupCfg {
  kinds: PowerupKind[];
  min: number;
  max: number;
  size: number;
  area: number;
  cx: number;
  cy: number;
  collectors: Uint8Array | null;
  redTime: number;
}

export interface Pickup { x: number; y: number; kind: PowerupKind; born: number; alive: boolean }
export interface Flame { x: number; y: number; born: number; owner: number; team: number; r: number }

export interface WeaponCfg {
  holders: Uint8Array;
  type: WeaponType | 'random';
  teams: boolean;
}

/**
 * Arena systems: HP damage with shields and damage buffs, burning, powerup
 * pickups, orbiting weapons and ground flames. Deterministic: uses the sim's RNG.
 */
export class Arena {
  readonly shield: Int16Array;
  /** Up to 4 active damage buffs per body (expiry times). */
  readonly redUntil: Float64Array;
  readonly burnUntil: Float64Array;
  readonly burnDps: Float64Array;
  readonly lastHitBy: Int32Array;
  readonly wType: Int8Array;
  readonly wAngle: Float64Array;
  readonly wSpin: Float64Array;
  readonly wHits: Float64Array;
  readonly wTimer: Float64Array;
  readonly wTeams: Uint8Array;
  /** Special meter (0..SPECIAL_CHARGE) and when the active special ends. */
  readonly wCharge: Float64Array;
  readonly specUntil: Float64Array;
  pickups: Pickup[] = [];
  pickupCfg: PickupCfg | null = null;
  nextPickup = 0;
  weaponCfgs: WeaponCfg[] = [];
  flames: Flame[] = [];
  zaps: { x: number; y: number; x2: number; y2: number; t: number }[] = [];
  private cool = new Map<number, number>();

  constructor(private sim: Sim) {
    const n = sim.world.cap;
    this.shield = new Int16Array(n);
    this.redUntil = new Float64Array(n * 4);
    this.burnUntil = new Float64Array(n);
    this.burnDps = new Float64Array(n);
    this.lastHitBy = new Int32Array(n).fill(-1);
    this.wType = new Int8Array(n).fill(-1);
    this.wAngle = new Float64Array(n);
    this.wSpin = new Float64Array(n);
    this.wHits = new Float64Array(n);
    this.wTimer = new Float64Array(n);
    this.wTeams = new Uint8Array(n);
    this.wCharge = new Float64Array(n);
    this.specUntil = new Float64Array(n);
  }

  get active(): boolean {
    return this.pickupCfg !== null || this.weaponCfgs.length > 0 || this.flames.length > 0;
  }

  onCreate(i: number, from: number): void {
    this.shield[i] = 0;
    for (let k = 0; k < 4; k++) this.redUntil[i * 4 + k] = 0;
    this.burnUntil[i] = 0;
    this.burnDps[i] = 0;
    this.lastHitBy[i] = -1;
    this.wType[i] = -1;
    this.wHits[i] = 0;
    this.wCharge[i] = 0;
    this.specUntil[i] = 0;
    void from;
    const g = this.sim.world.group[i];
    for (const wc of this.weaponCfgs) if (wc.holders[g]) this.arm(i, wc);
  }

  arm(i: number, wc: WeaponCfg): void {
    const rng = this.sim.rng;
    const type = wc.type === 'random' ? WEAPON_TYPES[rng.int(WEAPON_TYPES.length)] : wc.type;
    this.wType[i] = WEAPON_TYPES.indexOf(type);
    this.wAngle[i] = rng.range(0, dmath.TAU);
    this.wSpin[i] = WEAPON_STATS[type].spin * (rng.chance(0.5) ? 1 : -1);
    this.wHits[i] = 0;
    this.wTimer[i] = 1.5;
    this.wTeams[i] = wc.teams ? 1 : 0;
  }

  redCount(i: number): number {
    const t = this.sim.time;
    let n = 0;
    for (let k = 0; k < 4; k++) if (this.redUntil[i * 4 + k] > t) n++;
    return n;
  }

  /** Deal damage. Attacker damage buffs add to it, shields soak it point by point. */
  damage(target: number, amount: number, attacker: number): void {
    const sim = this.sim;
    if (!sim.inPlay(target)) return;
    let total = amount + (attacker >= 0 ? this.redCount(attacker) : 0);
    let blocked = false;
    while (total >= 1 && this.shield[target] > 0) { this.shield[target]--; total -= 1; blocked = true; }
    if (total > 0) sim.hp[target] = Math.max(0, sim.hp[target] - total);
    // Bulwark reflects half of what gets through back at the attacker.
    if (attacker >= 0 && total > 0 && this.wType[target] === WEAPON_TYPES.indexOf('shield') && this.specUntil[target] > sim.time && sim.inPlay(attacker)) {
      sim.hp[attacker] = Math.max(0, sim.hp[attacker] - total / 2);
    }
    this.lastHitBy[target] = attacker;
    sim.emit({ k: 'damage', x: sim.world.x[target], y: sim.world.y[target], amount: total, blocked });
  }

  private enemies(i: number, j: number, teams: boolean): boolean {
    if (i === j) return false;
    if (!teams) return true;
    return this.sim.world.group[i] !== this.sim.world.group[j];
  }

  private cooldown(key: number, dur: number): boolean {
    const t = this.sim.time;
    const last = this.cool.get(key);
    if (last !== undefined && t - last < dur) return false;
    this.cool.set(key, t);
    return true;
  }

  step(): void {
    const sim = this.sim;
    const w = sim.world;
    const t = sim.time, dt = sim.dt;
    // Burning
    for (let i = 0; i < w.highWater; i++) {
      if (this.burnUntil[i] > t && sim.inPlay(i)) sim.hp[i] = Math.max(0, sim.hp[i] - this.burnDps[i] * dt);
    }
    if (this.pickupCfg) this.stepPickups();
    if (this.weaponCfgs.length) this.stepWeapons();
    if (this.flames.length) {
      this.flames = this.flames.filter((f) => t - f.born < 4);
      for (const f of this.flames) {
        const age = t - f.born;
        const dps = 0.3 + 0.35 * age;
        for (let j = 0; j < w.highWater; j++) {
          if (!sim.inPlay(j) || j === f.owner) continue;
          if (f.team >= 0 && w.group[j] === f.team) continue;
          const dx = w.x[j] - f.x, dy = w.y[j] - f.y;
          if (dx * dx + dy * dy < (f.r + w.r[j]) ** 2) sim.hp[j] = Math.max(0, sim.hp[j] - dps * dt);
        }
      }
    }
    if (this.zaps.length) this.zaps = this.zaps.filter((z) => t - z.t < 0.25);
  }

  /* ------------------------------ Pickups ------------------------------ */

  private stepPickups(): void {
    const sim = this.sim, cfg = this.pickupCfg!, w = sim.world, t = sim.time;
    if (this.nextPickup === 0) this.nextPickup = t + sim.rng.range(cfg.min, cfg.max) * 0.5;
    if (t >= this.nextPickup && cfg.kinds.length) {
      const kind = cfg.kinds[sim.rng.int(cfg.kinds.length)];
      const p = this.freeSpot(cfg.size * 4);
      this.pickups.push({ x: p.x, y: p.y, kind, born: t, alive: true });
      this.nextPickup = t + sim.rng.range(cfg.min, cfg.max);
    }
    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      for (let i = 0; i < w.highWater; i++) {
        if (!sim.inPlay(i)) continue;
        if (cfg.collectors && !cfg.collectors[w.group[i]]) continue;
        const reach = w.r[i] + cfg.size;
        if (Math.abs(w.x[i] - pk.x) < reach && Math.abs(w.y[i] - pk.y) < reach) {
          pk.alive = false;
          this.apply(i, pk.kind);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => p.alive);
  }

  apply(i: number, kind: PowerupKind): void {
    const sim = this.sim, w = sim.world, t = sim.time;
    sim.emit({ k: 'pickup', x: w.x[i], y: w.y[i], kind });
    switch (kind) {
      case 'red': {
        // Replace the oldest buff slot.
        let slot = 0;
        for (let k = 1; k < 4; k++) if (this.redUntil[i * 4 + k] < this.redUntil[i * 4 + slot]) slot = k;
        this.redUntil[i * 4 + slot] = t + (this.pickupCfg?.redTime ?? 2);
        break;
      }
      case 'green':
        sim.hp[i] = Math.min(Math.max(sim.maxHp[i], sim.hp[i]), sim.hp[i] + 1);
        break;
      case 'cyan':
        this.shield[i] = Math.min(9, this.shield[i] + 1);
        break;
      case 'magenta': {
        const p = this.freeSpot(w.r[i] * 4, i);
        sim.emit({ k: 'pickup', x: p.x, y: p.y, kind });
        w.x[i] = p.x;
        w.y[i] = p.y;
        break;
      }
    }
  }

  /** A random spot inside the pickup area, as far as possible from every fighter. */
  freeSpot(minDist: number, ignore = -1): { x: number; y: number } {
    const sim = this.sim, w = sim.world;
    const cfg = this.pickupCfg ?? { area: 200, cx: 0, cy: 0 } as PickupCfg;
    const a = cfg.area;
    let best = { x: cfg.cx, y: cfg.cy }, bestD = -1;
    for (let k = 0; k < 30; k++) {
      const x = cfg.cx + sim.rng.range(-a, a), y = cfg.cy + sim.rng.range(-a, a);
      let dmin = Infinity;
      for (let i = 0; i < w.highWater; i++) {
        if (!sim.inPlay(i) || i === ignore) continue;
        const d = Math.hypot(w.x[i] - x, w.y[i] - y) - w.r[i];
        if (d < dmin) dmin = d;
      }
      if (dmin > bestD) { bestD = dmin; best = { x, y }; }
      if (dmin > minDist) break;
    }
    return best;
  }

  /* ------------------------------ Weapons ------------------------------ */

  /** World segment of body i's weapon: [x0, y0, x1, y1]. */
  weaponSeg(i: number, out: number[]): void {
    const w = this.sim.world;
    const type = WEAPON_TYPES[this.wType[i]];
    const st = WEAPON_STATS[type];
    let len = st.len;
    if (type === 'spear') len = Math.min(5.6, st.len + st.grow * this.wHits[i]);
    const r = w.r[i];
    const c = dmath.cos(this.wAngle[i]), s = dmath.sin(this.wAngle[i]);
    const inner = type === 'shield' ? r * 1.15 : r * 0.9;
    out[0] = w.x[i] + c * inner; out[1] = w.y[i] + s * inner;
    out[2] = w.x[i] + c * r * len; out[3] = w.y[i] + s * r * len;
  }

  private stepWeapons(): void {
    const sim = this.sim, w = sim.world, t = sim.time, dt = sim.dt;
    const A = [0, 0, 0, 0], B = [0, 0, 0, 0];
    for (let i = 0; i < w.highWater; i++) {
      if (this.wType[i] < 0 || !sim.inPlay(i)) continue;
      const whirl = this.wType[i] === 0 && this.specUntil[i] > t ? 2.4 : 1;
      this.wAngle[i] += this.wSpin[i] * dt * whirl;
    }
    for (let i = 0; i < w.highWater; i++) {
      if (this.wType[i] < 0 || !sim.inPlay(i)) continue;
      const type = WEAPON_TYPES[this.wType[i]];
      const st = WEAPON_STATS[type];
      const teams = this.wTeams[i] === 1;
      this.weaponSeg(i, A);
      // Lightning rod: periodic zap at the nearest enemy, chaining once.
      if (type === 'rod') {
        this.wTimer[i] -= dt;
        if (this.wTimer[i] <= 0) {
          this.wTimer[i] = Math.max(1.2, 2.6 - 0.1 * this.wHits[i]);
          const j = this.nearestEnemy(i, A[2], A[3], w.r[i] * 10, -1, teams);
          if (j >= 0) {
            const dmg = 1 + st.grow * this.wHits[i];
            this.damage(j, dmg, i);
            this.zaps.push({ x: A[2], y: A[3], x2: w.x[j], y2: w.y[j], t });
            sim.emit({ k: 'zap', x: A[2], y: A[3], x2: w.x[j], y2: w.y[j] });
            const k2 = this.nearestEnemy(i, w.x[j], w.y[j], w.r[i] * 6, j, teams);
            if (k2 >= 0) {
              this.damage(k2, dmg / 2, i);
              this.zaps.push({ x: w.x[j], y: w.y[j], x2: w.x[k2], y2: w.y[k2], t });
            }
            this.wHits[i]++;
            this.charge(i, teams);
          }
        }
      }
      for (let j = 0; j < w.highWater; j++) {
        if (j === i || !sim.inPlay(j) || !this.enemies(i, j, teams)) continue;
        // Weapon vs weapon: clash, both spins reverse.
        if (this.wType[j] >= 0 && j > i) {
          this.weaponSeg(j, B);
          if (segDist(A, B) < 7 && this.cooldown(pairKey(i, j) * 2 + 1, 0.3)) {
            this.wSpin[i] = -this.wSpin[i];
            this.wSpin[j] = -this.wSpin[j];
            const mx = (A[2] + B[2]) / 2, my = (A[3] + B[3]) / 2;
            sim.emit({ k: 'clash', x: mx, y: my });
            if (WEAPON_TYPES[this.wType[j]] === 'shield') { this.wHits[j]++; this.charge(j, this.wTeams[j] === 1); }
            if (type === 'shield') { this.wHits[i]++; this.charge(i, teams); }
            continue;
          }
        }
        // Weapon vs body.
        const d = pointSegDist(w.x[j], w.y[j], A);
        if (d > w.r[j] + 4) continue;
        if (!this.cooldown(pairKey(i, j) * 2, 0.45)) continue;
        let dmg = st.dmg;
        if (type === 'sword' || type === 'hammer') dmg += st.grow * this.wHits[i];
        if (type === 'spear') dmg += Math.min(2, Math.hypot(w.vx[i] - w.vx[j], w.vy[i] - w.vy[j]) / 400);
        if (type === 'shield') dmg += 0.5 * Math.floor(this.wHits[i] / 2);
        const active = this.specUntil[i] > t;
        if (active && type === 'sword') dmg += 1;
        if (active && type === 'spear') { dmg *= 3; this.specUntil[i] = 0; }
        this.damage(j, dmg, i);
        if (type === 'match') {
          this.burnUntil[j] = Math.max(this.burnUntil[j], t) + (this.burnUntil[j] > t ? 0.5 : 3);
          this.burnDps[j] = 1;
          this.flames.push({ x: w.x[j], y: w.y[j], born: t, owner: i, team: teams ? w.group[i] : -1, r: w.r[i] * 0.9 });
        }
        this.wHits[i]++;
        this.charge(i, teams);
        const kx = w.x[j] - w.x[i], ky = w.y[j] - w.y[i];
        const kl = Math.hypot(kx, ky) || 1;
        const knock = st.knock * (type === 'hammer' ? 1 + 0.1 * this.wHits[i] : 1);
        if (w.invMass[j] > 0) { w.vx[j] += (kx / kl) * knock; w.vy[j] += (ky / kl) * knock; }
        sim.emit({ k: 'clash', x: w.x[j], y: w.y[j] });
      }
    }
  }

  /** Add charge; a full meter fires the weapon's special. */
  private charge(i: number, teams: boolean): void {
    if (this.specUntil[i] > this.sim.time) return;
    this.wCharge[i] += 1;
    if (this.wCharge[i] >= SPECIAL_CHARGE) {
      this.wCharge[i] = 0;
      this.special(i, teams);
    }
  }

  private special(i: number, teams: boolean): void {
    const sim = this.sim, w = sim.world, t = sim.time;
    const type = WEAPON_TYPES[this.wType[i]];
    const info = WEAPON_INFO[type];
    sim.emit({ k: 'special', x: w.x[i], y: w.y[i], kind: type, name: info.special });
    const r = w.r[i];
    switch (type) {
      case 'sword':
        this.specUntil[i] = t + 3;
        break;
      case 'spear': {
        this.specUntil[i] = t + 2.5;
        const j = this.nearestEnemy(i, w.x[i], w.y[i], 1e9, -1, teams);
        if (j >= 0) {
          const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i], d = Math.hypot(dx, dy) || 1;
          w.vx[i] = (dx / d) * 900; w.vy[i] = (dy / d) * 900;
          this.wAngle[i] = dmath.atan2(dy, dx);
        }
        break;
      }
      case 'hammer':
        for (let j = 0; j < w.highWater; j++) {
          if (!sim.inPlay(j) || !this.enemies(i, j, teams)) continue;
          const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i], d = Math.hypot(dx, dy) || 1;
          if (d > r * 8) continue;
          this.damage(j, 2, i);
          const k = 800 * (1 - d / (r * 8)) + 200;
          if (w.invMass[j] > 0) { w.vx[j] += (dx / d) * k; w.vy[j] += (dy / d) * k; }
        }
        sim.flash.push({ x: w.x[i], y: w.y[i], r: r * 8, t });
        sim.emit({ k: 'boom', x: w.x[i], y: w.y[i], big: false });
        break;
      case 'match':
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * dmath.TAU;
          this.flames.push({ x: w.x[i] + dmath.cos(a) * r * 3, y: w.y[i] + dmath.sin(a) * r * 3, born: t, owner: i, team: teams ? w.group[i] : -1, r: r * 1.1 });
        }
        break;
      case 'rod':
        for (let j = 0; j < w.highWater; j++) {
          if (!sim.inPlay(j) || !this.enemies(i, j, teams)) continue;
          if (Math.hypot(w.x[j] - w.x[i], w.y[j] - w.y[i]) > r * 16) continue;
          this.damage(j, 2 + 0.2 * this.wHits[i], i);
          this.zaps.push({ x: w.x[i], y: w.y[i], x2: w.x[j], y2: w.y[j], t });
          sim.emit({ k: 'zap', x: w.x[i], y: w.y[i], x2: w.x[j], y2: w.y[j] });
        }
        break;
      case 'shield':
        this.shield[i] = Math.min(9, this.shield[i] + 3);
        this.specUntil[i] = t + 3;
        break;
    }
  }

  private nearestEnemy(i: number, x: number, y: number, maxD: number, skip: number, teams: boolean): number {
    const sim = this.sim, w = sim.world;
    let best = -1, bd = maxD * maxD;
    for (let j = 0; j < w.highWater; j++) {
      if (j === skip || !sim.inPlay(j) || !this.enemies(i, j, teams)) continue;
      const d = (w.x[j] - x) ** 2 + (w.y[j] - y) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }
}

function pairKey(i: number, j: number): number {
  return i * 65536 + j;
}

function pointSegDist(px: number, py: number, s: number[]): number {
  const ex = s[2] - s[0], ey = s[3] - s[1];
  const L2 = ex * ex + ey * ey;
  let u = L2 > 0 ? ((px - s[0]) * ex + (py - s[1]) * ey) / L2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - (s[0] + ex * u), py - (s[1] + ey * u));
}

function segDist(a: number[], b: number[]): number {
  return Math.min(
    pointSegDist(a[0], a[1], b), pointSegDist(a[2], a[3], b),
    pointSegDist(b[0], b[1], a), pointSegDist(b[2], b[3], a),
  );
}
