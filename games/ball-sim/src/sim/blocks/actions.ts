import { CTX_SELF, CTX_OTHER, CTX_POINT, CTX_TETHER, dmath } from '@engine/index';
import type { CompiledNode, ParamSpec, Params } from '@engine/index';
import type { Sim } from '../sim';
import type { SimEvent, LookSetting } from '../types';
import { isBody, isCollider, colliderOf, NONE } from '../types';
import { LookPicker } from '../looks';
import type { ActionBlock } from './types';

const D2R = dmath.PI / 180;
const ANY_KIND = ['ball', 'ring', 'wall', 'track', 'zone'];

function targetParams(opts: { defaults?: boolean; kinds?: string[] } = {}): ParamSpec[] {
  return [
    {
      key: 'target', label: 'Target', type: 'enum', default: 'self',
      options: [
        { value: 'self', label: 'Self', needs: CTX_SELF },
        { value: 'other', label: 'Other', needs: CTX_OTHER },
        { value: 'group', label: 'Group' },
        ...(opts.defaults ? [{ value: 'defaults', label: 'Future spawns' }] : []),
      ],
    },
    {
      key: 'group', label: 'Group', type: 'ref', refKinds: opts.kinds ?? ANY_KIND, default: '',
      showIf: (p) => p.target === 'group' || p.target === 'defaults',
    },
  ];
}

const tmpRefs: number[] = [];
function targets(sim: Sim, p: Params, e: SimEvent): number[] {
  tmpRefs.length = 0;
  if (p.target === 'self') { if (e.self !== NONE) tmpRefs.push(e.self); }
  else if (p.target === 'other') { if (e.other !== NONE) tmpRefs.push(e.other); }
  else if (p.target === 'group') {
    const g = sim.groupByNode.get(p.group);
    if (g !== undefined) sim.membersOf(g, tmpRefs);
  }
  return tmpRefs.slice();
}

const targetText = (p: Params, name: (id: string) => string) =>
  p.target === 'group' ? (p.group ? `all ${name(p.group)}` : 'group ?') : p.target === 'defaults' ? `new ${name(p.group)}` : p.target;

const apply = (v: number, op: string, x: number) => (op === 'add' ? v + x : op === 'multiply' ? v * x : x);
const opSym = (op: string) => (op === 'add' ? '+' : op === 'multiply' ? '×' : '=');

