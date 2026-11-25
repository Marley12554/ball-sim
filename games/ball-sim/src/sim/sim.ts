import {
  World, Rng, Dispatcher, compileGraph, withDefaults, dmath,
  CONTACT_WALL, CONTACT_BODY, CONTACT_TETHER,
} from '@engine/index';
import type { CompiledNode, CompiledTrigger, Params, BlockSpec } from '@engine/index';
import { registry } from './blocks';
import type { ObjectBlock, TriggerBlock, FilterBlock, ActionBlock } from './blocks/types';
import { LookPicker, lookKey, lookName, lookColor, DEFAULT_LOOK } from './looks';
import type { Fx, Look, LookSetting, SimDef, SimEvent } from './types';
import { DEFAULT_SETTINGS, NONE, isBody, isCollider, isZone, colliderOf, colliderRef, zoneOf, zoneRef } from './types';
import { Arena } from './arena';
import { Sledge } from './sledge';

export interface GroupInfo {
  index: number;
  nodeId: string;
  kind: string;
  name: string;
  params: Params;
  /** Mutable spawn template (balls). Actions can change it for future spawns. */
  template: Params;
  picker: LookPicker | null;
  color: string;
  made: number;
}

export interface Zone {
  group: number;
  shape: 'circle' | 'box';
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  color: string;
  visible: boolean;
  alive: boolean;
  label: string;
}

export interface Motion {
  type: 'none' | 'spin' | 'swing' | 'slide';
  rate: number;
  base: number;
  amp: number;
  period: number;
  phase: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
}

export interface CounterInfo {
  nodeId: string;
  name: string;
  value: number;
  show: boolean;
  /** When set, the counter shows the live size of this group instead of a stored value. */
  countGroup: number;
  place: 'corner' | 'center';
}

export interface SpawnReq {
  group: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Copy size/look/hp from this body index (duplicate). -1 = from template. */
  from: number;
  /** Size override (split). 0 = none. */
  r?: number;
}

/** Ring metadata kept so a ring can change size while its gaps keep a fixed width. */
export interface RingMeta {
  group: number;
  gaps: { at: number; len: number }[];
  /** Index of this ring within its group (0 = innermost). */
  k: number;
}

const FX_CAP = 1500;

export class Sim {
  readonly def: SimDef;
  readonly world: World;
  readonly rng: Rng;
  readonly lookRng: Rng;
  readonly dispatcher: Dispatcher<SimEvent>;
  readonly triggers: CompiledTrigger[];
  readonly dt: number;
  readonly settings: typeof DEFAULT_SETTINGS;

  groups: GroupInfo[] = [];
  groupByNode = new Map<string, number>();
  counters = new Map<string, CounterInfo>();
  zones: Zone[] = [];
  outcome: { label: string; time: number } | null = null;
  /** Seconds since the outcome. */
  sinceEnd = 0;
  /** Seconds spent in the starting pose so far. */
  preTime = 0;
  assets: Record<string, string>;
  /** Visual/audio events. Only collected when someone is watching (fxOn). */
  fx: Fx[] = [];
  fxOn = false;
  /** Recent explosions, for the renderer. */
  flash: { x: number; y: number; r: number; t: number }[] = [];

  /* Per-body extras */
  readonly look: Int32Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly born: Float64Array;
  readonly nameIdx: Int32Array;
  readonly pendingDead: Uint8Array;
  /** 1 for bodies created by Duplicate. */
  readonly isCopy: Uint8Array;
  /** Render opacity (hidden bodies fade back in). */
  readonly alpha: Float32Array;
  /** Out of play: falling off the screen. Value is the time it started falling (0 = in play). */
  readonly fallT: Float64Array;
  /** Mask a body had before being hidden or dropped. */
  readonly savedMask: Uint32Array;
  readonly tSeq: Float64Array;
  private tSeqNext = 1;
  /* Progress around the center, for "stalled" (spiral). */
  needProgress = false;
  private progAng: Float64Array;
  private progUnwrap: Float64Array;
  private progBest: Float64Array;
  private progBestT: Float64Array;
  names: string[] = [];
  looks: Look[] = [];
  private lookIndex = new Map<string, number>();

  /* Per-collider extras */
  colKind: string[] = [];
  colColor: string[] = [];
  colRadius: number[] = [];
  colMotion: Motion[] = [];
  colMaterial: string[] = [];
  /** Palette swept around a collider's center (single rings, spirals). */
  colGrad: (string[] | undefined)[] = [];
  colGradCenter: ([number, number] | undefined)[] = [];
  ringMeta: (RingMeta | undefined)[] = [];

  /** Arena systems: statuses, pickups, weapons, flames. */
  readonly arena: Arena;
  readonly sledges: Sledge[] = [];
  /** Ring stacks that close the hole after a breakout. */
  snapBack: { group: number; order: number[]; ptr: number; R0: number; spacing: number; anim: { t0: number; dur: number; cols: number[]; from: number[]; to: number[] } | null }[] = [];

