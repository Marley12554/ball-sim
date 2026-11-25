import { CTX_SELF, CTX_OTHER, CTX_POINT, CTX_TETHER, dmath } from '@engine/index';
import type { CompiledTrigger } from '@engine/index';
import type { Sim } from '../sim';
import { NONE, colliderRef, isCollider, colliderOf, isZone, zoneOf, zoneRef } from '../types';
import type { TriggerBlock } from './types';
import { BODY_PROPS, CMP, cmpSym, compare } from './types';

const SOP = CTX_SELF | CTX_OTHER | CTX_POINT;

/** Iterate live body indices whose group is in mask. */
function eachBody(sim: Sim, mask: Uint8Array, f: (i: number) => void) {
  const w = sim.world;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] && !sim.pendingDead[i] && mask[w.group[i]]) f(i);
  }
}

function eachCollider(sim: Sim, mask: Uint8Array, f: (c: number) => void) {
  const w = sim.world;
  for (let c = 0; c < w.colAlive.length; c++) if (w.colAlive[c] && mask[w.colGroup[c]]) f(c);
}

/** Group index of a ref param, -1 for "any" or unknown. */
function refGroup(sim: Sim, id: string): number {
  if (!id) return -1;
  return sim.groupByNode.get(id) ?? -2; // -2: points at a missing node, matches nothing
}

const crossed = (prev: number, now: number, every: number) =>
  every > 0 && Math.floor(now / every + 1e-9) > Math.floor(prev / every + 1e-9);

export const start: TriggerBlock = {
  type: 'start', category: 'trigger', label: 'Start', objectInput: 'none',
  params: [],
  provides: () => 0,
  setup(sim, t) {
    sim.hooks.step.push(() => { if (sim.world.stepCount === 1) sim.fire(t, NONE); });
  },
};

export const every: TriggerBlock = {
  type: 'every', category: 'trigger', label: 'Every', objectInput: 'optional',
  params: [
    { key: 'interval', label: 'Interval', type: 'number', default: 1, min: 0.05, max: 3600, step: 0.05, unit: 's' },
    { key: 'from', label: 'Starting at', type: 'number', default: 0, min: 0, max: 36000, step: 1, unit: 's' },
  ],
  provides: (_p, has) => (has ? CTX_SELF | CTX_POINT : 0),
  summary: (p) => `${p.interval}s` + (Number(p.from) > 0 ? ` from ${p.from}s` : ''),
  setup(sim, t) {
    const iv = Number(t.params.interval) || 1;
    const from = Number(t.params.from) || 0;
    if (t.objects.length === 0) {
      sim.hooks.step.push(() => { if (sim.time >= from && crossed(sim.time - sim.dt - from, sim.time - from, iv)) sim.fire(t, NONE); });
      return;
    }
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.step.push(() => {
      if (sim.time < from) return;
      eachBody(sim, mask, (i) => {
        const age = sim.time - sim.born[i];
        if (age > 0 && crossed(age - sim.dt, age, iv)) sim.fire(t, w.handleAt(i), NONE, w.x[i], w.y[i]);
      });
      eachCollider(sim, mask, (c) => {
        if (crossed(sim.time - sim.dt, sim.time, iv)) sim.fire(t, colliderRef(c), NONE, w.colX[c], w.colY[c]);
      });
    });
  },
};

export const after: TriggerBlock = {
  type: 'after', category: 'trigger', label: 'After', objectInput: 'optional',
  params: [{ key: 'time', label: 'Time', type: 'number', default: 10, min: 0, max: 36000, step: 0.1, unit: 's' }],
  provides: (_p, has) => (has ? CTX_SELF | CTX_POINT : 0),
  summary: (p) => `${p.time}s`,
  setup(sim, t) {
    const at = Number(t.params.time) || 0;
    const hit = (prev: number, now: number) => prev < at - 1e-9 && now >= at - 1e-9;
    if (t.objects.length === 0) {
      sim.hooks.step.push(() => { if (hit(sim.time - sim.dt, sim.time)) sim.fire(t, NONE); });
      return;
    }
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.step.push(() => {
      eachBody(sim, mask, (i) => {
        const age = sim.time - sim.born[i];
        if (hit(age - sim.dt, age)) sim.fire(t, w.handleAt(i), NONE, w.x[i], w.y[i]);
      });
    });
  },
};