export const setProp: ActionBlock = {
  type: 'setProp', category: 'action', label: 'Change',
  params: [
    ...targetParams({ defaults: true }),
    {
      key: 'prop', label: 'Property', type: 'enum', default: 'speed',
      options: [
        { value: 'speed', label: 'Speed' }, { value: 'size', label: 'Size' }, { value: 'hp', label: 'HP' },
        { value: 'bounciness', label: 'Bounciness' }, { value: 'mass', label: 'Mass' },
        { value: 'gravity', label: 'Gravity' }, { value: 'drag', label: 'Drag' }, { value: 'spin', label: 'Spin (walls)' },
      ],
    },
    {
      key: 'op', label: 'By', type: 'enum', default: 'multiply',
      options: [{ value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }, { value: 'set', label: 'Set' }],
    },
    { key: 'amount', label: 'Amount', type: 'number', default: 1.05, min: -1e6, max: 1e6, step: 0.01 },
    { key: 'clamp', label: 'Limit', type: 'bool', default: false },
    { key: 'min', label: 'Min', type: 'number', default: 0, min: -1e9, max: 1e9, step: 1, showIf: (p) => p.clamp },
    { key: 'max', label: 'Max', type: 'number', default: 1000, min: -1e9, max: 1e9, step: 1, showIf: (p) => p.clamp },
  ],
  summary: (p, name) => `${targetText(p, name)} ${p.prop} ${opSym(p.op)} ${p.amount}`,
  run(sim, n, e) {
    const p = n.params;
    const x = Number(p.amount);
    const lim = (v: number) => (p.clamp ? Math.min(Number(p.max), Math.max(Number(p.min), v)) : v);
    if (p.target === 'defaults') {
      const g = sim.groupOf(p.group);
      if (!g) return;
      const key = ({ speed: 'speed', size: 'radius', hp: 'hp', bounciness: 'bounciness', gravity: 'gravity', drag: 'drag', mass: 'density' } as Record<string, string>)[p.prop];
      if (key) g.template[key] = lim(apply(Number(g.template[key]) || 0, p.op, x));
      return;
    }
    const w = sim.world;
    for (const ref of targets(sim, p, e)) {
      if (isCollider(ref)) {
        const c = colliderOf(ref);
        if (!w.colAlive[c]) continue;
        if (p.prop === 'spin') sim.setSpin(c, lim(apply(sim.colMotion[c].rate / D2R, p.op, x)) * D2R);
        else if (p.prop === 'bounciness') w.colRest[c] = lim(apply(w.colRest[c], p.op, x));
        continue;
      }
      const i = sim.bodyIdx(ref);
      if (i < 0) continue;
      switch (p.prop) {
        case 'speed': {
          const s = dmath.sqrt(w.vx[i] ** 2 + w.vy[i] ** 2);
          const ns = Math.max(0, lim(apply(s, p.op, x)));
          if (s > 1e-9) { w.vx[i] *= ns / s; w.vy[i] *= ns / s; }
          else if (ns > 0) { const a = sim.rng.range(0, dmath.TAU); w.vx[i] = dmath.cos(a) * ns; w.vy[i] = dmath.sin(a) * ns; }
          break;
        }
        case 'size': {
          const r0 = w.r[i];
          const r = Math.max(0.5, lim(apply(r0, p.op, x)));
          if (w.invMass[i] > 0) w.invMass[i] *= (r0 * r0) / (r * r);
          w.r[i] = r;
          break;
        }
        case 'hp':
          sim.hp[i] = lim(apply(sim.hp[i], p.op, x));
          if (sim.hp[i] > sim.maxHp[i]) sim.maxHp[i] = sim.hp[i];
          break;
        case 'bounciness': w.restitution[i] = Math.max(0, lim(apply(w.restitution[i], p.op, x))); break;
        case 'mass': {
          if (w.invMass[i] > 0) w.invMass[i] = 1 / Math.max(1e-6, lim(apply(1 / w.invMass[i], p.op, x)));
          break;
        }
        case 'gravity': w.gravityScale[i] = lim(apply(w.gravityScale[i], p.op, x)); break;
        case 'drag': w.damping[i] = Math.max(0, lim(apply(w.damping[i], p.op, x))); break;
      }
    }
  },
};

export const push: ActionBlock = {
  type: 'push', category: 'action', label: 'Push',
  params: [
    ...targetParams({ kinds: ['ball'] }),
    {
      key: 'direction', label: 'Direction', type: 'enum', default: 'forward',
      options: [
        { value: 'forward', label: 'Forward' },
        { value: 'away', label: 'Away from hit', needs: CTX_POINT },
        { value: 'toward', label: 'Toward hit', needs: CTX_POINT },
        { value: 'center', label: 'To center' },
        { value: 'random', label: 'Random' },
        { value: 'angle', label: 'Angle' },
      ],
    },
    { key: 'angle', label: 'Angle', type: 'angle', default: -90, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.direction === 'angle' },
    { key: 'strength', label: 'Strength', type: 'number', default: 200, min: -10000, max: 10000, step: 1 },
  ],
  summary: (p, name) => `${targetText(p, name)} ${p.direction} ${p.strength}`,
  run(sim, n, e) {
    const p = n.params;
    const w = sim.world;
    const s = Number(p.strength);
    for (const ref of targets(sim, p, e)) {
      const i = sim.bodyIdx(ref);
      if (i < 0) continue;
      let dx = 0, dy = 0;
      switch (p.direction) {
        case 'forward': dx = w.vx[i]; dy = w.vy[i]; break;
        case 'away':
          if (ref === e.self && (e.nx || e.ny)) { dx = e.nx; dy = e.ny; } else { dx = w.x[i] - e.px; dy = w.y[i] - e.py; }
          break;
        case 'toward': dx = e.px - w.x[i]; dy = e.py - w.y[i]; break;
        case 'center': dx = -w.x[i]; dy = -w.y[i]; break;
        case 'random': { const a = sim.rng.range(0, dmath.TAU); dx = dmath.cos(a); dy = dmath.sin(a); break; }
        case 'angle': dx = dmath.cos(Number(p.angle) * D2R); dy = dmath.sin(Number(p.angle) * D2R); break;
      }
      const len = dmath.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) continue;
      w.vx[i] += (dx / len) * s;
      w.vy[i] += (dy / len) * s;
    }
  },
};

