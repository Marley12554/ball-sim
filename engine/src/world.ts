import { cos, sin, sqrt } from './dmath';
import { SpatialHash } from './grid';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface WorldConfig {
  /** Global object cap. createBody refuses past this. Max 2^20. */
  capacity: number;
  /** Tether cap. addTether refuses past this. */
  tetherCapacity: number;
  /** Max contacts recorded per step. Extra contacts still resolve, they just aren't reported. */
  contactCapacity: number;
  /** Fixed timestep in seconds. Never changes during a run. */
  dt: number;
  gravityX: number;
  gravityY: number;
  /** Spatial grid cell size in world units. Roughly 2x a typical ball radius. */
  cellSize: number;
  /** Hard speed clamp, units/s. Keeps substep counts bounded. */
  maxSpeed: number;
  /** Max substeps per body per step against walls. */
  maxSubsteps: number;
  /** Impacts slower than this (approach speed) are resolved but not reported. */
  minImpactSpeed: number;
  /** Report bodies crossing other bodies' tethers. Costs a grid rebuild per step when tethers exist. */
  detectTetherTouch: boolean;
}

export const DEFAULT_CONFIG: WorldConfig = {
  capacity: 20000,
  tetherCapacity: 20000,
  contactCapacity: 20000,
  dt: 1 / 120,
  gravityX: 0,
  gravityY: 0,
  cellSize: 24,
  maxSpeed: 6000,
  maxSubsteps: 32,
  minImpactSpeed: 1,
  detectTetherTouch: true,
};

export interface BodyDef {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius: number;
  /** Defaults to radius^2 (area-proportional). */
  mass?: number;
  /** Immovable by collisions (still integrates its own velocity). */
  fixed?: boolean;
  /** 1 = perfectly elastic. Combined with the other side by multiplication. */
  restitution?: number;
  /** Linear drag per second. */
  damping?: number;
  /** Gravity multiplier. 0 ignores world gravity. */
  gravityScale?: number;
  /** Collision filtering: A and B collide when (A.layer & B.mask) && (B.layer & A.mask). */
  layer?: number;
  mask?: number;
  /** Free integer for the layer above (e.g. object group / team). */
  group?: number;
}

export type PieceDef =
  | { kind: 'segment'; ax: number; ay: number; bx: number; by: number; halfThickness?: number }
  | {
      kind: 'arc';
      cx?: number;
      cy?: number;
      radius: number;
      /** Start angle (radians, CCW from +x in local space). */
      start: number;
      /** Angular length, (0, 2*PI]. */
      span: number;
      halfThickness?: number;
    };

export interface ColliderDef {
  x?: number;
  y?: number;
  angle?: number;
  angularVelocity?: number;
  vx?: number;
  vy?: number;
  restitution?: number;
  layer?: number;
  mask?: number;
  group?: number;
  pieces: PieceDef[];
}

export type TetherAnchor =
  | { kind: 'point'; x: number; y: number }
  /** World point that becomes fixed to the collider (rotates/moves with it). */
  | { kind: 'collider'; collider: number; x: number; y: number }
  | { kind: 'body'; body: number };

export interface TetherDef {
  body: number;
  anchor: TetherAnchor;
  /** Slack below this length. Defaults to the current distance. */
  restLength?: number;
  /** Spring stiffness per unit mass (1/s^2). 0 = visual only. Clamped for stability. */
  stiffness?: number;
  /** Damping along the tether, 1/s. */
  damping?: number;
  /** Hard maximum length (rope). Infinity = none. */
  maxLength?: number;
}

export const CONTACT_WALL = 0;
export const CONTACT_BODY = 1;
export const CONTACT_TETHER = 2;

/* ------------------------------------------------------------------ */
/* Handles                                                             */
/* ------------------------------------------------------------------ */

const IDX = 1048576; // 2^20
const handleOf = (gen: number, i: number) => gen * IDX + i;
const indexPart = (h: number) => h % IDX;
const genPart = (h: number) => Math.floor(h / IDX);