export const bounce: TriggerBlock = {
  type: 'bounce', category: 'trigger', label: 'Bounce', objectInput: 'required',
  params: [{ key: 'wall', label: 'Off', type: 'ref', refKinds: ['ring', 'wall', 'track', 'sledge'], anyLabel: 'Any wall', default: '' }],
  provides: () => SOP,
  summary: (p, name) => (p.wall ? `off ${name(p.wall)}` : 'off any wall'),
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    const wg = refGroup(sim, t.params.wall);
    sim.hooks.wall.push((i, col, k) => {
      if (!mask[w.group[i]] || sim.pendingDead[i]) return;
      if (wg !== -1 && w.colGroup[col] !== wg) return;
      sim.fire(t, w.handleAt(i), colliderRef(col), w.cPx[k], w.cPy[k], w.cNx[k], w.cNy[k], NONE, w.cSpeed[k]);
    });
  },
};

export const touch: TriggerBlock = {
  type: 'touch', category: 'trigger', label: 'Touch', objectInput: 'required',
  params: [{ key: 'with', label: 'With', type: 'ref', refKinds: ['ball'], anyLabel: 'Any ball', default: '' }],
  provides: () => SOP,
  summary: (p, name) => (p.with ? `with ${name(p.with)}` : 'any ball'),
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    const wg = refGroup(sim, t.params.with);
    sim.hooks.body.push((a, b, k) => {
      const ga = w.group[a], gb = w.group[b];
      const px = w.cPx[k], py = w.cPy[k], nx = w.cNx[k], ny = w.cNy[k], s = w.cSpeed[k];
      if (mask[ga] && (wg === -1 || gb === wg)) sim.fire(t, w.handleAt(a), w.handleAt(b), px, py, -nx, -ny, NONE, s);
      if (mask[gb] && (wg === -1 || ga === wg)) sim.fire(t, w.handleAt(b), w.handleAt(a), px, py, nx, ny, NONE, s);
    });
  },
};

export const crossTether: TriggerBlock = {
  type: 'crossTether', category: 'trigger', label: 'Cross tether', objectInput: 'required',
  params: [],
  provides: () => SOP | CTX_TETHER,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.tether.push((i, owner, ti, k) => {
      if (!mask[w.group[i]] || sim.pendingDead[i]) return;
      sim.fire(t, w.handleAt(i), w.handleAt(owner), w.cPx[k], w.cPy[k], 0, 0, w.tetherHandleAt(ti));
    });
  },
};

export const loseTether: TriggerBlock = {
  type: 'loseTether', category: 'trigger', label: 'Lose tether', objectInput: 'required',
  params: [],
  provides: () => CTX_SELF | CTX_POINT,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.tetherLost.push((h) => {
      const i = sim.bodyIdx(h);
      if (i >= 0 && mask[w.group[i]]) sim.fire(t, h, NONE, w.x[i], w.y[i]);
    });
  },
};