export const explode: ActionBlock = {
  type: 'explode', category: 'action', label: 'Explode',
  params: [
    {
      key: 'at', label: 'At', type: 'enum', default: 'point',
      options: [
        { value: 'point', label: 'Event point', needs: CTX_POINT },
        { value: 'center', label: 'Center' },
        { value: 'fixed', label: 'Position' },
      ],
    },
    { key: 'x', label: 'X', type: 'number', default: 0, min: -5000, max: 5000, step: 1, showIf: (p) => p.at === 'fixed' },
    { key: 'y', label: 'Y', type: 'number', default: 0, min: -5000, max: 5000, step: 1, showIf: (p) => p.at === 'fixed' },
    { key: 'radius', label: 'Radius', type: 'number', default: 150, min: 1, max: 10000, step: 1 },
    { key: 'strength', label: 'Strength', type: 'number', default: 600, min: -20000, max: 20000, step: 1 },
  ],
  summary: (p) => `r ${p.radius}, ${p.strength}`,
  run(sim, n, e) {
    const p = n.params;
    const w = sim.world;
    const cx = p.at === 'point' ? e.px : p.at === 'fixed' ? Number(p.x) : 0;
    const cy = p.at === 'point' ? e.py : p.at === 'fixed' ? Number(p.y) : 0;
    const R = Number(p.radius), s = Number(p.strength);
    sim.flash.push({ x: cx, y: cy, r: R, t: sim.time });
    for (let i = 0; i < w.highWater; i++) {
      if (!w.alive[i] || sim.pendingDead[i] || w.invMass[i] === 0) continue;
      const dx = w.x[i] - cx, dy = w.y[i] - cy;
      const d = dmath.sqrt(dx * dx + dy * dy);
      if (d >= R) continue;
      const f = s * (1 - d / R);
      if (d < 1e-6) { const a = sim.rng.range(0, dmath.TAU); w.vx[i] += dmath.cos(a) * f; w.vy[i] += dmath.sin(a) * f; }
      else { w.vx[i] += (dx / d) * f; w.vy[i] += (dy / d) * f; }
    }
  },
};

