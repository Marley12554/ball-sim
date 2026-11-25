import { dmath, ring, box, spiral } from '@engine/index';
import type { ParamSpec } from '@engine/index';
import type { ObjectBlock } from './types';
import type { Gap } from '@engine/index';

const D2R = dmath.PI / 180;
const name = (d: string): ParamSpec => ({ key: 'name', label: 'Name', type: 'text', default: d });
const color = (d: string): ParamSpec => ({ key: 'color', label: 'Color', type: 'color', default: d });
const pos: ParamSpec[] = [
  { key: 'x', label: 'X', type: 'number', default: 0, min: -5000, max: 5000, step: 1 },
  { key: 'y', label: 'Y', type: 'number', default: 0, min: -5000, max: 5000, step: 1 },
];
const bounce: ParamSpec = { key: 'bounciness', label: 'Bounciness', type: 'number', default: 1, min: 0, max: 2, step: 0.01 };

export const ball: ObjectBlock = {
  type: 'ball', category: 'object', kind: 'ball', label: 'Balls', output: true,
  params: [
    name('Balls'),
    { key: 'count', label: 'Count', type: 'int', default: 1, min: 0, max: 5000, step: 1 },
    { key: 'look', label: 'Look', type: 'look', default: { mode: 'preset', preset: 'palette' } },
    { key: 'radius', label: 'Size', type: 'number', default: 8, min: 0.5, max: 300, step: 0.1 },
    { key: 'density', label: 'Density', type: 'number', default: 1, min: 0.01, max: 100, step: 0.01 },
    bounce,
    { key: 'drag', label: 'Drag', type: 'number', default: 0, min: 0, max: 10, step: 0.01 },
    { key: 'gravity', label: 'Gravity', type: 'number', default: 1, min: -5, max: 5, step: 0.05, unit: 'x' },
    { key: 'hp', label: 'HP', type: 'number', default: 0, min: 0, max: 100000, step: 1 },
    { key: 'collide', label: 'Hit other balls', type: 'bool', default: true },
    {
      key: 'placement', label: 'Placement', type: 'enum', default: 'point',
      options: [
        { value: 'point', label: 'Point' }, { value: 'scatter', label: 'Scatter' },
        { value: 'circle', label: 'Circle' }, { value: 'line', label: 'Line' }, { value: 'grid', label: 'Grid' },
      ],
    },
    ...pos,
    { key: 'spread', label: 'Spread', type: 'number', default: 0, min: 0, max: 5000, step: 1, showIf: (p) => p.placement !== 'point' },
    {
      key: 'direction', label: 'Direction', type: 'enum', default: 'random',
      options: [
        { value: 'random', label: 'Random' }, { value: 'angle', label: 'Angle' },
        { value: 'outward', label: 'Outward' }, { value: 'inward', label: 'Inward' }, { value: 'tangent', label: 'Around' },
      ],
    },
    { key: 'angle', label: 'Angle', type: 'angle', default: 0, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.direction === 'angle' },
    { key: 'speed', label: 'Speed', type: 'number', default: 200, min: 0, max: 5000, step: 1 },
    { key: 'speedJitter', label: 'Speed variation', type: 'number', default: 0, min: 0, max: 5000, step: 1 },
  ],
  summary: (p) => `${p.count} × size ${p.radius}`,
  build(sim, g) {
    const n = Math.max(0, Number(g.params.count) | 0);
    const P = { x: 0, y: 0 }, V = { x: 0, y: 0 };
    for (let k = 0; k < n; k++) {
      sim.spawnPoint(g, k, n, P);
      sim.spawnVelocity(g, P.x, P.y, V);
      if (sim.createBall(g, P.x, P.y, V.x, V.y) < 0) break;
    }
  },
};