  readonly hooks = {
    step: [] as (() => void)[],
    wall: [] as ((i: number, col: number, k: number) => void)[],
    body: [] as ((a: number, b: number, k: number) => void)[],
    tether: [] as ((i: number, owner: number, t: number, k: number) => void)[],
    spawned: [] as ((h: number, group: number) => void)[],
    destroyed: [] as ((h: number, group: number, x: number, y: number) => void)[],
    tetherLost: [] as ((owner: number) => void)[],
    crushed: [] as ((i: number, x: number, y: number) => void)[],
    freed: [] as ((i: number) => void)[],
    afterBuild: [] as (() => void)[],
  };

  private destroyQueue: number[] = [];
  private spawnQueue: SpawnReq[] = [];
  private scheduled: { t: number; req: SpawnReq }[] = [];
  private spawnedEv: { h: number; g: number }[] = [];
  private destroyedEv: { h: number; g: number; x: number; y: number }[] = [];
  private tetherLostEv: number[] = [];
  private fxBounces = 0;

  /** Reused event object. Actions must not keep references to it. */
  readonly e: SimEvent = { self: NONE, other: NONE, px: 0, py: 0, nx: 0, ny: 0, tether: NONE, speed: 0 };

  constructor(def: SimDef) {
    this.def = def;
    const s = (this.settings = { ...DEFAULT_SETTINGS, ...def.settings });
    this.rng = new Rng(def.seed);
    this.lookRng = new Rng((def.seed ^ 0x5bd1e995) >>> 0);
    this.assets = def.assets ?? {};
    const cap = Math.max(16, Math.min(50000, s.maxObjects | 0));
    const ga = (s.gravityAngle * dmath.PI) / 180;
    this.world = new World({
      capacity: cap,
      tetherCapacity: Math.min(60000, cap * 6),
      contactCapacity: Math.min(60000, cap * 4),
      gravityMode: s.gravityMode,
      gravityX: s.gravityMode === 'point' ? s.gravity : dmath.cos(ga) * s.gravity,
      gravityY: s.gravityMode === 'point' ? 0 : dmath.sin(ga) * s.gravity,
      maxSpeed: s.speedLimit,
      cellSize: 28,
      maxSubsteps: 48,
      minImpactSpeed: 6,
      pairCorrection: s.pairCorrection,
      restThreshold: s.restThreshold,
    });
    this.dt = this.world.cfg.dt;
    this.look = new Int32Array(cap);
    this.hp = new Float64Array(cap);
    this.maxHp = new Float64Array(cap);
    this.born = new Float64Array(cap);
    this.nameIdx = new Int32Array(cap).fill(-1);
    this.pendingDead = new Uint8Array(cap);
    this.isCopy = new Uint8Array(cap);
    this.alpha = new Float32Array(cap).fill(1);
    this.fallT = new Float64Array(cap);
    this.savedMask = new Uint32Array(cap);
    this.progAng = new Float64Array(cap);
    this.progUnwrap = new Float64Array(cap);
    this.progBest = new Float64Array(cap);
    this.progBestT = new Float64Array(cap);
    this.tSeq = new Float64Array(this.world.tetherCap);
    this.arena = new Arena(this);

    this.dispatcher = new Dispatcher<SimEvent>({
      test: (n, e) => (registry.get(n.type) as FilterBlock).test(this, n, e),
      run: (n, e) => (registry.get(n.type) as ActionBlock).run(this, n, e),
    });

    const imageIds = Object.keys(this.assets);
    for (const n of def.graph.nodes) {
      const spec = registry.get(n.type);
      if (spec?.category !== 'object') continue;
      const params = withDefaults(spec, n.params);
      if (spec.kind === 'counter') {
        this.counters.set(n.id, { nodeId: n.id, name: params.name, value: Number(params.initial) || 0, show: !!params.show, countGroup: -1, place: params.place === 'center' ? 'center' : 'corner' });
        continue;
      }
      const index = this.groups.length;
      const look: LookSetting | undefined = params.look;
      const g: GroupInfo = {
        index, nodeId: n.id, kind: spec.kind!, name: params.name || spec.label, params,
        template: { ...params },
        picker: spec.kind === 'ball' ? new LookPicker(look ?? DEFAULT_LOOK, this.lookRng, imageIds, Number(params.count) || 1) : null,
        color: params.color ?? '#E7E9EC',
        made: 0,
      };
      this.groups.push(g);
      this.groupByNode.set(n.id, index);
    }
    // Counters that show a group's size.
    for (const n of def.graph.nodes) {
      if (n.type !== 'counter') continue;
      const c = this.counters.get(n.id)!;
      const p = withDefaults(registry.get('counter')!, n.params);
      if (p.source === 'count') c.countGroup = this.groupByNode.get(p.group) ?? -1;
    }
    for (const g of this.groups) (registry.get(def.graph.nodes.find((n) => n.id === g.nodeId)!.type) as ObjectBlock).build?.(this, g);
    for (const f of this.hooks.afterBuild) f();

    this.triggers = compileGraph(def.graph, registry);
    for (const t of this.triggers) (registry.get(t.type) as TriggerBlock).setup(this, t);
    if (this.needProgress) for (let i = 0; i < this.world.highWater; i++) if (this.world.alive[i]) this.resetProgress(i);
  }

  get time(): number {
    return this.world.time;
  }

  /** 0..1 through the starting pose; 1 once running. */
  get readiness(): number {
    const d = this.settings.startDelay;
    return d > 0 ? Math.min(1, this.preTime / d) : 1;
  }