/** Leave / enter: tracks inside state per container per body, with hysteresis. */
function containment(enter: boolean): TriggerBlock {
  return {
    type: enter ? 'enter' : 'leave', category: 'trigger', label: enter ? 'Enter' : 'Leave', objectInput: 'required',
    params: [{ key: 'container', label: enter ? 'Enter' : 'Leave', type: 'ref', refKinds: ['ring', 'zone'], anyLabel: 'Any ring or zone', default: '' }],
    provides: () => SOP,
    summary: (p, name) => (p.container ? name(p.container) : 'any ring or zone'),
    setup(sim, t) {
      const mask = sim.groupMask(t.objects);
      const cg = refGroup(sim, t.params.container);
      const w = sim.world;
      const states = new Map<number, Uint8Array>(); // container ref -> 0 unknown, 1 out, 2 in
      const stateFor = (ref: number) => {
        let s = states.get(ref);
        if (!s) { s = new Uint8Array(w.cap); states.set(ref, s); }
        return s;
      };
      sim.hooks.freed.push((i) => { for (const s of states.values()) s[i] = 0; });
      const containers: number[] = [];
      sim.hooks.step.push(() => {
        containers.length = 0;
        for (let c = 0; c < w.colAlive.length; c++) {
          if (!w.colAlive[c] || sim.colKind[c] !== 'ring') continue;
          if (cg === -1 ? true : w.colGroup[c] === cg) containers.push(colliderRef(c));
        }
        sim.zones.forEach((z, zi) => { if (z.alive && (cg === -1 || z.group === cg)) containers.push(zoneRef(zi)); });
        for (const ref of containers) {
          const st = stateFor(ref);
          let cx: number, cy: number, inR = 0, outR = 0, zoneBox: { w: number; h: number } | null = null;
          const zoneBoxSkip = false;
          if (isCollider(ref)) {
            const c = colliderOf(ref);
            cx = w.colX[c]; cy = w.colY[c];
            const R = w.colRadial[c] ? w.colRingR[c] : sim.colRadius[c];
            const ht = w.pHt[w.colPieceStart[c]] ?? 0;
            inR = R - ht; outR = R + ht;
            // Cheap skip: far from this ring's band and already classified.
            if (st.length && !zoneBoxSkip) {
              let near = false;
              eachBody(sim, mask, (i) => {
                if (near) return;
                const d = dmath.sqrt((w.x[i] - cx) ** 2 + (w.y[i] - cy) ** 2);
                if (st[i] === 0 || Math.abs(d - R) < ht + w.r[i] * 3 + 40) near = true;
              });
              if (!near) continue;
            }
          } else {
            const z = sim.zones[zoneOf(ref)];
            cx = z.x; cy = z.y;
            if (z.shape === 'circle') { inR = z.r; outR = z.r; } else zoneBox = { w: z.w / 2, h: z.h / 2 };
          }
          eachBody(sim, mask, (i) => {
            const dx = w.x[i] - cx, dy = w.y[i] - cy;
            let inside: boolean, outside: boolean;
            if (zoneBox) {
              inside = Math.abs(dx) < zoneBox.w && Math.abs(dy) < zoneBox.h;
              outside = !inside;
            } else {
              const d = dmath.sqrt(dx * dx + dy * dy);
              // A ball has left a ring once its center is past the ring line through the gap.
              const r = isZone(ref) ? 0 : w.r[i];
              inside = d < inR - r * 0.5;
              outside = d > outR;
              if (isZone(ref)) { inside = d < inR; outside = !inside; }
            }
            const prev = st[i];
            if (prev === 0) { st[i] = inside ? 2 : outside ? 1 : 0; return; }
            if (prev === 2 && outside) {
              st[i] = 1;
              if (!enter) sim.fire(t, w.handleAt(i), ref, w.x[i], w.y[i], dx, dy);
            } else if (prev === 1 && inside) {
              st[i] = 2;
              if (enter) sim.fire(t, w.handleAt(i), ref, w.x[i], w.y[i], -dx, -dy);
            }
          });
        }
      });
    },
  };
}
export const leave = containment(false);
export const enter = containment(true);

export const valueReaches: TriggerBlock = {
  type: 'valueReaches', category: 'trigger', label: 'Value reaches', objectInput: 'required',
  params: [
    { key: 'prop', label: 'Value', type: 'enum', default: 'speed', options: BODY_PROPS },
    CMP,
    { key: 'value', label: 'Threshold', type: 'number', default: 10, min: -1e9, max: 1e9, step: 1 },
  ],
  provides: () => CTX_SELF | CTX_POINT,
  summary: (p) => `${p.prop} ${cmpSym(p.cmp)} ${p.value}`,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    const st = new Uint8Array(w.cap); // 0 unknown, 1 false, 2 true
    sim.hooks.freed.push((i) => { st[i] = 0; });
    const { prop, cmp } = t.params;
    const x = Number(t.params.value);
    if (prop === 'stall') sim.needProgress = true;
    sim.hooks.step.push(() => {
      eachBody(sim, mask, (i) => {
        const h = w.handleAt(i);
        const now = compare(sim.prop(h, prop), cmp, x);
        const prev = st[i];
        st[i] = now ? 2 : 1;
        if (prev === 1 && now) sim.fire(t, h, NONE, w.x[i], w.y[i]);
      });
    });
  },
};

export const counterReaches: TriggerBlock = {
  type: 'counterReaches', category: 'trigger', label: 'Counter reaches', objectInput: 'none',
  params: [
    { key: 'counter', label: 'Counter', type: 'ref', refKinds: ['counter'], default: '' },
    { ...CMP, default: 'above' },
    { key: 'value', label: 'Threshold', type: 'number', default: 10, min: -1e9, max: 1e9, step: 1 },
  ],
  provides: () => 0,
  summary: (p, name) => `${p.counter ? name(p.counter) : '?'} ${cmpSym(p.cmp)} ${p.value}`,
  setup(sim, t) {
    let prev = 0;
    const x = Number(t.params.value);
    sim.hooks.step.push(() => {
      const c = sim.counter(t.params.counter);
      if (!c) return;
      const now = compare(c.value, t.params.cmp, x);
      if (prev === 1 && now) sim.fire(t, NONE);
      prev = now ? 2 : 1;
    });
  },
};

