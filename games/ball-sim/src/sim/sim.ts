import {
  World, Rng, Dispatcher, compileGraph, withDefaults, dmath,
  CONTACT_WALL, CONTACT_BODY, CONTACT_TETHER,
} from '@engine/index';
import type { CompiledNode, CompiledTrigger, Params, BlockSpec } from '@engine/index';
import { registry } from './blocks';
import type { ObjectBlock, TriggerBlock, FilterBlock, ActionBlock } from './blocks/types';
import { LookPicker, lookKey, lookName, lookColor, DEFAULT_LOOK } from './looks';
import type { Look, LookSetting, SimDef, SimEvent } from './types';
import { DEFAULT_SETTINGS, NONE, isBody, isCollider, isZone, colliderOf, colliderRef, zoneOf, zoneRef } from './types';

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
}

export interface SpawnReq {
  group: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Copy size/look/hp from this body index (duplicate). -1 = from template. */
  from: number;
}

type Hook = (e: SimEvent) => void;

export class Sim {
  readonly def: SimDef;
  readonly world: World;
  readonly rng: Rng;
  readonly lookRng: Rng;
  readonly dispatcher: Dispatcher<SimEvent>;
  readonly triggers: CompiledTrigger[];
  readonly dt: number;

  groups: GroupInfo[] = [];
  groupByNode = new Map<string, number>();
  counters = new Map<string, CounterInfo>();
  zones: Zone[] = [];
  outcome: { label: string; time: number } | null = null;
  /** Recent explosions, for the renderer. */
  flash: { x: number; y: number; r: number; t: number }[] = [];
  /** Seconds since the outcome. */
  sinceEnd = 0;
  assets: Record<string, string>;

  /* Per-body extras */
  readonly look: Int32Array;
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly born: Float64Array;
  readonly nameIdx: Int32Array;
  readonly pendingDead: Uint8Array;
  readonly tSeq: Float64Array;
  private tSeqNext = 1;
  names: string[] = [];
  looks: Look[] = [];
  private lookIndex = new Map<string, number>();

  /* Per-collider extras */
  colKind: string[] = [];
  colColor: string[] = [];
  colRadius: number[] = [];
  colMotion: Motion[] = [];

  /* Hooks (filled by trigger setups) */
  readonly hooks = {
    step: [] as (() => void)[],
    wall: [] as ((i: number, col: number, k: number) => void)[],
    body: [] as ((a: number, b: number, k: number) => void)[],
    tether: [] as ((i: number, owner: number, t: number, k: number) => void)[],
    spawned: [] as ((h: number, group: number) => void)[],
    destroyed: [] as ((h: number, group: number, x: number, y: number) => void)[],
    tetherLost: [] as ((owner: number) => void)[],
    freed: [] as ((i: number) => void)[],
  };

  private destroyQueue: number[] = [];
  private spawnQueue: SpawnReq[] = [];
  private spawnedEv: { h: number; g: number }[] = [];
  private destroyedEv: { h: number; g: number; x: number; y: number }[] = [];
  private tetherLostEv: number[] = [];

  /** Reused event object. Actions must not keep references to it. */
  readonly e: SimEvent = { self: NONE, other: NONE, px: 0, py: 0, nx: 0, ny: 0, tether: NONE, speed: 0 };