  emit(f: Fx): void {
    if (this.fxOn && this.fx.length < FX_CAP) this.fx.push(f);
  }

  /* --------------------------- Groups ----------------------------- */

  groupOf(nodeId: string): GroupInfo | undefined {
    const i = this.groupByNode.get(nodeId);
    return i === undefined ? undefined : this.groups[i];
  }

  groupMask(nodeIds: string[]): Uint8Array {
    const m = new Uint8Array(Math.max(1, this.groups.length));
    for (const id of nodeIds) {
      const g = this.groupByNode.get(id);
      if (g !== undefined) m[g] = 1;
    }
    return m;
  }

  /** In play: alive, not queued for removal, not falling off. */
  inPlay(i: number): boolean {
    return this.world.alive[i] === 1 && !this.pendingDead[i] && this.fallT[i] === 0;
  }

  groupOfRef(ref: number): number {
    if (isBody(ref)) {
      const i = this.world.indexOf(ref);
      return i >= 0 ? this.world.group[i] : -1;
    }
    if (isCollider(ref)) {
      const c = colliderOf(ref);
      return this.world.colAlive[c] ? this.world.colGroup[c] : -1;
    }
    if (isZone(ref)) {
      const z = this.zones[zoneOf(ref)];
      return z && z.alive ? z.group : -1;
    }
    return -1;
  }

  /** Live, in-play body index for a ref. */
  bodyIdx(ref: number): number {
    if (!isBody(ref)) return -1;
    const i = this.world.indexOf(ref);
    return i >= 0 && this.inPlay(i) ? i : -1;
  }

  refAlive(ref: number): boolean {
    if (isBody(ref)) return this.bodyIdx(ref) >= 0;
    if (isCollider(ref)) return !!this.world.colAlive[colliderOf(ref)];
    if (isZone(ref)) return !!this.zones[zoneOf(ref)]?.alive;
    return false;
  }

  membersOf(g: number, out: number[] = []): number[] {
    out.length = 0;
    const w = this.world;
    const info = this.groups[g];
    if (!info) return out;
    if (info.kind === 'ball') {
      for (let i = 0; i < w.highWater; i++) if (this.inPlay(i) && w.group[i] === g) out.push(w.handleAt(i));
    } else if (info.kind === 'zone') {
      this.zones.forEach((z, i) => { if (z.alive && z.group === g) out.push(zoneRef(i)); });
    } else {
      for (let c = 0; c < w.colAlive.length; c++) if (w.colAlive[c] && w.colGroup[c] === g) out.push(colliderRef(c));
    }
    return out;
  }

  countGroup(g: number): number {
    const w = this.world;
    const info = this.groups[g];
    if (!info) return 0;
    let n = 0;
    if (info.kind === 'ball') {
      for (let i = 0; i < w.highWater; i++) if (this.inPlay(i) && w.group[i] === g) n++;
    } else if (info.kind === 'zone') {
      for (const z of this.zones) if (z.alive && z.group === g) n++;
    } else {
      for (let c = 0; c < w.colAlive.length; c++) if (w.colAlive[c] && w.colGroup[c] === g) n++;
    }
    return n;
  }

  countAllBalls(): number {
    const w = this.world;
    let n = 0;
    for (let i = 0; i < w.highWater; i++) if (this.inPlay(i)) n++;
    return n;
  }

  /** First ball group (spawn controls, camera). */
  mainBallGroup(): GroupInfo | undefined {
    return this.groups.find((g) => g.kind === 'ball');
  }

  /* ---------------------------- Looks ----------------------------- */

  lookId(l: Look): number {
    const k = lookKey(l);
    let id = this.lookIndex.get(k);
    if (id === undefined) {
      id = this.looks.length;
      this.looks.push(l);
      this.lookIndex.set(k, id);
    }
    return id;
  }

  nameOf(ref: number): string {
    const i = isBody(ref) ? this.world.indexOf(ref) : -1;
    if (i >= 0 && this.nameIdx[i] >= 0) return this.names[this.nameIdx[i]];
    const g = this.groupOfRef(ref);
    return g >= 0 ? this.groups[g].name : '';
  }

  bodyColor(i: number): string {
    return lookColor(this.looks[this.look[i]] ?? { t: 'solid', c: '#E7E9EC' });
  }

  /* --------------------------- Spawning --------------------------- */