export const groupCount: TriggerBlock = {
  type: 'groupCount', category: 'trigger', label: 'Count reaches', objectInput: 'none',
  params: [
    { key: 'group', label: 'Count of', type: 'ref', refKinds: ['ball', 'ring', 'wall', 'track', 'zone'], anyLabel: 'All balls', default: '' },
    {
      key: 'cmp', label: 'When', type: 'enum', default: 'atMost',
      options: [{ value: 'atMost', label: 'At most' }, { value: 'atLeast', label: 'At least' }],
    },
    { key: 'value', label: 'Count', type: 'int', default: 1, min: 0, max: 100000, step: 1 },
  ],
  // Self is the first remaining member (handy for "last one standing").
  provides: () => CTX_SELF | CTX_POINT,
  summary: (p, name) => `${p.group ? name(p.group) : 'balls'} ${p.cmp === 'atMost' ? '≤' : '≥'} ${p.value}`,
  setup(sim, t) {
    const g = refGroup(sim, t.params.group);
    const x = Number(t.params.value);
    let prev = 0;
    const tmp: number[] = [];
    const w = sim.world;
    sim.hooks.step.push(() => {
      const n = g === -1 ? sim.countAllBalls() : g < 0 ? 0 : sim.countGroup(g);
      const now = t.params.cmp === 'atMost' ? n <= x : n >= x;
      if (prev === 1 && now) {
        let self = NONE;
        if (g === -1) {
          for (let i = 0; i < w.highWater; i++) if (w.alive[i] && !sim.pendingDead[i]) { self = w.handleAt(i); break; }
        } else if (g >= 0) self = sim.membersOf(g, tmp)[0] ?? NONE;
        const i = self >= 0 ? w.indexOf(self) : -1;
        sim.fire(t, self, NONE, i >= 0 ? w.x[i] : 0, i >= 0 ? w.y[i] : 0);
      }
      prev = now ? 2 : 1;
    });
  },
};

export const spawned: TriggerBlock = {
  type: 'spawned', category: 'trigger', label: 'Spawned', objectInput: 'required',
  params: [],
  provides: () => CTX_SELF | CTX_POINT,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.spawned.push((h, g) => {
      const i = sim.bodyIdx(h);
      if (i >= 0 && mask[g]) sim.fire(t, h, NONE, w.x[i], w.y[i]);
    });
  },
};

export const destroyed: TriggerBlock = {
  type: 'destroyed', category: 'trigger', label: 'Destroyed', objectInput: 'required',
  params: [],
  provides: () => CTX_SELF | CTX_POINT,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    sim.hooks.destroyed.push((h, g, x, y) => { if (mask[g]) sim.fireDead(t, h, x, y); });
  },
};

export const fill: TriggerBlock = {
  type: 'fill', category: 'trigger', label: 'Fills up', objectInput: 'none',
  params: [
    { key: 'container', label: 'Container', type: 'ref', refKinds: ['ring', 'zone'], default: '' },
    { key: 'percent', label: 'Full at', type: 'number', default: 75, min: 1, max: 100, step: 1, unit: '%' },
    { key: 'hold', label: 'For', type: 'number', default: 3, min: 0, max: 120, step: 0.1, unit: 's' },
  ],
  provides: () => CTX_POINT,
  summary: (p, name) => `${p.container ? name(p.container) : '?'} ${p.percent}% for ${p.hold}s`,
  setup(sim, t) {
    const g = refGroup(sim, t.params.container);
    const thr = Number(t.params.percent) / 100;
    const hold = Number(t.params.hold);
    let since = -1;
    let fired = false;
    let k = 0;
    sim.hooks.step.push(() => {
      if (fired || g < 0) return;
      if ((k++ & 7) !== 0) return; // check 15 times a second
      const full = sim.fillRatio(g) >= thr;
      if (!full) { since = -1; return; }
      if (since < 0) since = sim.time;
      if (sim.time - since >= hold) {
        fired = true;
        const m = sim.membersOf(g)[0];
        let x = 0, y = 0;
        if (m !== undefined && isCollider(m)) { x = sim.world.colX[colliderOf(m)]; y = sim.world.colY[colliderOf(m)]; }
        sim.fire(t, NONE, NONE, x, y);
      }
    });
  },
};

export const crushed: TriggerBlock = {
  type: 'crushed', category: 'trigger', label: 'Crushed', objectInput: 'required',
  params: [],
  provides: () => CTX_SELF | CTX_POINT,
  setup(sim, t) {
    const mask = sim.groupMask(t.objects);
    const w = sim.world;
    sim.hooks.crushed.push((i, x, y) => { if (mask[w.group[i]]) sim.fire(t, w.handleAt(i), NONE, x, y); });
  },
};

export const TRIGGER_BLOCKS: TriggerBlock[] = [fill, crushed, 
  start, every, after, bounce, touch, crossTether, loseTether, leave, enter,
  valueReaches, counterReaches, groupCount, spawned, destroyed,
];

export type { CompiledTrigger };