export const duplicate: ActionBlock = {
  type: 'duplicate', category: 'action', label: 'Duplicate',
  params: [
    ...targetParams({ kinds: ['ball'] }),
    { key: 'count', label: 'Copies', type: 'int', default: 1, min: 1, max: 20, step: 1 },
    { key: 'spread', label: 'Spread', type: 'angle', default: 60, min: 0, max: 360, step: 1, unit: '°' },
  ],
  summary: (p, name) => `${targetText(p, name)} × ${Number(p.count) + 1}`,
  run(sim, n, e) {
    const p = n.params;
    const w = sim.world;
    const copies = Math.max(1, Math.min(20, p.count | 0));
    const spread = Number(p.spread) * D2R;
    for (const ref of targets(sim, p, e)) {
      const i = sim.bodyIdx(ref);
      if (i < 0) continue;
      for (let k = 0; k < copies; k++) {
        const a = sim.rng.range(-spread / 2, spread / 2);
        const c = dmath.cos(a), s = dmath.sin(a);
        const vx = w.vx[i] * c - w.vy[i] * s, vy = w.vx[i] * s + w.vy[i] * c;
        const sp = dmath.sqrt(vx * vx + vy * vy);
        const ox = sp > 1e-9 ? (vx / sp) * w.r[i] * 0.5 : sim.rng.range(-1, 1);
        const oy = sp > 1e-9 ? (vy / sp) * w.r[i] * 0.5 : sim.rng.range(-1, 1);
        sim.queueSpawn({ group: w.group[i], x: w.x[i] + ox, y: w.y[i] + oy, vx, vy, from: i });
      }
    }
  },
};

export const spawn: ActionBlock = {
  type: 'spawn', category: 'action', label: 'Spawn',
  params: [
    { key: 'group', label: 'Spawn', type: 'ref', refKinds: ['ball'], default: '' },
    { key: 'count', label: 'Count', type: 'int', default: 1, min: 1, max: 200, step: 1 },
    {
      key: 'at', label: 'At', type: 'enum', default: 'home',
      options: [
        { value: 'home', label: 'Its placement' },
        { value: 'self', label: 'Self', needs: CTX_SELF | CTX_POINT },
        { value: 'point', label: 'Event point', needs: CTX_POINT },
        { value: 'center', label: 'Center' },
      ],
    },
  ],
  summary: (p, name) => `${p.count} ${p.group ? name(p.group) : '?'}`,
  run(sim, n, e) {
    const p = n.params;
    const g = sim.groupOf(p.group);
    if (!g || g.kind !== 'ball') return;
    const P = { x: 0, y: 0 }, V = { x: 0, y: 0 };
    const count = Math.max(1, Math.min(200, p.count | 0));
    for (let k = 0; k < count; k++) {
      if (p.at === 'home') sim.spawnPoint(g, k, count, P);
      else if (p.at === 'center') { P.x = 0; P.y = 0; }
      else if (p.at === 'self') {
        const i = sim.bodyIdx(e.self);
        if (i >= 0) { P.x = sim.world.x[i]; P.y = sim.world.y[i]; } else { P.x = e.px; P.y = e.py; }
      } else { P.x = e.px; P.y = e.py; }
      sim.spawnVelocity(g, P.x, P.y, V);
      sim.queueSpawn({ group: g.index, x: P.x, y: P.y, vx: V.x, vy: V.y, from: -1 });
    }
  },
};

export const destroy: ActionBlock = {
  type: 'destroy', category: 'action', label: 'Destroy',
  params: targetParams(),
  summary: (p, name) => targetText(p, name),
  run(sim, n, e) {
    for (const ref of targets(sim, n.params, e)) sim.queueDestroy(ref);
  },
};