  createBall(g: GroupInfo, x: number, y: number, vx: number, vy: number, from = -1, rOverride = 0): number {
    const w = this.world;
    const t = g.template;
    const r = rOverride > 0 ? rOverride : from >= 0 ? w.r[from] : Math.max(0.5, Number(t.radius) || 6);
    const density = Math.max(0.001, Number(t.density) || 1);
    const collide = t.collide !== false;
    const mask = collide ? 0xffffffff : 0xfffffffe;
    const h = w.createBody({
      x, y, vx, vy, radius: r,
      mass: density * r * r,
      restitution: from >= 0 ? w.restitution[from] : Number(t.bounciness ?? 1),
      damping: from >= 0 ? w.damping[from] : Number(t.drag) || 0,
      gravityScale: from >= 0 ? w.gravityScale[from] : Number(t.gravity ?? 1),
      layer: 1,
      mask,
      group: g.index,
      shape: t.shape === 'square' ? 'box' : 'circle',
    });
    if (h < 0) return -1;
    const i = w.indexOf(h);
    this.savedMask[i] = mask;
    this.alpha[i] = 1;
    this.fallT[i] = 0;
    this.isCopy[i] = from >= 0 ? 1 : 0;
    if (from >= 0) {
      this.look[i] = this.look[from];
      this.hp[i] = this.hp[from];
      this.maxHp[i] = this.maxHp[from];
      this.nameIdx[i] = this.nameIdx[from];
      w.shape[i] = w.shape[from];
    } else {
      const look = g.picker ? g.picker.next() : { t: 'solid' as const, c: '#F4F1EA' };
      this.look[i] = this.lookId(look);
      const hp = Number(t.hp) || 0;
      this.hp[i] = hp;
      this.maxHp[i] = hp;
      g.made++;
      const nm = lookName(look) ?? (Number(t.count) > 1 || g.made > 1 ? `${g.name} ${g.made}` : g.name);
      this.nameIdx[i] = this.names.push(nm) - 1;
    }
    this.born[i] = this.time;
    this.pendingDead[i] = 0;
    this.arena.onCreate(i, from);
    for (const sl of this.sledges) sl.onCreate(i, from);
    if (this.needProgress) this.resetProgress(i);
    return h;
  }

  queueSpawn(req: SpawnReq): void {
    this.spawnQueue.push(req);
  }

  scheduleSpawn(at: number, req: SpawnReq): void {
    this.scheduled.push({ t: at, req });
  }

  queueDestroy(ref: number): void {
    if (isBody(ref)) {
      const i = this.world.indexOf(ref);
      if (i < 0 || this.pendingDead[i]) return;
      this.pendingDead[i] = 1;
    }
    this.destroyQueue.push(ref);
  }

  /** Take a body out of play: it falls off the screen toward the viewer, then is removed. */
  dropOut(i: number): void {
    const w = this.world;
    if (!this.inPlay(i)) return;
    this.fallT[i] = Math.max(1e-6, this.time);
    w.mask[i] = 0;
    this.emit({ k: 'fall', x: w.x[i], y: w.y[i] });
  }

  /** Spawn n extra balls of the main group now (viewer controls). Returns how many were queued. */
  spawnExtra(n: number): number {
    const g = this.mainBallGroup();
    if (!g) return 0;
    const P = { x: 0, y: 0 }, V = { x: 0, y: 0 };
    for (let k = 0; k < n; k++) {
      this.spawnPoint(g, g.made + k, Math.max(n, Number(g.template.count) || 1), P);
      this.spawnVelocity(g, P.x, P.y, V);
      this.queueSpawn({ group: g.index, x: P.x, y: P.y, vx: V.x, vy: V.y, from: -1 });
    }
    return n;
  }

  spawnPoint(g: GroupInfo, k: number, n: number, out: { x: number; y: number }): void {
    const t = g.template;
    const cx = Number(t.x) || 0, cy = Number(t.y) || 0;
    const spread = Number(t.spread) || 0;
    switch (t.placement) {
      case 'scatter': {
        const a = this.rng.range(0, dmath.TAU);
        const d = spread * dmath.sqrt(this.rng.next());
        out.x = cx + dmath.cos(a) * d; out.y = cy + dmath.sin(a) * d;
        return;
      }
      case 'spaced': {
        // Random spots inside a square of half-size `spread`, kept apart from existing balls.
        const w = this.world;
        const r = Number(t.radius) || 8;
        let bx = cx, by = cy, bestD = -1;
        for (let tries = 0; tries < 40; tries++) {
          const x = cx + this.rng.range(-spread, spread), y = cy + this.rng.range(-spread, spread);
          let dmin = Infinity;
          for (let i = 0; i < w.highWater; i++) {
            if (!w.alive[i]) continue;
            const d = (w.x[i] - x) ** 2 + (w.y[i] - y) ** 2;
            if (d < dmin) dmin = d;
          }
          if (dmin > bestD) { bestD = dmin; bx = x; by = y; }
          if (dmin > (r * 6) ** 2) break;
        }
        out.x = bx; out.y = by;
        return;
      }
      case 'circle': {
        const a = (k / Math.max(1, n)) * dmath.TAU - dmath.HALF_PI;
        out.x = cx + dmath.cos(a) * spread; out.y = cy + dmath.sin(a) * spread;
        return;
      }
      case 'line': {
        const u = n > 1 ? k / (n - 1) - 0.5 : 0;
        out.x = cx + u * spread * 2; out.y = cy;
        return;
      }
      case 'grid': {
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        const rows = Math.ceil(n / cols);
        const step = cols > 1 ? (spread * 2) / (cols - 1) : 0;
        out.x = cx + (k % cols) * step - (cols > 1 ? spread : 0);
        out.y = cy + Math.floor(k / cols) * step - ((rows - 1) * step) / 2;
        return;
      }
      default:
        out.x = cx; out.y = cy;
    }
  }