const PIECE_STRIDE = 12;
const SEG = 0;
const ARC = 1;

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export class World {
  readonly cfg: WorldConfig;
  time = 0;
  stepCount = 0;
  gravityX: number;
  gravityY: number;

  /* Bodies (SoA, indexed 0..highWater-1, check alive[]) */
  readonly cap: number;
  highWater = 0;
  aliveCount = 0;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly r: Float64Array;
  readonly invMass: Float64Array;
  readonly restitution: Float64Array;
  readonly damping: Float64Array;
  readonly gravityScale: Float64Array;
  readonly layer: Uint32Array;
  readonly mask: Uint32Array;
  readonly group: Int32Array;
  readonly gen: Uint32Array;
  readonly alive: Uint8Array;
  readonly tetherCount: Int32Array;
  private freeList: Int32Array;
  private freeTop = 0;
  private bodyRange: Int32Array;
  private pairStamp: Int32Array;

  /* Colliders */
  colAlive: boolean[] = [];
  colX: number[] = [];
  colY: number[] = [];
  colAngle: number[] = [];
  colCos: number[] = [];
  colSin: number[] = [];
  colW: number[] = [];
  colVx: number[] = [];
  colVy: number[] = [];
  colRest: number[] = [];
  colLayer: number[] = [];
  colMask: number[] = [];
  colGroup: number[] = [];
  colPieceStart: number[] = [];
  colPieceCount: number[] = [];
  colBound: number[] = [];

  /* Pieces (flattened) */
  pieceCount = 0;
  pKind: number[] = [];
  pCol: number[] = [];
  pHt: number[] = [];
  pAlive: boolean[] = [];
  pData: number[] = [];
  private pStamp: number[] = [];
  private stamp = 0;
  private staticDirty = true;
  private minHalfThickness = 0;

  /* Tethers */
  readonly tetherCap: number;
  tetherHigh = 0;
  tetherAliveCount = 0;
  readonly tAlive: Uint8Array;
  readonly tGen: Uint32Array;
  readonly tBody: Int32Array;
  readonly tKind: Uint8Array; // 0 point, 1 collider, 2 body
  readonly tRef: Int32Array;
  readonly tLx: Float64Array;
  readonly tLy: Float64Array;
  readonly tRest: Float64Array;
  readonly tK: Float64Array;
  readonly tDamp: Float64Array;
  readonly tMax: Float64Array;
  private tFree: Int32Array;
  private tFreeTop = 0;
  private tStamp: Int32Array;

  /* Grids */
  readonly staticGrid: SpatialHash;
  readonly bodyGrid: SpatialHash;
  readonly tetherGrid: SpatialHash;

  /* Contacts reported by the last step */
  contactCount = 0;
  readonly cKind: Uint8Array;
  readonly cA: Int32Array; // body index
  readonly cB: Int32Array; // collider id | body index | tether owner index
  readonly cC: Int32Array; // piece index | -1 | tether index
  readonly cPx: Float64Array;
  readonly cPy: Float64Array;
  readonly cNx: Float64Array;
  readonly cNy: Float64Array;
  readonly cSpeed: Float64Array;

  /* Guard counters (cumulative) */
  readonly stats = { spawnRefused: 0, tetherRefused: 0, contactsDropped: 0, substepCapHits: 0 };

  constructor(config: Partial<WorldConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (cfg.capacity > IDX) throw new Error(`capacity max is ${IDX}`);
    this.cfg = cfg;
    this.gravityX = cfg.gravityX;
    this.gravityY = cfg.gravityY;

    const n = (this.cap = cfg.capacity);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.r = new Float64Array(n);
    this.invMass = new Float64Array(n);
    this.restitution = new Float64Array(n);
    this.damping = new Float64Array(n);
    this.gravityScale = new Float64Array(n);
    this.layer = new Uint32Array(n);
    this.mask = new Uint32Array(n);
    this.group = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.alive = new Uint8Array(n);
    this.tetherCount = new Int32Array(n);
    this.freeList = new Int32Array(n);
    this.bodyRange = new Int32Array(n * 4);
    this.pairStamp = new Int32Array(n);

    const t = (this.tetherCap = cfg.tetherCapacity);
    this.tAlive = new Uint8Array(t);
    this.tGen = new Uint32Array(t);
    this.tBody = new Int32Array(t);
    this.tKind = new Uint8Array(t);
    this.tRef = new Int32Array(t);
    this.tLx = new Float64Array(t);
    this.tLy = new Float64Array(t);
    this.tRest = new Float64Array(t);
    this.tK = new Float64Array(t);
    this.tDamp = new Float64Array(t);
    this.tMax = new Float64Array(t);
    this.tFree = new Int32Array(t);
    this.tStamp = new Int32Array(t);

    const c = cfg.contactCapacity;
    this.cKind = new Uint8Array(c);
    this.cA = new Int32Array(c);
    this.cB = new Int32Array(c);
    this.cC = new Int32Array(c);
    this.cPx = new Float64Array(c);
    this.cPy = new Float64Array(c);
    this.cNx = new Float64Array(c);
    this.cNy = new Float64Array(c);
    this.cSpeed = new Float64Array(c);

    this.staticGrid = new SpatialHash(cfg.cellSize, 14);
    this.bodyGrid = new SpatialHash(cfg.cellSize, 15);
    this.tetherGrid = new SpatialHash(cfg.cellSize * 2, 14);
  }

  /* ---------------------------- Bodies ---------------------------- */

  /** Returns a handle, or -1 if the object cap is reached. */
  createBody(d: BodyDef): number {
    let i: number;
    if (this.freeTop > 0) i = this.freeList[--this.freeTop];
    else if (this.highWater < this.cap) i = this.highWater++;
    else {
      this.stats.spawnRefused++;
      return -1;
    }
    this.x[i] = d.x;
    this.y[i] = d.y;
    this.vx[i] = d.vx ?? 0;
    this.vy[i] = d.vy ?? 0;
    this.r[i] = d.radius;
    this.invMass[i] = d.fixed ? 0 : 1 / (d.mass ?? d.radius * d.radius);
    this.restitution[i] = d.restitution ?? 1;
    this.damping[i] = d.damping ?? 0;
    this.gravityScale[i] = d.gravityScale ?? 1;
    this.layer[i] = (d.layer ?? 1) >>> 0;
    this.mask[i] = (d.mask ?? 0xffffffff) >>> 0;
    this.group[i] = d.group ?? 0;
    this.tetherCount[i] = 0;
    this.alive[i] = 1;
    this.aliveCount++;
    return handleOf(this.gen[i], i);
  }

  /** Index for a live handle, else -1. */
  indexOf(h: number): number {
    if (h < 0) return -1;
    const i = indexPart(h);
    return i < this.highWater && this.alive[i] && this.gen[i] === genPart(h) ? i : -1;
  }

  handleAt(i: number): number {
    return handleOf(this.gen[i], i);
  }

  isAlive(h: number): boolean {
    return this.indexOf(h) >= 0;
  }

  /** Destroys a body and every tether attached to it. Call between steps. */
  destroyBody(h: number): boolean {
    const i = this.indexOf(h);
    if (i < 0) return false;
    this.destroyIndex(i);
    return true;
  }

  destroyIndex(i: number): void {
    if (!this.alive[i]) return;
    if (this.tetherCount[i] > 0 || this.tetherAliveCount > 0) {
      for (let t = 0; t < this.tetherHigh; t++) {
        if (this.tAlive[t] && (this.tBody[t] === i || (this.tKind[t] === 2 && this.tRef[t] === i))) {
          this.removeTetherIndex(t);
        }
      }
    }
    this.alive[i] = 0;
    this.gen[i] = (this.gen[i] + 1) >>> 0;
    this.freeList[this.freeTop++] = i;
    this.aliveCount--;
  }

  /* --------------------------- Colliders -------------------------- */

  addCollider(d: ColliderDef): number {
    const id = this.colAlive.length;
    const angle = d.angle ?? 0;
    this.colAlive.push(true);
    this.colX.push(d.x ?? 0);
    this.colY.push(d.y ?? 0);
    this.colAngle.push(angle);
    this.colCos.push(cos(angle));
    this.colSin.push(sin(angle));
    this.colW.push(d.angularVelocity ?? 0);
    this.colVx.push(d.vx ?? 0);
    this.colVy.push(d.vy ?? 0);
    this.colRest.push(d.restitution ?? 1);
    this.colLayer.push((d.layer ?? 1) >>> 0);
    this.colMask.push((d.mask ?? 0xffffffff) >>> 0);
    this.colGroup.push(d.group ?? 0);
    this.colPieceStart.push(this.pieceCount);
    this.colPieceCount.push(d.pieces.length);
    let bound = 0;
    for (const p of d.pieces) bound = Math.max(bound, this.pushPiece(id, p));
    this.colBound.push(bound);
    this.staticDirty = true;
    return id;
  }

  private pushPiece(col: number, p: PieceDef): number {
    const ht = p.halfThickness ?? 1;
    const base = this.pieceCount * PIECE_STRIDE;
    for (let k = 0; k < PIECE_STRIDE; k++) this.pData[base + k] = 0;
    const D = this.pData;
    let bound: number;
    if (p.kind === 'segment') {
      this.pKind.push(SEG);
      D[base] = p.ax; D[base + 1] = p.ay; D[base + 2] = p.bx; D[base + 3] = p.by;
      const ex = p.bx - p.ax, ey = p.by - p.ay;
      const len = sqrt(ex * ex + ey * ey);
      D[base + 4] = len > 0 ? -ey / len : 0;
      D[base + 5] = len > 0 ? ex / len : 1;
      D[base + 6] = ex * ex + ey * ey;
      bound = Math.max(sqrt(p.ax * p.ax + p.ay * p.ay), sqrt(p.bx * p.bx + p.by * p.by)) + ht;
    } else {
      this.pKind.push(ARC);
      const cx = p.cx ?? 0, cy = p.cy ?? 0;
      const span = Math.min(p.span, 6.283185307179586);
      const end = p.start + span;
      const u0x = cos(p.start), u0y = sin(p.start);
      const u1x = cos(end), u1y = sin(end);
      D[base] = cx; D[base + 1] = cy; D[base + 2] = p.radius; D[base + 3] = span;
      D[base + 4] = u0x; D[base + 5] = u0y; D[base + 6] = u1x; D[base + 7] = u1y;
      D[base + 8] = cx + u0x * p.radius; D[base + 9] = cy + u0y * p.radius;
      D[base + 10] = cx + u1x * p.radius; D[base + 11] = cy + u1y * p.radius;
      bound = sqrt(cx * cx + cy * cy) + p.radius + ht;
    }
    this.pCol.push(col);
    this.pHt.push(ht);
    this.pAlive.push(true);
    this.pStamp.push(0);
    this.pieceCount++;
    return bound;
  }

  removeCollider(id: number): void {
    if (!this.colAlive[id]) return;
    this.colAlive[id] = false;
    const s = this.colPieceStart[id];
    for (let p = s; p < s + this.colPieceCount[id]; p++) this.pAlive[p] = false;
    for (let t = 0; t < this.tetherHigh; t++) {
      if (this.tAlive[t] && this.tKind[t] === 1 && this.tRef[t] === id) this.removeTetherIndex(t);
    }
    this.staticDirty = true;
  }

  setColliderTransform(id: number, x: number, y: number, angle: number): void {
    this.colX[id] = x;
    this.colY[id] = y;
    this.colAngle[id] = angle;
    this.colCos[id] = cos(angle);
    this.colSin[id] = sin(angle);
    this.staticDirty = true;
  }

  setColliderVelocity(id: number, vx: number, vy: number, angularVelocity: number): void {
    this.colVx[id] = vx;
    this.colVy[id] = vy;
    this.colW[id] = angularVelocity;
    this.staticDirty = true;
  }

  /** World position of a collider-local point. */
  colliderToWorld(id: number, lx: number, ly: number, out: { x: number; y: number }): void {
    const c = this.colCos[id], s = this.colSin[id];
    out.x = this.colX[id] + c * lx - s * ly;
    out.y = this.colY[id] + s * lx + c * ly;
  }

  private rebuildStatic(): void {
    const g = this.staticGrid;
    g.begin();
    let minHt = Infinity;
    for (let p = 0; p < this.pieceCount; p++) {
      if (!this.pAlive[p]) continue;
      const col = this.pCol[p];
      const ht = this.pHt[p];
      if (ht < minHt) minHt = ht;
      if (this.colW[col] !== 0) {
        // Rotating: register the rotation-invariant bound so rotation never forces a rebuild.
        const b = this.colBound[col];
        g.add(p, this.colX[col] - b, this.colY[col] - b, this.colX[col] + b, this.colY[col] + b);
        continue;
      }
      const D = this.pData, base = p * PIECE_STRIDE;
      let x0: number, y0: number, x1: number, y1: number;
      if (this.pKind[p] === SEG) {
        x0 = Math.min(D[base], D[base + 2]) - ht; x1 = Math.max(D[base], D[base + 2]) + ht;
        y0 = Math.min(D[base + 1], D[base + 3]) - ht; y1 = Math.max(D[base + 1], D[base + 3]) + ht;
      } else {
        const R = D[base + 2] + ht;
        x0 = D[base] - R; x1 = D[base] + R; y0 = D[base + 1] - R; y1 = D[base + 1] + R;
      }
      // Rotate the local AABB corners into world space.
      const c = this.colCos[col], s = this.colSin[col], ox = this.colX[col], oy = this.colY[col];
      let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const lx = k & 1 ? x1 : x0, ly = k & 2 ? y1 : y0;
        const wx = ox + c * lx - s * ly, wy = oy + s * lx + c * ly;
        if (wx < wx0) wx0 = wx; if (wx > wx1) wx1 = wx;
        if (wy < wy0) wy0 = wy; if (wy > wy1) wy1 = wy;
      }
      g.add(p, wx0, wy0, wx1, wy1);
    }
    g.build();
    this.minHalfThickness = minHt === Infinity ? 0 : minHt;
    this.staticDirty = false;
  }

  /* ---------------------------- Tethers --------------------------- */

  /** Returns a tether handle, or -1 if the tether cap is reached or the body is dead. */
  addTether(d: TetherDef): number {
    const bi = this.indexOf(d.body);
    if (bi < 0) return -1;
    let t: number;
    if (this.tFreeTop > 0) t = this.tFree[--this.tFreeTop];
    else if (this.tetherHigh < this.tetherCap) t = this.tetherHigh++;
    else {
      this.stats.tetherRefused++;
      return -1;
    }
    const a = d.anchor;
    let ax: number, ay: number;
    if (a.kind === 'point') {
      this.tKind[t] = 0; this.tRef[t] = -1; this.tLx[t] = a.x; this.tLy[t] = a.y;
      ax = a.x; ay = a.y;
    } else if (a.kind === 'collider') {
      const id = a.collider;
      if (!this.colAlive[id]) { this.tFree[this.tFreeTop++] = t; return -1; }
      const dx = a.x - this.colX[id], dy = a.y - this.colY[id];
      const c = this.colCos[id], s = this.colSin[id];
      this.tKind[t] = 1; this.tRef[t] = id;
      this.tLx[t] = c * dx + s * dy; this.tLy[t] = -s * dx + c * dy;
      ax = a.x; ay = a.y;
    } else {
      const oi = this.indexOf(a.body);
      if (oi < 0 || oi === bi) { this.tFree[this.tFreeTop++] = t; return -1; }
      this.tKind[t] = 2; this.tRef[t] = oi; this.tLx[t] = 0; this.tLy[t] = 0;
      ax = this.x[oi]; ay = this.y[oi];
      this.tetherCount[oi]++;
    }
    const dx = ax - this.x[bi], dy = ay - this.y[bi];
    this.tBody[t] = bi;
    this.tRest[t] = d.restLength ?? sqrt(dx * dx + dy * dy);
    this.tK[t] = d.stiffness ?? 0;
    this.tDamp[t] = d.damping ?? 0;
    this.tMax[t] = d.maxLength ?? Infinity;
    this.tAlive[t] = 1;
    this.tetherCount[bi]++;
    this.tetherAliveCount++;
    return handleOf(this.tGen[t], t);
  }

  tetherIndexOf(h: number): number {
    if (h < 0) return -1;
    const t = indexPart(h);
    return t < this.tetherHigh && this.tAlive[t] && this.tGen[t] === genPart(h) ? t : -1;
  }

  tetherHandleAt(t: number): number {
    return handleOf(this.tGen[t], t);
  }

  removeTether(h: number): boolean {
    const t = this.tetherIndexOf(h);
    if (t < 0) return false;
    this.removeTetherIndex(t);
    return true;
  }

  removeTetherIndex(t: number): void {
    if (!this.tAlive[t]) return;
    this.tAlive[t] = 0;
    this.tGen[t] = (this.tGen[t] + 1) >>> 0;
    this.tetherCount[this.tBody[t]]--;
    if (this.tKind[t] === 2) this.tetherCount[this.tRef[t]]--;
    this.tFree[this.tFreeTop++] = t;
    this.tetherAliveCount--;
  }

  /** Current world-space anchor of tether t. */
  tetherAnchor(t: number, out: { x: number; y: number }): void {
    const k = this.tKind[t];
    if (k === 0) { out.x = this.tLx[t]; out.y = this.tLy[t]; }
    else if (k === 1) this.colliderToWorld(this.tRef[t], this.tLx[t], this.tLy[t], out);
    else { out.x = this.x[this.tRef[t]]; out.y = this.y[this.tRef[t]]; }
  }

  /* ----------------------------- Step ----------------------------- */

  step(): void {
    const dt = this.cfg.dt;
    this.contactCount = 0;

    this.advanceColliders(dt);
    if (this.staticDirty) this.rebuildStatic();
    if (this.tetherAliveCount > 0) this.applyTethers(dt);
    this.integrate(dt);
    this.solveBodyPairs();
    if (this.cfg.detectTetherTouch && this.tetherAliveCount > 0) this.detectTetherTouches();

    this.stepCount++;
    this.time = this.stepCount * dt;
  }

  private advanceColliders(dt: number): void {
    for (let id = 0; id < this.colAlive.length; id++) {
      if (!this.colAlive[id]) continue;
      const w = this.colW[id];
      if (w !== 0) {
        const a = this.colAngle[id] + w * dt;
        this.colAngle[id] = a;
        this.colCos[id] = cos(a);
        this.colSin[id] = sin(a);
      }
      if (this.colVx[id] !== 0 || this.colVy[id] !== 0) {
        this.colX[id] += this.colVx[id] * dt;
        this.colY[id] += this.colVy[id] * dt;
        this.staticDirty = true;
      }
    }
  }

  private readonly tmp = { x: 0, y: 0 };

  private applyTethers(dt: number): void {
    const P = this.tmp;
    for (let t = 0; t < this.tetherHigh; t++) {
      if (!this.tAlive[t]) continue;
      const i = this.tBody[t];
      this.tetherAnchor(t, P);
      const dx = P.x - this.x[i], dy = P.y - this.y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 === 0) continue;
      const d = sqrt(d2);
      const ux = dx / d, uy = dy / d;
      const other = this.tKind[t] === 2 ? this.tRef[t] : -1;
      const wi = this.invMass[i];
      const wj = other >= 0 ? this.invMass[other] : 0;

      // Spring (slack below rest length). Stiffness is per unit mass; clamp keeps explicit Euler stable.
      const stretch = d - this.tRest[t];
      if (stretch > 0 && (this.tK[t] > 0 || this.tDamp[t] > 0)) {
        const n = Math.max(1, this.tetherCount[i]);
        const kMax = 0.25 / (dt * dt * n);
        const k = Math.min(this.tK[t], kMax);
        let avx = 0, avy = 0;
        if (other >= 0) { avx = this.vx[other]; avy = this.vy[other]; }
        else if (this.tKind[t] === 1) {
          const id = this.tRef[t], w = this.colW[id];
          avx = this.colVx[id] - w * (P.y - this.colY[id]);
          avy = this.colVy[id] + w * (P.x - this.colX[id]);
        }
        const relV = (avx - this.vx[i]) * ux + (avy - this.vy[i]) * uy;
        const c = Math.min(this.tDamp[t], 0.5 / dt);
        const a = (k * stretch + c * relV) * dt; // delta-v along u
        if (wi > 0) { this.vx[i] += ux * a; this.vy[i] += uy * a; }
        if (wj > 0) { this.vx[other] -= ux * a; this.vy[other] -= uy * a; }
      }

      // Hard max length (rope).
      const over = d - this.tMax[t];
      if (over > 0) {
        const ws = wi + wj;
        if (ws > 0) {
          const fi = wi / ws, fj = wj / ws;
          this.x[i] += ux * over * fi; this.y[i] += uy * over * fi;
          const vn = this.vx[i] * ux + this.vy[i] * uy;
          if (vn < 0) { this.vx[i] -= ux * vn; this.vy[i] -= uy * vn; }
          if (other >= 0 && fj > 0) {
            this.x[other] -= ux * over * fj; this.y[other] -= uy * over * fj;
            const vo = this.vx[other] * ux + this.vy[other] * uy;
            if (vo > 0) { this.vx[other] -= ux * vo; this.vy[other] -= uy * vo; }
          }
        }
      }
    }
  }

  private integrate(dt: number): void {
    const cfg = this.cfg;
    const max = cfg.maxSpeed, max2 = max * max;
    const gx = this.gravityX, gy = this.gravityY;
    const hasStatic = this.staticGrid.entryCount > 0;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      let vx = this.vx[i] + gx * this.gravityScale[i] * dt;
      let vy = this.vy[i] + gy * this.gravityScale[i] * dt;
      const dmp = this.damping[i];
      if (dmp > 0) {
        const f = 1 / (1 + dmp * dt);
        vx *= f; vy *= f;
      }
      const s2 = vx * vx + vy * vy;
      let speed = sqrt(s2);
      if (s2 > max2) {
        const k = max / speed;
        vx *= k; vy *= k; speed = max;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;

      if (!hasStatic) {
        this.x[i] += vx * dt;
        this.y[i] += vy * dt;
        continue;
      }
      // Substep so a body never moves more than half its contact radius per substep.
      const safe = 0.5 * (this.r[i] + this.minHalfThickness);
      let n = safe > 0 ? Math.ceil((speed * dt) / safe) : 1;
      if (n < 1) n = 1;
      if (n > cfg.maxSubsteps) { n = cfg.maxSubsteps; this.stats.substepCapHits++; }
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
        this.resolveStatic(i);
      }
    }
  }

  private reportedCols: number[] = [-1, -1, -1, -1];

  private resolveStatic(i: number): void {
    const g = this.staticGrid;
    const r = this.r[i];
    const x0 = g.cellOf(this.x[i] - r), x1 = g.cellOf(this.x[i] + r);
    const y0 = g.cellOf(this.y[i] - r), y1 = g.cellOf(this.y[i] + r);
    const stamp = ++this.stamp;
    const rep = this.reportedCols;
    rep[0] = rep[1] = rep[2] = rep[3] = -1;
    let nRep = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const hi = g.bucketHi(cx, cy);
        for (let e = g.bucketLo(cx, cy); e < hi; e++) {
          if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
          const p = g.entryItem[e];
          if (this.pStamp[p] === stamp) continue;
          this.pStamp[p] = stamp;
          const col = this.collidePiece(i, p);
          if (col >= 0) {
            let seen = false;
            for (let k = 0; k < nRep; k++) if (rep[k] === col) seen = true;
            if (!seen) {
              if (nRep < 4) rep[nRep++] = col;
              this.pushContact(CONTACT_WALL, i, col, p, this.hitPx, this.hitPy, this.hitNx, this.hitNy, this.hitSpeed);
            }
          }
        }
      }
    }
  }

  private hitPx = 0; private hitPy = 0; private hitNx = 0; private hitNy = 0; private hitSpeed = 0;

  /** Resolves body i against piece p. Returns collider id if a reportable impact happened, else -1. */
  private collidePiece(i: number, p: number): number {
    const col = this.pCol[p];
    if (!(this.layer[i] & this.colMask[col]) || !(this.colLayer[col] & this.mask[i])) return -1;
    const c = this.colCos[col], s = this.colSin[col];
    const ox = this.colX[col], oy = this.colY[col];
    const dx = this.x[i] - ox, dy = this.y[i] - oy;
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;
    const D = this.pData, b = p * PIECE_STRIDE;
    let qx: number, qy: number, fnx: number, fny: number;

    if (this.pKind[p] === SEG) {
      const ax = D[b], ay = D[b + 1], ex = D[b + 2] - ax, ey = D[b + 3] - ay;
      const L2 = D[b + 6];
      let t = L2 > 0 ? ((lx - ax) * ex + (ly - ay) * ey) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      qx = ax + ex * t; qy = ay + ey * t;
      fnx = D[b + 4]; fny = D[b + 5];
    } else {
      const acx = D[b], acy = D[b + 1], R = D[b + 2], span = D[b + 3];
      const vx = lx - acx, vy = ly - acy;
      const len = sqrt(vx * vx + vy * vy);
      // Fast reject: outside the annulus band.
      const reach = this.r[i] + this.pHt[p];
      if (len - R > reach || R - len > reach) return -1;
      let inside: boolean;
      if (span >= 6.283185307179586) inside = true;
      else {
        const u0x = D[b + 4], u0y = D[b + 5], u1x = D[b + 6], u1y = D[b + 7];
        const c0 = u0x * vy - u0y * vx; // cross(u0, v)
        const c1 = vx * u1y - vy * u1x; // cross(v, u1)
        inside = span <= 3.141592653589793 ? c0 >= 0 && c1 >= 0 : !(c0 < 0 && c1 < 0);
      }
      if (inside && len > 0) {
        qx = acx + (vx / len) * R; qy = acy + (vy / len) * R;
        fnx = vx / len; fny = vy / len;
      } else {
        const e0x = D[b + 8], e0y = D[b + 9], e1x = D[b + 10], e1y = D[b + 11];
        const d0 = (lx - e0x) * (lx - e0x) + (ly - e0y) * (ly - e0y);
        const d1 = (lx - e1x) * (lx - e1x) + (ly - e1y) * (ly - e1y);
        if (d0 <= d1) { qx = e0x; qy = e0y; } else { qx = e1x; qy = e1y; }
        fnx = 1; fny = 0;
      }
    }

    const ex = lx - qx, ey = ly - qy;
    const R = this.r[i] + this.pHt[p];
    const d2 = ex * ex + ey * ey;
    if (d2 >= R * R) return -1;
    const d = sqrt(d2);
    let nlx: number, nly: number;
    if (d > 1e-12) { nlx = ex / d; nly = ey / d; } else { nlx = fnx; nly = fny; }
    const pen = R - d;
    const nx = c * nlx - s * nly, ny = s * nlx + c * nly;
    this.x[i] += nx * pen;
    this.y[i] += ny * pen;

    // Contact point in world space and wall velocity there.
    const px = this.x[i] - nx * this.r[i], py = this.y[i] - ny * this.r[i];
    const w = this.colW[col];
    const wvx = this.colVx[col] - w * (py - oy);
    const wvy = this.colVy[col] + w * (px - ox);
    const rvx = this.vx[i] - wvx, rvy = this.vy[i] - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return -1;
    const e = this.restitution[i] * this.colRest[col];
    const j = -(1 + e) * vn;
    this.vx[i] += nx * j;
    this.vy[i] += ny * j;
    if (-vn < this.cfg.minImpactSpeed) return -1;
    this.hitPx = px; this.hitPy = py; this.hitNx = nx; this.hitNy = ny; this.hitSpeed = -vn;
    return col;
  }

  private solveBodyPairs(): void {
    if (this.aliveCount < 2) return;
    const g = this.bodyGrid;
    g.begin();
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const r = this.r[i];
      g.add(i, this.x[i] - r, this.y[i] - r, this.x[i] + r, this.y[i] + r);
    }
    g.build();
    const BR = this.bodyRange;
    {
      let k = 0;
      const tmp = [0, 0, 0, 0];
      for (let i = 0; i < this.highWater; i++) {
        if (!this.alive[i]) continue;
        g.rangeOf(k++, tmp);
        BR[i * 4] = tmp[0]; BR[i * 4 + 1] = tmp[1]; BR[i * 4 + 2] = tmp[2]; BR[i * 4 + 3] = tmp[3];
      }
    }
    const minImpact = this.cfg.minImpactSpeed;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const ix0 = BR[i * 4], iy0 = BR[i * 4 + 1], ix1 = BR[i * 4 + 2], iy1 = BR[i * 4 + 3];
      for (let cy = iy0; cy <= iy1; cy++) {
        for (let cx = ix0; cx <= ix1; cx++) {
          const hi = g.bucketHi(cx, cy);
          for (let e = g.bucketLo(cx, cy); e < hi; e++) {
            if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
            const j = g.entryItem[e];
            if (j <= i) continue;
            // Each overlapping pair is handled only in the first cell both cover.
            const ccx = ix0 > BR[j * 4] ? ix0 : BR[j * 4];
            const ccy = iy0 > BR[j * 4 + 1] ? iy0 : BR[j * 4 + 1];
            if (ccx !== cx || ccy !== cy) continue;
            if (!(this.layer[i] & this.mask[j]) || !(this.layer[j] & this.mask[i])) continue;
            const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
            const R = this.r[i] + this.r[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= R * R) continue;
            const wi = this.invMass[i], wj = this.invMass[j], ws = wi + wj;
            if (ws === 0) continue;
            const d = sqrt(d2);
            let nx = 1, ny = 0;
            if (d > 1e-12) { nx = dx / d; ny = dy / d; }
            const pen = R - d;
            this.x[i] -= nx * pen * (wi / ws); this.y[i] -= ny * pen * (wi / ws);
            this.x[j] += nx * pen * (wj / ws); this.y[j] += ny * pen * (wj / ws);
            const vn = (this.vx[j] - this.vx[i]) * nx + (this.vy[j] - this.vy[i]) * ny;
            if (vn >= 0) continue;
            const imp = (-(1 + this.restitution[i] * this.restitution[j]) * vn) / ws;
            this.vx[i] -= nx * imp * wi; this.vy[i] -= ny * imp * wi;
            this.vx[j] += nx * imp * wj; this.vy[j] += ny * imp * wj;
            if (-vn >= minImpact) {
              this.pushContact(CONTACT_BODY, i, j, -1,
                this.x[i] + nx * this.r[i], this.y[i] + ny * this.r[i], nx, ny, -vn);
            }
          }
        }
      }
    }
  }

  private detectTetherTouches(): void {
    const g = this.tetherGrid;
    const P = this.tmp;
    g.begin();
    for (let t = 0; t < this.tetherHigh; t++) {
      if (!this.tAlive[t]) continue;
      const i = this.tBody[t];
      this.tetherAnchor(t, P);
      g.add(t, Math.min(this.x[i], P.x), Math.min(this.y[i], P.y), Math.max(this.x[i], P.x), Math.max(this.y[i], P.y));
    }
    g.build();
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const r = this.r[i];
      const bx = this.x[i], by = this.y[i];
      const x0 = g.cellOf(bx - r), x1 = g.cellOf(bx + r), y0 = g.cellOf(by - r), y1 = g.cellOf(by + r);
      const stamp = ++this.stamp;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const hi = g.bucketHi(cx, cy);
          for (let e = g.bucketLo(cx, cy); e < hi; e++) {
            if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
            const t = g.entryItem[e];
            if (this.tStamp[t] === stamp) continue;
            this.tStamp[t] = stamp;
            const owner = this.tBody[t];
            if (owner === i || (this.tKind[t] === 2 && this.tRef[t] === i)) continue;
            if (!(this.layer[i] & this.mask[owner]) || !(this.layer[owner] & this.mask[i])) continue;
            this.tetherAnchor(t, P);
            const ax = this.x[owner], ay = this.y[owner];
            const ex = P.x - ax, ey = P.y - ay;
            const L2 = ex * ex + ey * ey;
            let u = L2 > 0 ? ((bx - ax) * ex + (by - ay) * ey) / L2 : 0;
            if (u < 0) u = 0; else if (u > 1) u = 1;
            const qx = ax + ex * u, qy = ay + ey * u;
            const ddx = bx - qx, ddy = by - qy;
            if (ddx * ddx + ddy * ddy >= r * r) continue;
            this.pushContact(CONTACT_TETHER, i, owner, t, qx, qy, 0, 0, 0);
          }
        }
      }
    }
  }

  private pushContact(kind: number, a: number, b: number, c: number,
    px: number, py: number, nx: number, ny: number, speed: number): void {
    const k = this.contactCount;
    if (k >= this.cfg.contactCapacity) {
      this.stats.contactsDropped++;
      return;
    }
    this.cKind[k] = kind; this.cA[k] = a; this.cB[k] = b; this.cC[k] = c;
    this.cPx[k] = px; this.cPy[k] = py; this.cNx[k] = nx; this.cNy[k] = ny; this.cSpeed[k] = speed;
    this.contactCount = k + 1;
  }

  /* --------------------------- Utilities -------------------------- */

  /** FNV-1a over the exact bits of all body state. Equal hashes = identical runs. */
  stateHash(): number {
    const buf = new Float64Array(1);
    const u = new Uint32Array(buf.buffer);
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      buf[0] = v;
      h = Math.imul(h ^ u[0], 0x01000193);
      h = Math.imul(h ^ u[1], 0x01000193);
    };
    mix(this.stepCount);
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      mix(i); mix(this.x[i]); mix(this.y[i]); mix(this.vx[i]); mix(this.vy[i]); mix(this.r[i]);
    }
    for (let t = 0; t < this.tetherHigh; t++) if (this.tAlive[t]) { mix(t); mix(this.tBody[t]); }
    for (let id = 0; id < this.colAlive.length; id++) if (this.colAlive[id]) { mix(id); mix(this.colAngle[id]); }
    return h >>> 0;
  }
}