export const ringBlock: ObjectBlock = {
  type: 'ring', category: 'object', kind: 'ring', label: 'Rings', output: true,
  params: [
    name('Rings'),
    { key: 'count', label: 'Count', type: 'int', default: 1, min: 1, max: 100, step: 1 },
    { key: 'radius', label: 'Radius', type: 'number', default: 200, min: 5, max: 5000, step: 1 },
    { key: 'spacing', label: 'Spacing', type: 'number', default: 24, min: 1, max: 1000, step: 1, showIf: (p) => p.count > 1 },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 4, min: 0.5, max: 100, step: 0.5 },
    { key: 'gaps', label: 'Gaps', type: 'int', default: 1, min: 0, max: 12, step: 1 },
    { key: 'gapWidth', label: 'Gap width', type: 'angle', default: 30, min: 1, max: 180, step: 1, unit: '°', showIf: (p) => p.gaps > 0 },
    {
      key: 'gapPlacement', label: 'Gap placement', type: 'enum', default: 'random', showIf: (p) => p.gaps > 0,
      options: [{ value: 'random', label: 'Random' }, { value: 'aligned', label: 'Aligned' }, { value: 'stagger', label: 'Stagger' }],
    },
    { key: 'gapAngle', label: 'Gap angle', type: 'angle', default: -90, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.gaps > 0 && p.gapPlacement !== 'random' },
    { key: 'spin', label: 'Spin', type: 'number', default: 45, min: -2000, max: 2000, step: 1, unit: '°/s' },
    {
      key: 'spinPattern', label: 'Spin pattern', type: 'enum', default: 'alternate', showIf: (p) => p.count > 1,
      options: [{ value: 'same', label: 'Same' }, { value: 'alternate', label: 'Alternate' }, { value: 'faster', label: 'Faster out' }],
    },
    bounce,
    color('#5B6270'),
    ...pos,
  ],
  summary: (p) => (p.count > 1 ? `${p.count} rings, ${p.gaps} gap${p.gaps === 1 ? '' : 's'}` : `r ${p.radius}, ${p.gaps} gap${p.gaps === 1 ? '' : 's'}`),
  build(sim, g) {
    const p = g.params;
    const n = Math.max(1, p.count | 0);
    for (let k = 0; k < n; k++) {
      const R = Number(p.radius) + k * Number(p.spacing);
      const gaps: Gap[] = [];
      const ng = p.gaps | 0;
      let base: number;
      if (p.gapPlacement === 'random') base = sim.rng.range(0, dmath.TAU);
      else if (p.gapPlacement === 'stagger') base = (Number(p.gapAngle) + k * 137.508) * D2R;
      else base = Number(p.gapAngle) * D2R;
      for (let j = 0; j < ng; j++) gaps.push({ at: base + (j * dmath.TAU) / ng, width: Number(p.gapWidth) * D2R });
      let rate = Number(p.spin) * D2R;
      if (p.spinPattern === 'alternate' && k % 2 === 1) rate = -rate;
      if (p.spinPattern === 'faster') rate *= 1 + k * 0.2;
      sim.addCollider(g, 'ring', {
        x: Number(p.x) || 0, y: Number(p.y) || 0,
        pieces: ring(R, Number(p.thickness) / 2, gaps),
        restitution: Number(p.bounciness),
      }, R, { type: 'spin', rate });
    }
  },
};