  spawnVelocity(g: GroupInfo, x: number, y: number, out: { x: number; y: number }): void {
    const t = g.template;
    const base = Number(t.speed) || 0;
    const jitter = Number(t.speedJitter) || 0;
    const speed = Math.max(0, base + (jitter ? this.rng.range(-jitter, jitter) : 0));
    const dx = x - (Number(t.x) || 0), dy = y - (Number(t.y) || 0);
    let a: number;
    switch (t.direction) {
      case 'angle': a = ((Number(t.angle) || 0) * dmath.PI) / 180; break;
      case 'outward': a = dx || dy ? dmath.atan2(dy, dx) : this.rng.range(0, dmath.TAU); break;
      case 'inward': a = dx || dy ? dmath.atan2(-dy, -dx) : this.rng.range(0, dmath.TAU); break;
      case 'tangent': a = (dx || dy ? dmath.atan2(dy, dx) : 0) + dmath.HALF_PI; break;
      case 'skew': {
        // Random, but never close to straight along an axis or diagonal (no ping-pong tracks).
        const sector = this.rng.int(8);
        a = (sector * dmath.PI) / 4 + this.rng.range(0.2, dmath.PI / 4 - 0.2);
        break;
      }
      default: a = this.rng.range(0, dmath.TAU);
    }
    out.x = dmath.cos(a) * speed;
    out.y = dmath.sin(a) * speed;
  }

  /* ---------------------------- Values ---------------------------- */