export const attachTether: ActionBlock = {
  type: 'attachTether', category: 'action', label: 'Attach tether',
  params: [
    {
      key: 'to', label: 'To', type: 'enum', default: 'point',
      options: [
        { value: 'point', label: 'Hit point', needs: CTX_SELF | CTX_POINT },
        { value: 'other', label: 'Other ball', needs: CTX_SELF | CTX_OTHER },
        { value: 'center', label: 'Center', needs: CTX_SELF },
      ],
    },
    { key: 'stiffness', label: 'Pull', type: 'number', default: 2, min: 0, max: 500, step: 0.1 },
    { key: 'damping', label: 'Damping', type: 'number', default: 0, min: 0, max: 50, step: 0.1 },
    {
      key: 'slack', label: 'Rest length', type: 'enum', default: 'zero',
      options: [{ value: 'zero', label: 'Zero' }, { value: 'current', label: 'Current' }, { value: 'fixed', label: 'Fixed' }],
    },
    { key: 'length', label: 'Length', type: 'number', default: 100, min: 0, max: 10000, step: 1, showIf: (p) => p.slack === 'fixed' },
    { key: 'maxLength', label: 'Max length', type: 'number', default: 0, min: 0, max: 10000, step: 1 },
    { key: 'limit', label: 'Max per ball', type: 'int', default: 0, min: 0, max: 1000, step: 1 },
  ],
  summary: (p) => `to ${p.to}, pull ${p.stiffness}`,
  run(sim, n, e) {
    const p = n.params;
    const w = sim.world;
    const i = sim.bodyIdx(e.self);
    if (i < 0) return;
    if (p.limit > 0 && w.tetherCount[i] >= p.limit) return;
    let anchor;
    if (p.to === 'other') {
      if (!isBody(e.other) || sim.bodyIdx(e.other) < 0) return;
      anchor = { kind: 'body' as const, body: e.other };
    } else if (p.to === 'center') anchor = { kind: 'point' as const, x: 0, y: 0 };
    else if (isCollider(e.other) && w.colAlive[colliderOf(e.other)]) anchor = { kind: 'collider' as const, collider: colliderOf(e.other), x: e.px, y: e.py };
    else anchor = { kind: 'point' as const, x: e.px, y: e.py };
    const h = w.addTether({
      body: e.self, anchor,
      stiffness: Number(p.stiffness), damping: Number(p.damping),
      restLength: p.slack === 'zero' ? 0 : p.slack === 'fixed' ? Number(p.length) : undefined,
      maxLength: Number(p.maxLength) > 0 ? Number(p.maxLength) : Infinity,
    });
    if (h >= 0) sim.noteTether(h);
  },
};

export const cutTether: ActionBlock = {
  type: 'cutTether', category: 'action', label: 'Cut tether',
  params: [
    {
      key: 'which', label: 'Which', type: 'enum', default: 'crossed',
      options: [
        { value: 'crossed', label: 'The crossed one', needs: CTX_TETHER },
        { value: 'oldest', label: 'Oldest' }, { value: 'newest', label: 'Newest' }, { value: 'all', label: 'All' },
      ],
    },
    ...targetParams({ kinds: ['ball'] }).map((ps) => ({ ...ps, showIf: (p: Params) => p.which !== 'crossed' && (ps.showIf ? ps.showIf(p) : true) })),
  ],
  needs: (p) => (p.which === 'crossed' ? CTX_TETHER | CTX_SELF | CTX_OTHER | CTX_POINT : p.target === 'self' ? CTX_SELF : p.target === 'other' ? CTX_OTHER : 0),
  summary: (p, name) => (p.which === 'crossed' ? 'the crossed one' : `${p.which} of ${targetText(p, name)}`),
  run(sim, n, e) {
    const p = n.params;
    const w = sim.world;
    if (p.which === 'crossed') {
      const t = w.tetherIndexOf(e.tether);
      if (t >= 0) sim.cutTetherIndex(t);
      return;
    }
    for (const ref of targets(sim, p, e)) {
      const i = sim.bodyIdx(ref);
      if (i < 0 || w.tetherCount[i] === 0) continue;
      let best = -1, bestSeq = 0;
      for (let t = 0; t < w.tetherHigh; t++) {
        if (!w.tAlive[t] || w.tBody[t] !== i) continue;
        if (p.which === 'all') { sim.cutTetherIndex(t); continue; }
        const s = sim.tSeq[t];
        if (best < 0 || (p.which === 'oldest' ? s < bestSeq : s > bestSeq)) { best = t; bestSeq = s; }
      }
      if (best >= 0) sim.cutTetherIndex(best);
    }
  },
};