export const wall: ObjectBlock = {
  type: 'wall', category: 'object', kind: 'wall', label: 'Wall', output: true,
  params: [
    name('Wall'),
    {
      key: 'shape', label: 'Shape', type: 'enum', default: 'box',
      options: [{ value: 'box', label: 'Box' }, { value: 'line', label: 'Line' }, { value: 'arc', label: 'Arc' }],
    },
    ...pos,
    { key: 'angle', label: 'Angle', type: 'angle', default: 0, min: -360, max: 360, step: 1, unit: '°' },
    { key: 'width', label: 'Width', type: 'number', default: 500, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'height', label: 'Height', type: 'number', default: 500, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'length', label: 'Length', type: 'number', default: 200, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'line' },
    { key: 'radius', label: 'Radius', type: 'number', default: 200, min: 1, max: 5000, step: 1, showIf: (p) => p.shape === 'arc' },
    { key: 'span', label: 'Span', type: 'angle', default: 180, min: 1, max: 360, step: 1, unit: '°', showIf: (p) => p.shape === 'arc' },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 4, min: 0.5, max: 200, step: 0.5 },
    bounce,
    {
      key: 'motion', label: 'Motion', type: 'enum', default: 'none',
      options: [{ value: 'none', label: 'Still' }, { value: 'spin', label: 'Spin' }, { value: 'swing', label: 'Swing' }, { value: 'slide', label: 'Slide' }],
    },
    { key: 'rate', label: 'Spin', type: 'number', default: 90, min: -3000, max: 3000, step: 1, unit: '°/s', showIf: (p) => p.motion === 'spin' },
    { key: 'amount', label: 'Amount', type: 'number', default: 30, min: 0, max: 5000, step: 1, showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    { key: 'period', label: 'Period', type: 'number', default: 1, min: 0.05, max: 60, step: 0.05, unit: 's', showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    { key: 'phase', label: 'Phase', type: 'angle', default: 0, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    color('#5B6270'),
  ],
  summary: (p) => (p.shape === 'box' ? `${p.width} × ${p.height}` : p.shape === 'line' ? `line ${p.length}` : `arc ${p.span}°`) + (p.motion !== 'none' ? `, ${p.motion}` : ''),
  build(sim, g) {
    const p = g.params;
    const ht = Number(p.thickness) / 2;
    let pieces;
    let radius: number;
    if (p.shape === 'line') {
      pieces = [{ kind: 'segment' as const, ax: 0, ay: 0, bx: Number(p.length), by: 0, halfThickness: ht }];
      radius = Number(p.length);
    } else if (p.shape === 'arc') {
      const span = Number(p.span) * D2R;
      pieces = [{ kind: 'arc' as const, radius: Number(p.radius), start: -span / 2, span, halfThickness: ht }];
      radius = Number(p.radius);
    } else {
      pieces = box(Number(p.width), Number(p.height), ht);
      radius = dmath.sqrt(p.width * p.width + p.height * p.height) / 2;
    }
    const angle = Number(p.angle) * D2R;
    const motion = p.motion as string;
    sim.addCollider(g, 'wall', {
      x: Number(p.x) || 0, y: Number(p.y) || 0, angle, pieces, restitution: Number(p.bounciness),
    }, radius, {
      type: motion as 'none' | 'spin' | 'swing' | 'slide',
      rate: Number(p.rate) * D2R,
      amp: motion === 'swing' ? Number(p.amount) * D2R : Number(p.amount),
      period: Number(p.period) || 1,
      phase: Number(p.phase) * D2R,
      dx: dmath.cos(angle), dy: dmath.sin(angle),
    });
  },
};

export const track: ObjectBlock = {
  type: 'track', category: 'object', kind: 'track', label: 'Spiral', output: true,
  params: [
    name('Spiral'),
    ...pos,
    { key: 'inner', label: 'Inner radius', type: 'number', default: 40, min: 0, max: 5000, step: 1 },
    { key: 'spacing', label: 'Spacing', type: 'number', default: 40, min: 2, max: 1000, step: 1 },
    { key: 'turns', label: 'Turns', type: 'number', default: 5, min: 0.25, max: 40, step: 0.25 },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 3, min: 0.5, max: 100, step: 0.5 },
    { key: 'spin', label: 'Spin', type: 'number', default: 0, min: -2000, max: 2000, step: 1, unit: '°/s' },
    bounce,
    color('#5B6270'),
  ],
  summary: (p) => `${p.turns} turns`,
  build(sim, g) {
    const p = g.params;
    const pieces = spiral(Number(p.inner), Number(p.spacing) / dmath.TAU, Number(p.turns), Number(p.thickness) / 2);
    sim.addCollider(g, 'track', { x: Number(p.x) || 0, y: Number(p.y) || 0, pieces, restitution: Number(p.bounciness) },
      Number(p.inner) + Number(p.spacing) * Number(p.turns), { type: 'spin', rate: Number(p.spin) * D2R });
  },
};

export const zone: ObjectBlock = {
  type: 'zone', category: 'object', kind: 'zone', label: 'Zone', output: true,
  params: [
    name('Zone'),
    { key: 'shape', label: 'Shape', type: 'enum', default: 'circle', options: [{ value: 'circle', label: 'Circle' }, { value: 'box', label: 'Box' }] },
    ...pos,
    { key: 'radius', label: 'Radius', type: 'number', default: 40, min: 1, max: 5000, step: 1, showIf: (p) => p.shape === 'circle' },
    { key: 'width', label: 'Width', type: 'number', default: 100, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'height', label: 'Height', type: 'number', default: 100, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'visible', label: 'Visible', type: 'bool', default: true },
    color('#FF5A1F'),
  ],
  summary: (p) => (p.shape === 'circle' ? `r ${p.radius}` : `${p.width} × ${p.height}`),
  build(sim, g) {
    const p = g.params;
    sim.zones.push({
      group: g.index, shape: p.shape, x: Number(p.x) || 0, y: Number(p.y) || 0,
      r: Number(p.radius), w: Number(p.width), h: Number(p.height), color: p.color, visible: !!p.visible, alive: true,
    });
  },
};

export const counter: ObjectBlock = {
  type: 'counter', category: 'object', kind: 'counter', label: 'Counter', output: false,
  params: [
    name('Score'),
    { key: 'initial', label: 'Start at', type: 'number', default: 0, min: -1e9, max: 1e9, step: 1 },
    { key: 'show', label: 'Show', type: 'bool', default: true },
  ],
  summary: (p) => `starts at ${p.initial}`,
};

export const OBJECT_BLOCKS: ObjectBlock[] = [ball, ringBlock, wall, track, zone, counter];