  prop(ref: number, name: string): number {
    const w = this.world;
    if (isBody(ref)) {
      const i = this.bodyIdx(ref);
      if (i < 0) return NaN;
      switch (name) {
        case 'speed': return dmath.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]);
        case 'size': return w.r[i];
        case 'hp': return this.hp[i];
        case 'tethers': return w.tetherCount[i];
        case 'age': return this.time - this.born[i];
        case 'bounciness': return w.restitution[i];
        case 'x': return w.x[i];
        case 'y': return w.y[i];
        case 'dist': return dmath.sqrt(w.x[i] * w.x[i] + w.y[i] * w.y[i]);
        case 'stall': return this.time - this.progBestT[i];
        case 'copy': return this.isCopy[i];
        case 'shield': return this.arena.shield[i];
        default: return NaN;
      }
    }
    if (isCollider(ref)) {
      const c = colliderOf(ref);
      if (!w.colAlive[c]) return NaN;
      if (name === 'spin') return (this.colMotion[c].rate * 180) / dmath.PI;
      if (name === 'size') return w.colRadial[c] ? w.colRingR[c] : this.colRadius[c];
      if (name === 'bounciness') return w.colRest[c];
    }
    return NaN;
  }

  private resetProgress(i: number): void {
    const w = this.world;
    this.progAng[i] = dmath.atan2(w.y[i], w.x[i]);
    this.progUnwrap[i] = 0;
    this.progBest[i] = 0;
    this.progBestT[i] = this.time;
  }

  private trackProgress(): void {
    const w = this.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!this.inPlay(i)) continue;
      const a = dmath.atan2(w.y[i], w.x[i]);
      let d = a - this.progAng[i];
      if (d > dmath.PI) d -= dmath.TAU; else if (d < -dmath.PI) d += dmath.TAU;
      this.progAng[i] = a;
      this.progUnwrap[i] += d;
      const p = Math.abs(this.progUnwrap[i]);
      if (p > this.progBest[i] + 0.15) { this.progBest[i] = p; this.progBestT[i] = this.time; }
    }
  }

  /** Fraction of a container's area covered by visible balls (0..1+). */
  fillRatio(g: number): number {
    const w = this.world;
    let cx = 0, cy = 0, R = 0, found = false;
    for (let c = 0; c < w.colAlive.length && !found; c++) {
      if (!w.colAlive[c] || w.colGroup[c] !== g) continue;
      cx = w.colX[c]; cy = w.colY[c];
      R = (w.colRadial[c] ? w.colRingR[c] : this.colRadius[c]) * w.colScale[c];
      found = true;
    }
    if (!found) {
      const z = this.zones.find((zz) => zz.alive && zz.group === g);
      if (!z) return 0;
      cx = z.x; cy = z.y; R = z.shape === 'circle' ? z.r : Math.min(z.w, z.h) / 2;
    }
    if (R <= 0) return 0;
    let area = 0;
    const R2 = R * R;
    for (let i = 0; i < w.highWater; i++) {
      if (!this.inPlay(i) || w.frozen[i]) continue;
      const dx = w.x[i] - cx, dy = w.y[i] - cy;
      if (dx * dx + dy * dy < R2) area += w.r[i] * w.r[i];
    }
    return area / R2;
  }

  /* --------------------------- Counters --------------------------- */

  counter(nodeId: string): CounterInfo | undefined {
    return this.counters.get(nodeId);
  }

  counterValue(c: CounterInfo): number {
    return c.countGroup >= 0 ? this.countGroup(c.countGroup) : c.value;
  }

  /* --------------------------- Tethers ---------------------------- */

  noteTether(h: number): void {
    const t = this.world.tetherIndexOf(h);
    if (t >= 0) this.tSeq[t] = this.tSeqNext++;
  }

  cutTetherIndex(t: number): void {
    const w = this.world;
    if (!w.tAlive[t]) return;
    const owner = w.tBody[t];
    const other = w.tKind[t] === 2 ? w.tRef[t] : -1;
    w.removeTetherIndex(t);
    this.tetherLostEv.push(w.handleAt(owner));
    if (other >= 0) this.tetherLostEv.push(w.handleAt(other));
  }

  /* ----------------------------- End ------------------------------ */

  end(label: string): void {
    if (!this.outcome) {
      this.outcome = { label, time: this.time };
      this.emit({ k: 'end', label });
    }
  }

  /* ----------------------------- Step ----------------------------- */

  private fillEvent(self: number, other: number, px: number, py: number, nx: number, ny: number, tether: number, speed: number): SimEvent {
    const e = this.e;
    e.self = self; e.other = other; e.px = px; e.py = py; e.nx = nx; e.ny = ny; e.tether = tether; e.speed = speed;
    return e;
  }

  fire(t: CompiledTrigger, self: number, other = NONE, px = 0, py = 0, nx = 0, ny = 0, tether = NONE, speed = 0): void {
    if (this.outcome) return;
    if (self !== NONE && !this.refAlive(self)) return;
    this.dispatcher.fire(t, self, this.time, this.fillEvent(self, other, px, py, nx, ny, tether, speed));
  }

  fireDead(t: CompiledTrigger, self: number, px: number, py: number): void {
    if (this.outcome) return;
    this.dispatcher.fire(t, self, this.time, this.fillEvent(self, NONE, px, py, 0, 0, NONE, 0));
  }

  step(): void {
    const w = this.world;
    if (this.preTime < this.settings.startDelay) {
      this.preTime += this.dt;
      return;
    }
    this.applyMotion();
    for (const sl of this.sledges) sl.beforeStep();
    w.step();
    this.updateFalling();
    for (const sl of this.sledges) sl.afterStep();
    this.arena.step();
    if (this.fxOn) this.collectContactFx();
    if (this.outcome) {
      this.sinceEnd += this.dt;
      this.flush();
      return;
    }
    if (this.needProgress) this.trackProgress();
    this.dispatcher.beginStep();

    if (this.spawnedEv.length || this.destroyedEv.length || this.tetherLostEv.length) {
      const sp = this.spawnedEv, de = this.destroyedEv, tl = this.tetherLostEv;
      this.spawnedEv = []; this.destroyedEv = []; this.tetherLostEv = [];
      for (const s of sp) for (const f of this.hooks.spawned) f(s.h, s.g);
      for (const d of de) for (const f of this.hooks.destroyed) f(d.h, d.g, d.x, d.y);
      for (const h of tl) for (const f of this.hooks.tetherLost) f(h);
    }

    for (const f of this.hooks.step) f();

    const hw = this.hooks.wall, hb = this.hooks.body, ht = this.hooks.tether;
    if (hw.length || hb.length || ht.length) {
      for (let k = 0; k < w.contactCount; k++) {
        const kind = w.cKind[k];
        if (kind === CONTACT_WALL) { for (const f of hw) f(w.cA[k], w.cB[k], k); }
        else if (kind === CONTACT_BODY) { for (const f of hb) f(w.cA[k], w.cB[k], k); }
        else if (kind === CONTACT_TETHER) { for (const f of ht) f(w.cA[k], w.cB[k], w.cC[k], k); }
      }
    }
    for (const sl of this.sledges) sl.fireCrushes();

    this.flush();
  }

  private collectContactFx(): void {
    const w = this.world;
    this.fxBounces = 0;
    for (let k = 0; k < w.contactCount && this.fxBounces < 24; k++) {
      const kind = w.cKind[k];
      if (kind === CONTACT_TETHER) continue;
      const s = w.cSpeed[k];
      if (s < 40) continue;
      const i = w.cA[k];
      this.fxBounces++;
      this.emit({ k: kind === CONTACT_WALL ? 'bounce' : 'hit', x: w.cPx[k], y: w.cPy[k], s, r: w.r[i], l: this.look[i] });
    }
  }

  private updateFalling(): void {
    const w = this.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || this.fallT[i] === 0) continue;
      if (this.time - this.fallT[i] > 1.4 && !this.pendingDead[i]) this.queueDestroy(w.handleAt(i));
    }
  }

  private flush(): void {
    const w = this.world;
    if (this.destroyQueue.length) {
      const q = this.destroyQueue;
      this.destroyQueue = [];
      for (const ref of q) {
        if (isBody(ref)) {
          const i = w.indexOf(ref);
          if (i < 0) continue;
          if (w.tetherCount[i] > 0) {
            for (let t = 0; t < w.tetherHigh; t++) {
              if (w.tAlive[t] && w.tKind[t] === 2 && w.tRef[t] === i && w.tBody[t] !== i) this.tetherLostEv.push(w.handleAt(w.tBody[t]));
              else if (w.tAlive[t] && w.tKind[t] === 2 && w.tBody[t] === i) this.tetherLostEv.push(w.handleAt(w.tRef[t]));
            }
          }
          this.destroyedEv.push({ h: ref, g: w.group[i], x: w.x[i], y: w.y[i] });
          w.destroyIndex(i);
          this.pendingDead[i] = 0;
          this.nameIdx[i] = -1;
          this.fallT[i] = 0;
          for (const f of this.hooks.freed) f(i);
        } else if (isCollider(ref)) {
          const c = colliderOf(ref);
          if (!w.colAlive[c]) continue;
          for (let t = 0; t < w.tetherHigh; t++) {
            if (w.tAlive[t] && w.tKind[t] === 1 && w.tRef[t] === c) this.tetherLostEv.push(w.handleAt(w.tBody[t]));
          }
          if (this.fxOn) this.emitShatter(c);
          w.removeCollider(c);
        } else if (isZone(ref)) {
          const z = this.zones[zoneOf(ref)];
          if (z) z.alive = false;
        }
      }
    }
    if (this.scheduled.length) {
      const now = this.time;
      const keep: { t: number; req: SpawnReq }[] = [];
      for (const it of this.scheduled) {
        if (it.t <= now + 1e-9) this.spawnQueue.push(it.req);
        else keep.push(it);
      }
      this.scheduled = keep;
    }
    if (this.spawnQueue.length) {
      const q = this.spawnQueue;
      this.spawnQueue = [];
      for (const s of q) {
        const g = this.groups[s.group];
        if (!g) continue;
        const from = s.from >= 0 && w.alive[s.from] ? s.from : -1;
        const h = this.createBall(g, s.x, s.y, s.vx, s.vy, from, s.r ?? 0);
        if (h >= 0) {
          this.spawnedEv.push({ h, g: s.group });
          const i = w.indexOf(h);
          if (this.alpha[i] > 0) this.emit({ k: 'pop', x: s.x, y: s.y, l: this.look[i] });
        }
      }
    }
  }

  /** World-space geometry of a collider for the dissolve effect. */
  private emitShatter(c: number): void {
    const w = this.world;
    const arcs: number[] = [], segs: number[] = [];
    const P = { x: 0, y: 0 }, Q = { x: 0, y: 0 };
    for (let p = w.colPieceStart[c]; p < w.colPieceStart[c] + w.colPieceCount[c]; p++) {
      if (!w.pAlive[p]) continue;
      const b = p * 12, D = w.pData, sc = w.colScale[c];
      if (w.pKind[p] === 0) {
        w.colliderToWorld(c, D[b] * sc, D[b + 1] * sc, P);
        w.colliderToWorld(c, D[b + 2] * sc, D[b + 3] * sc, Q);
        segs.push(P.x, P.y, Q.x, Q.y, w.pHt[p]);
      } else {
        w.colliderToWorld(c, D[b] * sc, D[b + 1] * sc, P);
        arcs.push(P.x, P.y, D[b + 2] * sc, dmath.atan2(D[b + 5], D[b + 4]) + w.colAngle[c], D[b + 3], w.pHt[p]);
      }
    }
    this.emit({ k: 'shatter', x: w.colX[c], y: w.colY[c], color: this.colColor[c] ?? '#9AA4B1', arcs, segs, n: 0 });
  }

  private applyMotion(): void {
    const w = this.world;
    const t1 = this.time + this.dt;
    for (let c = 0; c < this.colMotion.length; c++) {
      const m = this.colMotion[c];
      if (!m || !w.colAlive[c] || m.type === 'none' || m.type === 'spin') continue;
      const s = dmath.sin((dmath.TAU * t1) / m.period + m.phase);
      if (m.type === 'swing') {
        const target = m.base + m.amp * s;
        w.setColliderVelocity(c, 0, 0, (target - w.colAngle[c]) / this.dt);
      } else {
        const tx = m.bx + m.dx * m.amp * s, ty = m.by + m.dy * m.amp * s;
        w.setColliderVelocity(c, (tx - w.colX[c]) / this.dt, (ty - w.colY[c]) / this.dt, 0);
      }
    }
    for (const sb of this.snapBack) this.stepSnapBack(sb);
  }

  /**
   * After the ball breaks out and turns back toward the center, every ring left
   * shrinks quickly so the innermost one is back at the starting radius, then stops.
   */
  private stepSnapBack(sb: Sim['snapBack'][number]): void {
    const w = this.world;
    while (sb.ptr < sb.order.length && !w.colAlive[sb.order[sb.ptr]]) sb.ptr++;
    if (sb.ptr >= sb.order.length) return;
    if (sb.anim) {
      const a = sb.anim;
      const u = Math.min(1, (this.time + this.dt - a.t0) / a.dur);
      const e = 1 - (1 - u) * (1 - u);
      const de = (2 * (1 - u)) / a.dur;
      for (let k = 0; k < a.cols.length; k++) {
        const c = a.cols[k];
        if (!w.colAlive[c]) continue;
        const meta = this.ringMeta[c];
        if (!meta) continue;
        const R = a.from[k] + (a.to[k] - a.from[k]) * e;
        const growth = u >= 1 ? 0 : ((a.to[k] - a.from[k]) * de) / Math.max(1, R);
        this.reshapeRing(c, meta, R, growth);
      }
      if (u >= 1) sb.anim = null;
      return;
    }
    const inner = sb.order[sb.ptr];
    if (w.colRingR[inner] - sb.R0 < sb.spacing * 0.5) return;
    // Is the ball heading back toward the center?
    const cx = w.colX[inner], cy = w.colY[inner];
    let vr = 0, found = false;
    for (let i = 0; i < w.highWater; i++) {
      if (!this.inPlay(i)) continue;
      const dx = w.x[i] - cx, dy = w.y[i] - cy;
      const d = dmath.sqrt(dx * dx + dy * dy) || 1;
      vr = (dx * w.vx[i] + dy * w.vy[i]) / d;
      found = true;
      break;
    }
    if (!found || vr >= 0) return;
    const cols: number[] = [], from: number[] = [], to: number[] = [];
    let j = 0;
    for (let k = sb.ptr; k < sb.order.length; k++) {
      const c = sb.order[k];
      if (!w.colAlive[c]) continue;
      cols.push(c);
      from.push(w.colRingR[c]);
      to.push(sb.R0 + j * sb.spacing);
      j++;
    }
    // Fast, but never so fast that a ring could jump past the ball in one step.
    const hole = from[0] - to[0];
    sb.anim = { t0: this.time, dur: Math.max(0.28, hole / 520), cols, from, to };
  }

  /** Recompute a ring's arc pieces for radius R with fixed-length gaps. */
  reshapeRing(c: number, meta: RingMeta, R: number, growth: number): void {
    const w = this.world;
    const gs = meta.gaps
      .map((g) => {
        const wdt = Math.min(g.len / R, (dmath.TAU * 0.9) / meta.gaps.length);
        let s = (g.at - wdt / 2) % dmath.TAU;
        if (s < 0) s += dmath.TAU;
        return { s, wdt };
      })
      .sort((a, b) => a.s - b.s);
    let p = w.colPieceStart[c];
    for (let k = 0; k < gs.length && p < w.colPieceStart[c] + w.colPieceCount[c]; k++) {
      const end = gs[k].s + gs[k].wdt;
      const next = k + 1 < gs.length ? gs[k + 1].s : gs[0].s + dmath.TAU;
      w.setArc(p++, R, end, next - end, growth);
    }
  }

  setSpin(c: number, rate: number): void {
    const m = this.colMotion[c];
    if (!m) return;
    if (m.type === 'none' || m.type === 'spin') {
      m.type = 'spin';
      m.rate = rate;
      this.world.setColliderVelocity(c, 0, 0, rate);
    }
  }

  addCollider(g: GroupInfo, kind: string, def: Parameters<World['addCollider']>[0], radius: number, motion?: Partial<Motion>, color?: string): number {
    const m: Motion = { type: 'none', rate: 0, base: def.angle ?? 0, amp: 0, period: 1, phase: 0, bx: def.x ?? 0, by: def.y ?? 0, dx: 1, dy: 0, ...motion };
    const rotates = m.type === 'swing' || m.type === 'spin' || (def.angularVelocity ?? 0) !== 0 || !!def.rotates;
    const id = this.world.addCollider({ ...def, rotates, group: g.index, layer: 2, angularVelocity: m.type === 'spin' ? m.rate : def.angularVelocity });
    this.colKind[id] = kind;
    this.colColor[id] = color ?? g.color;
    this.colRadius[id] = radius;
    this.colMotion[id] = m;
    this.colMaterial[id] = g.params.material ?? 'glow';
    return id;
  }

  /** Half-size of a square that holds everything placed, for camera fit. */
  contentRadius(): number {
    const w = this.world;
    let r = 50;
    const P = { x: 0, y: 0 };
    for (let c = 0; c < w.colAlive.length; c++) {
      if (!w.colAlive[c]) continue;
      const m = this.colMotion[c];
      if (w.colRotates[c] || m?.type === 'slide' || w.colRadial[c]) {
        const reach = Math.max(Math.abs(w.colX[c]), Math.abs(w.colY[c])) + w.colBound[c] + (m?.type === 'slide' ? m.amp : 0);
        if (reach > r) r = reach;
        continue;
      }
      for (let p = w.colPieceStart[c]; p < w.colPieceStart[c] + w.colPieceCount[c]; p++) {
        const b = p * 12, D = w.pData, ht = w.pHt[p];
        if (w.pKind[p] === 0) {
          for (const [lx, ly] of [[D[b], D[b + 1]], [D[b + 2], D[b + 3]]]) {
            w.colliderToWorld(c, lx, ly, P);
            r = Math.max(r, Math.abs(P.x) + ht, Math.abs(P.y) + ht);
          }
        } else {
          w.colliderToWorld(c, D[b], D[b + 1], P);
          r = Math.max(r, Math.abs(P.x) + D[b + 2] + ht, Math.abs(P.y) + D[b + 2] + ht);
        }
      }
    }
    for (const z of this.zones) {
      const ex = z.shape === 'circle' ? z.r : z.w / 2, ey = z.shape === 'circle' ? z.r : z.h / 2;
      r = Math.max(r, Math.abs(z.x) + ex, Math.abs(z.y) + ey);
    }
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i]) continue;
      r = Math.max(r, Math.abs(w.x[i]) + w.r[i], Math.abs(w.y[i]) + w.r[i]);
    }
    return r;
  }

  /** Point the follow camera aims at: the first ball in play. */
  focus(out: { x: number; y: number }): boolean {
    const w = this.world;
    for (let i = 0; i < w.highWater; i++) {
      if (!this.inPlay(i)) continue;
      out.x = w.x[i]; out.y = w.y[i];
      return true;
    }
    return false;
  }

  spec(type: string): BlockSpec | undefined {
    return registry.get(type);
  }
}

export type { CompiledNode, CompiledTrigger };