export const setGroup: ActionBlock = {
  type: 'setGroup', category: 'action', label: 'Move to group',
  params: [
    ...targetParams({ kinds: ['ball'] }),
    { key: 'to', label: 'Into', type: 'ref', refKinds: ['ball'], default: '' },
  ],
  summary: (p, name) => `${targetText(p, name)} → ${p.to ? name(p.to) : '?'}`,
  run(sim, n, e) {
    const g = sim.groupByNode.get(n.params.to);
    if (g === undefined) return;
    for (const ref of targets(sim, n.params, e)) {
      const i = sim.bodyIdx(ref);
      if (i >= 0) sim.world.group[i] = g;
    }
  },
};

const pickers = new WeakMap<CompiledNode, LookPicker>();
export const setLook: ActionBlock = {
  type: 'setLook', category: 'action', label: 'Change look',
  params: [
    ...targetParams({ kinds: ['ball'] }),
    { key: 'look', label: 'Look', type: 'look', default: { mode: 'preset', preset: 'palette' } },
  ],
  summary: (p, name) => targetText(p, name),
  run(sim, n, e) {
    let pk = pickers.get(n);
    if (!pk) {
      pk = new LookPicker(n.params.look as LookSetting, sim.lookRng, Object.keys(sim.assets), 12);
      pickers.set(n, pk);
    }
    for (const ref of targets(sim, n.params, e)) {
      const i = sim.bodyIdx(ref);
      if (i >= 0) sim.look[i] = sim.lookId(pk.next());
    }
  },
};

export const counterAction: ActionBlock = {
  type: 'count', category: 'action', label: 'Counter',
  params: [
    { key: 'counter', label: 'Counter', type: 'ref', refKinds: ['counter'], default: '' },
    {
      key: 'op', label: 'By', type: 'enum', default: 'add',
      options: [{ value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }, { value: 'set', label: 'Set' }],
    },
    { key: 'amount', label: 'Amount', type: 'number', default: 1, min: -1e9, max: 1e9, step: 1 },
  ],
  summary: (p, name) => `${p.counter ? name(p.counter) : '?'} ${opSym(p.op)} ${p.amount}`,
  run(sim, n) {
    const c = sim.counter(n.params.counter);
    if (c) c.value = apply(c.value, n.params.op, Number(n.params.amount));
  },
};

export const gravity: ActionBlock = {
  type: 'gravity', category: 'action', label: 'Set gravity',
  params: [
    { key: 'mode', label: 'Pull', type: 'enum', default: 'linear', options: [{ value: 'linear', label: 'Direction' }, { value: 'point', label: 'To center' }] },
    { key: 'strength', label: 'Strength', type: 'number', default: 400, min: -10000, max: 10000, step: 1 },
    { key: 'angle', label: 'Angle', type: 'angle', default: 90, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.mode === 'linear' },
  ],
  summary: (p) => (p.mode === 'point' ? `to center ${p.strength}` : `${p.strength} at ${p.angle}°`),
  run(sim, n) {
    const p = n.params;
    const w = sim.world;
    w.gravityMode = p.mode;
    const a = p.mode === 'point' ? 0 : Number(p.angle) * D2R;
    w.gravityX = dmath.cos(a) * Number(p.strength);
    w.gravityY = dmath.sin(a) * Number(p.strength);
  },
};

export const end: ActionBlock = {
  type: 'end', category: 'action', label: 'End',
  params: [{ key: 'label', label: 'Outcome', type: 'text', default: 'Done' }],
  summary: (p) => `“${p.label}”`,
  run(sim, n, e) {
    const label = String(n.params.label ?? '')
      .replace(/\{self\}/g, e.self !== NONE ? sim.nameOf(e.self) : 'Nobody')
      .replace(/\{time\}/g, `${sim.time.toFixed(1)}s`);
    sim.end(label);
  },
};

export const ACTION_BLOCKS: ActionBlock[] = [
  setProp, push, explode, duplicate, spawn, destroy, attachTether, cutTether,
  setGroup, setLook, counterAction, gravity, end,
];