  constructor(def: SimDef) {
    this.def = def;
    const s = { ...DEFAULT_SETTINGS, ...def.settings };
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
      gravityX: dmath.cos(ga) * s.gravity,
      gravityY: dmath.sin(ga) * s.gravity,
      maxSpeed: s.speedLimit,
      cellSize: 16,
      maxSubsteps: 48,
      minImpactSpeed: 4,
    });
    this.dt = this.world.cfg.dt;
    this.look = new Int32Array(cap);
    this.hp = new Float64Array(cap);
    this.maxHp = new Float64Array(cap);
    this.born = new Float64Array(cap);
    this.nameIdx = new Int32Array(cap).fill(-1);
    this.pendingDead = new Uint8Array(cap);
    this.tSeq = new Float64Array(this.world.tetherCap);

    this.dispatcher = new Dispatcher<SimEvent>({
      test: (n, e) => (registry.get(n.type) as FilterBlock).test(this, n, e),
      run: (n, e) => (registry.get(n.type) as ActionBlock).run(this, n, e),
    });

    // Objects: groups first (so refs resolve), then build.
    const imageIds = Object.keys(this.assets);
    for (const n of def.graph.nodes) {
      const spec = registry.get(n.type);
      if (spec?.category !== 'object') continue;
      const params = withDefaults(spec, n.params);
      if (spec.kind === 'counter') {
        this.counters.set(n.id, { nodeId: n.id, name: params.name, value: Number(params.initial) || 0, show: !!params.show });
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
    for (const g of this.groups) (registry.get(def.graph.nodes.find((n) => n.id === g.nodeId)!.type) as ObjectBlock).build?.(this, g);

    this.triggers = compileGraph(def.graph, registry);
    for (const t of this.triggers) (registry.get(t.type) as TriggerBlock).setup(this, t);
  }

  get time(): number {
    return this.world.time;
  }

  /* --------------------------- Groups ----------------------------- */

  groupOf(nodeId: string): GroupInfo | undefined {
    const i = this.groupByNode.get(nodeId);
    return i === undefined ? undefined : this.groups[i];
  }

  /** Membership mask over group indices for a trigger's object inputs. */
  groupMask(nodeIds: string[]): Uint8Array {
    const m = new Uint8Array(Math.max(1, this.groups.length));
    for (const id of nodeIds) {
      const g = this.groupByNode.get(id);
      if (g !== undefined) m[g] = 1;
    }
    return m;
  }

  /** Group index of an entity ref, or -1. */
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

  /** Live body index for a ref, skipping bodies queued for removal. */
  bodyIdx(ref: number): number {
    if (!isBody(ref)) return -1;
    const i = this.world.indexOf(ref);
    return i >= 0 && !this.pendingDead[i] ? i : -1;
  }

  refAlive(ref: number): boolean {
    if (isBody(ref)) return this.bodyIdx(ref) >= 0;
    if (isCollider(ref)) return !!this.world.colAlive[colliderOf(ref)];
    if (isZone(ref)) return !!this.zones[zoneOf(ref)]?.alive;
    return false;
  }

  /** All live entity refs in a group, in a fixed order. */
  membersOf(g: number, out: number[] = []): number[] {
    out.length = 0;
    const w = this.world;
    const info = this.groups[g];
    if (!info) return out;
    if (info.kind === 'ball') {
      for (let i = 0; i < w.highWater; i++) if (w.alive[i] && !this.pendingDead[i] && w.group[i] === g) out.push(w.handleAt(i));
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
      for (let i = 0; i < w.highWater; i++) if (w.alive[i] && !this.pendingDead[i] && w.group[i] === g) n++;
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
    for (let i = 0; i < w.highWater; i++) if (w.alive[i] && !this.pendingDead[i]) n++;
    return n;
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

  /** Creates a ball now. Use only during build or flush. Returns handle or -1. */
  createBall(g: GroupInfo, x: number, y: number, vx: number, vy: number, from = -1): number {
    const w = this.world;
    const t = g.template;
    const r = from >= 0 ? w.r[from] : Math.max(0.5, Number(t.radius) || 6);
    const density = Math.max(0.001, Number(t.density) || 1);
    const collide = t.collide !== false;
    const h = w.createBody({
      x, y, vx, vy, radius: r,
      mass: density * r * r,
      restitution: from >= 0 ? w.restitution[from] : Number(t.bounciness ?? 1),
      damping: from >= 0 ? w.damping[from] : Number(t.drag) || 0,
      gravityScale: from >= 0 ? w.gravityScale[from] : Number(t.gravity ?? 1),
      layer: 1,
      mask: collide ? 0xffffffff : 0xfffffffe,
      group: g.index,
    });
    if (h < 0) return -1;
    const i = w.indexOf(h);
    if (from >= 0) {
      this.look[i] = this.look[from];
      this.hp[i] = this.hp[from];
      this.maxHp[i] = this.maxHp[from];
      this.nameIdx[i] = this.nameIdx[from];
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
    return h;
  }

  queueSpawn(req: SpawnReq): void {
    this.spawnQueue.push(req);
  }

  queueDestroy(ref: number): void {
    if (isBody(ref)) {
      const i = this.world.indexOf(ref);
      if (i < 0 || this.pendingDead[i]) return;
      this.pendingDead[i] = 1;
    }
    this.destroyQueue.push(ref);
  }

  /** Spawn position k of n for a ball group, from its template. */
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
      default: a = this.rng.range(0, dmath.TAU);
    }
    out.x = dmath.cos(a) * speed;
    out.y = dmath.sin(a) * speed;
  }

  /* ---------------------------- Values ---------------------------- */

  /** Read a property of an entity. NaN if it doesn't apply. */
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
        default: return NaN;
      }
    }
    if (isCollider(ref)) {
      const c = colliderOf(ref);
      if (!w.colAlive[c]) return NaN;
      if (name === 'spin') return (this.colMotion[c].rate * 180) / dmath.PI;
      if (name === 'size') return this.colRadius[c];
      if (name === 'bounciness') return w.colRest[c];
    }
    return NaN;
  }

  /* --------------------------- Counters --------------------------- */

  counter(nodeId: string): CounterInfo | undefined {
    return this.counters.get(nodeId);
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
    if (!this.outcome) this.outcome = { label, time: this.time };
  }

  /* ----------------------------- Step ----------------------------- */

  private fillEvent(self: number, other: number, px: number, py: number, nx: number, ny: number, tether: number, speed: number): SimEvent {
    const e = this.e;
    e.self = self; e.other = other; e.px = px; e.py = py; e.nx = nx; e.ny = ny; e.tether = tether; e.speed = speed;
    return e;
  }

  /** Fire a trigger. `key` is the cooldown key (entity ref, or -1 for sim-wide). */
  fire(t: CompiledTrigger, self: number, other = NONE, px = 0, py = 0, nx = 0, ny = 0, tether = NONE, speed = 0): void {
    if (this.outcome) return;
    if (self !== NONE && !this.refAlive(self)) return;
    this.dispatcher.fire(t, self, this.time, this.fillEvent(self, other, px, py, nx, ny, tether, speed));
  }

  /** Fire for a body that was just destroyed (self is no longer alive). */
  fireDead(t: CompiledTrigger, self: number, px: number, py: number): void {
    if (this.outcome) return;
    this.dispatcher.fire(t, self, this.time, this.fillEvent(self, NONE, px, py, 0, 0, NONE, 0));
  }

  step(): void {
    const w = this.world;
    this.applyMotion();
    w.step();
    if (this.outcome) {
      this.sinceEnd += this.dt;
      return;
    }
    this.dispatcher.beginStep();

    // Events produced by last step's structural changes.
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

    this.flush();
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
          // Bodies tethered to this one lose a tether.
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
          for (const f of this.hooks.freed) f(i);
        } else if (isCollider(ref)) {
          const c = colliderOf(ref);
          if (!w.colAlive[c]) continue;
          for (let t = 0; t < w.tetherHigh; t++) {
            if (w.tAlive[t] && w.tKind[t] === 1 && w.tRef[t] === c) this.tetherLostEv.push(w.handleAt(w.tBody[t]));
          }
          w.removeCollider(c);
        } else if (isZone(ref)) {
          const z = this.zones[zoneOf(ref)];
          if (z) z.alive = false;
        }
      }
    }
    if (this.spawnQueue.length) {
      const q = this.spawnQueue;
      this.spawnQueue = [];
      for (const s of q) {
        const g = this.groups[s.group];
        if (!g) continue;
        const from = s.from >= 0 && w.alive[s.from] ? s.from : -1;
        const h = this.createBall(g, s.x, s.y, s.vx, s.vy, from);
        if (h >= 0) this.spawnedEv.push({ h, g: s.group });
      }
    }
  }

  private applyMotion(): void {
    const w = this.world;
    const t1 = this.time + this.dt;
    for (let c = 0; c < this.colMotion.length; c++) {
      const m = this.colMotion[c];
      if (!w.colAlive[c] || m.type === 'none' || m.type === 'spin') continue;
      const s = dmath.sin((dmath.TAU * t1) / m.period + m.phase);
      if (m.type === 'swing') {
        const target = m.base + m.amp * s;
        w.setColliderVelocity(c, 0, 0, (target - w.colAngle[c]) / this.dt);
      } else {
        const tx = m.bx + m.dx * m.amp * s, ty = m.by + m.dy * m.amp * s;
        w.setColliderVelocity(c, (tx - w.colX[c]) / this.dt, (ty - w.colY[c]) / this.dt, 0);
      }
    }
  }

  /** Set a collider's spin rate (rad/s), keeping other motion types intact. */
  setSpin(c: number, rate: number): void {
    const m = this.colMotion[c];
    if (!m) return;
    if (m.type === 'none' || m.type === 'spin') {
      m.type = 'spin';
      m.rate = rate;
      this.world.setColliderVelocity(c, 0, 0, rate);
    }
  }

  /** Register a collider built by an object block. */
  addCollider(g: GroupInfo, kind: string, def: Parameters<World['addCollider']>[0], radius: number, motion?: Partial<Motion>): number {
    const m: Motion = { type: 'none', rate: 0, base: def.angle ?? 0, amp: 0, period: 1, phase: 0, bx: def.x ?? 0, by: def.y ?? 0, dx: 1, dy: 0, ...motion };
    const rotates = m.type === 'swing' || m.type === 'spin' || (def.angularVelocity ?? 0) !== 0;
    const id = this.world.addCollider({ ...def, rotates, group: g.index, layer: 2, angularVelocity: m.type === 'spin' ? m.rate : def.angularVelocity });
    this.colKind[id] = kind;
    this.colColor[id] = g.color;
    this.colRadius[id] = radius;
    this.colMotion[id] = m;
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
      if (w.colRotates[c] || m.type === 'slide') {
        const reach = Math.max(Math.abs(w.colX[c]), Math.abs(w.colY[c])) + w.colBound[c] + (m.type === 'slide' ? m.amp : 0);
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

  spec(type: string): BlockSpec | undefined {
    return registry.get(type);
  }
}

export type { CompiledNode, CompiledTrigger };
