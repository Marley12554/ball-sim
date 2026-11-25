import { dmath, ring, box, polyline } from '@engine/index';
import type { ParamSpec, PieceDef } from '@engine/index';
import type { ObjectBlock } from './types';
import type { Gap } from '@engine/index';
import { PALETTE_NAMES, PALETTES, samplePalette } from '../palettes';
import { Sledge } from '../sledge';
import { POWERUP_KINDS, WEAPON_TYPES } from '../arena';
import type { PowerupKind, WeaponType } from '../arena';

const D2R = dmath.PI / 180;
const name = (d: string): ParamSpec => ({ key: 'name', label: 'Name', type: 'text', default: d });
const color = (d: string): ParamSpec => ({ key: 'color', label: 'Color', type: 'color', default: d });
const pos: ParamSpec[] = [
  { key: 'x', label: 'X', type: 'number', default: 0, min: -100000, max: 100000, step: 1 },
  { key: 'y', label: 'Y', type: 'number', default: 0, min: -100000, max: 100000, step: 1 },
];
const bounce: ParamSpec = { key: 'bounciness', label: 'Bounciness', type: 'number', default: 1, min: 0, max: 2, step: 0.01 };
const palette = (d: string): ParamSpec => ({
  key: 'palette', label: 'Colors', type: 'enum', default: d,
  options: [{ value: 'single', label: 'One color' }, ...PALETTE_NAMES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))],
});
const material: ParamSpec = {
  key: 'material', label: 'Material', type: 'enum', default: 'glow',
  options: [{ value: 'glow', label: 'Glow' }, { value: 'titanium', label: 'Titanium' }],
};

export const ball: ObjectBlock = {
  type: 'ball', category: 'object', kind: 'ball', label: 'Balls', output: true,
  params: [
    name('Balls'),
    { key: 'count', label: 'Count', type: 'int', default: 1, min: 0, max: 5000, step: 1 },
    { key: 'look', label: 'Look', type: 'look', default: { mode: 'preset', preset: 'palette' } },
    { key: 'shape', label: 'Shape', type: 'enum', default: 'circle', options: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }] },
    { key: 'radius', label: 'Size', type: 'number', default: 14, min: 0.5, max: 300, step: 0.5 },
    { key: 'density', label: 'Density', type: 'number', default: 1, min: 0.01, max: 100, step: 0.01 },
    bounce,
    { key: 'drag', label: 'Drag', type: 'number', default: 0, min: 0, max: 10, step: 0.01 },
    { key: 'gravity', label: 'Gravity', type: 'number', default: 1, min: -5, max: 5, step: 0.05, unit: 'x' },
    { key: 'hp', label: 'HP', type: 'number', default: 0, min: 0, max: 100000, step: 1 },
    { key: 'collide', label: 'Hit other balls', type: 'bool', default: true },
    {
      key: 'placement', label: 'Placement', type: 'enum', default: 'point',
      options: [
        { value: 'point', label: 'Point' }, { value: 'scatter', label: 'Scatter' }, { value: 'spaced', label: 'Spaced out' },
        { value: 'circle', label: 'Circle' }, { value: 'line', label: 'Line' }, { value: 'grid', label: 'Grid' },
      ],
    },
    ...pos,
    { key: 'spread', label: 'Spread', type: 'number', default: 0, min: 0, max: 5000, step: 1, showIf: (p) => p.placement !== 'point' },
    {
      key: 'direction', label: 'Direction', type: 'enum', default: 'random',
      options: [
        { value: 'random', label: 'Random' }, { value: 'skew', label: 'Random, off-axis' }, { value: 'angle', label: 'Angle' },
        { value: 'outward', label: 'Outward' }, { value: 'inward', label: 'Inward' }, { value: 'tangent', label: 'Around' },
      ],
    },
    { key: 'angle', label: 'Angle', type: 'angle', default: 0, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.direction === 'angle' },
    { key: 'speed', label: 'Speed', type: 'number', default: 0, min: 0, max: 5000, step: 1 },
    { key: 'speedJitter', label: 'Speed variation', type: 'number', default: 0, min: 0, max: 5000, step: 1 },
  ],
  summary: (p) => `${p.count} × ${p.shape === 'square' ? 'square' : 'size'} ${p.radius}`,
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
    { key: 'count', label: 'Count', type: 'int', default: 1, min: 1, max: 20000, step: 1 },
    { key: 'radius', label: 'Radius', type: 'number', default: 260, min: 5, max: 100000, step: 1 },
    { key: 'spacing', label: 'Spacing', type: 'number', default: 28, min: 1, max: 1000, step: 1, showIf: (p) => p.count > 1 },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 5, min: 0.5, max: 100, step: 0.5 },
    { key: 'gaps', label: 'Gaps', type: 'int', default: 1, min: 0, max: 12, step: 1 },
    {
      key: 'gapPlacement', label: 'Gap placement', type: 'enum', default: 'random', showIf: (p) => p.gaps > 0,
      options: [{ value: 'random', label: 'Random' }, { value: 'aligned', label: 'Aligned' }, { value: 'stagger', label: 'Stagger' }, { value: 'tunnel', label: 'Tunnel' }],
    },
    { key: 'gapWidth', label: 'Gap width', type: 'angle', default: 34, min: 1, max: 180, step: 1, unit: '°', showIf: (p) => p.gaps > 0 && p.gapPlacement !== 'tunnel' },
    { key: 'gapLength', label: 'Gap length', type: 'number', default: 44, min: 2, max: 2000, step: 1, showIf: (p) => p.gaps > 0 && p.gapPlacement === 'tunnel' },
    { key: 'gapAngle', label: 'Gap angle', type: 'angle', default: 90, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.gaps > 0 && p.gapPlacement !== 'random' },
    { key: 'roughness', label: 'Roughness', type: 'number', default: 6, min: 0, max: 200, step: 0.5, showIf: (p) => p.gapPlacement === 'tunnel' },
    { key: 'blockEvery', label: 'Blocker every', type: 'int', default: 24, min: 0, max: 10000, step: 1, showIf: (p) => p.gapPlacement === 'tunnel' },
    { key: 'spin', label: 'Spin', type: 'number', default: 45, min: -2000, max: 2000, step: 1, unit: '°/s' },
    {
      key: 'spinPattern', label: 'Spin pattern', type: 'enum', default: 'alternate', showIf: (p) => p.count > 1,
      options: [{ value: 'same', label: 'Same' }, { value: 'alternate', label: 'Alternate' }, { value: 'faster', label: 'Faster out' }],
    },
    { key: 'snapBack', label: 'Close the hole', type: 'bool', default: false, showIf: (p) => p.count > 1 },
    bounce,
    palette('aurora'),
    { key: 'paletteCycle', label: 'Color cycle', type: 'int', default: 0, min: 0, max: 10000, step: 1, showIf: (p) => p.palette !== 'single' && p.count > 1 },
    { ...color('#8EC5FF'), showIf: (p) => p.palette === 'single' },
    ...pos,
  ],
  summary: (p) => (p.count > 1 ? `${p.count} rings` : `r ${p.radius}`) + (p.gaps ? `, ${p.gaps} gap${p.gaps === 1 ? '' : 's'}` : ''),
  build(sim, g) {
    const p = g.params;
    const n = Math.max(1, p.count | 0);
    const ng = p.gaps | 0;
    const ht = Number(p.thickness) / 2;
    const tunnel = p.gapPlacement === 'tunnel';
    let drift = 0;
    let nextBlock = Number(p.blockEvery) > 0 ? Math.round(Number(p.blockEvery) * sim.rng.range(0.6, 1.4)) : Infinity;
    const order: number[] = [];
    for (let k = 0; k < n; k++) {
      const R = Number(p.radius) + k * Number(p.spacing);
      const gaps: Gap[] = [];
      const metaGaps: { at: number; len: number }[] = [];
      if (tunnel && ng > 0) {
        // Nearly aligned gaps with a wandering offset; every so often a ring turns its back on the tunnel.
        const rough = Number(p.roughness);
        drift = drift * 0.85 + sim.rng.range(-rough, rough);
        let at = Number(p.gapAngle) * D2R + drift / R;
        if (k + 1 >= nextBlock) {
          at += dmath.PI + sim.rng.range(-0.6, 0.6);
          nextBlock = k + 1 + Math.round(Number(p.blockEvery) * sim.rng.range(0.5, 1.5));
        }
        const len = Number(p.gapLength);
        gaps.push({ at, width: Math.min(len / R, dmath.PI) });
        metaGaps.push({ at, len });
      } else if (ng > 0) {
        let base: number;
        if (p.gapPlacement === 'random') base = sim.rng.range(0, dmath.TAU);
        else if (p.gapPlacement === 'stagger') base = (Number(p.gapAngle) + k * 137.508) * D2R;
        else base = Number(p.gapAngle) * D2R;
        const wdt = Number(p.gapWidth) * D2R;
        for (let j = 0; j < ng; j++) {
          const at = base + (j * dmath.TAU) / ng;
          gaps.push({ at, width: wdt });
          metaGaps.push({ at, len: wdt * R });
        }
      }
      let rate = Number(p.spin) * D2R;
      if (p.spinPattern === 'alternate' && k % 2 === 1) rate = -rate;
      if (p.spinPattern === 'faster') rate *= 1 + k * 0.2;
      const cyc = Number(p.paletteCycle) > 0 ? Number(p.paletteCycle) : n;
      const tcol = n <= 1 ? 0 : p.paletteCycle > 0 ? Math.abs(((k / cyc) % 2) - 1) : k / Math.max(1, n - 1);
      const col = p.palette === 'single' ? p.color : samplePalette(p.palette, p.paletteCycle > 0 ? 1 - tcol : tcol);
      const id = sim.addCollider(g, 'ring', {
        x: Number(p.x) || 0, y: Number(p.y) || 0,
        pieces: ring(R, ht, gaps),
        restitution: Number(p.bounciness),
      }, R, { type: rate !== 0 ? 'spin' : 'none', rate }, col);
      sim.ringMeta[id] = { group: g.index, gaps: metaGaps, k };
      if (n === 1 && p.palette !== 'single') sim.colGrad[id] = PALETTES[p.palette];
      order.push(id);
    }
    if (p.snapBack && n > 1) sim.snapBack.push({ group: g.index, order, ptr: 0, R0: Number(p.radius), spacing: Number(p.spacing), anim: null });
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
    { key: 'width', label: 'Width', type: 'number', default: 520, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'height', label: 'Height', type: 'number', default: 520, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'box' },
    { key: 'length', label: 'Length', type: 'number', default: 200, min: 1, max: 10000, step: 1, showIf: (p) => p.shape === 'line' },
    { key: 'radius', label: 'Radius', type: 'number', default: 200, min: 1, max: 5000, step: 1, showIf: (p) => p.shape === 'arc' },
    { key: 'span', label: 'Span', type: 'angle', default: 180, min: 1, max: 360, step: 1, unit: '°', showIf: (p) => p.shape === 'arc' },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 5, min: 0.5, max: 200, step: 0.5 },
    bounce,
    {
      key: 'motion', label: 'Motion', type: 'enum', default: 'none',
      options: [{ value: 'none', label: 'Still' }, { value: 'spin', label: 'Spin' }, { value: 'swing', label: 'Swing' }, { value: 'slide', label: 'Slide' }],
    },
    { key: 'rate', label: 'Spin', type: 'number', default: 90, min: -3000, max: 3000, step: 1, unit: '°/s', showIf: (p) => p.motion === 'spin' },
    { key: 'amount', label: 'Amount', type: 'number', default: 30, min: 0, max: 5000, step: 1, showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    { key: 'period', label: 'Period', type: 'number', default: 1, min: 0.05, max: 60, step: 0.05, unit: 's', showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    { key: 'phase', label: 'Phase', type: 'angle', default: 0, min: -360, max: 360, step: 1, unit: '°', showIf: (p) => p.motion === 'swing' || p.motion === 'slide' },
    material,
    color('#8EC5FF'),
  ],
  summary: (p) => (p.shape === 'box' ? `${p.width} × ${p.height}` : p.shape === 'line' ? `line ${p.length}` : `arc ${p.span}°`) + (p.motion !== 'none' ? `, ${p.motion}` : ''),
  build(sim, g) {
    const p = g.params;
    const ht = Number(p.thickness) / 2;
    let pieces: PieceDef[];
    let radius: number;
    if (p.shape === 'line') {
      pieces = [{ kind: 'segment', ax: 0, ay: 0, bx: Number(p.length), by: 0, halfThickness: ht }];
      radius = Number(p.length);
    } else if (p.shape === 'arc') {
      const span = Number(p.span) * D2R;
      pieces = [{ kind: 'arc', radius: Number(p.radius), start: -span / 2, span, halfThickness: ht }];
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

/** Geometry of the downward spiral, shared by the block and the mode generator. */
export function spiralGeometry(p: { x: number; y: number; inner: number; width: number; turns: number; chuteLength: number }) {
  const b = p.width / dmath.TAU;
  const T = p.turns * dmath.TAU;
  const rOuter = p.inner + b * T;
  const at = (t: number, inset = 0) => {
    const r = rOuter - b * t - inset;
    const a = -dmath.HALF_PI + t;
    return { x: p.x + dmath.cos(a) * r, y: p.y + dmath.sin(a) * r };
  };
  const ca = 35 * D2R;
  const dx = dmath.cos(ca), dy = dmath.sin(ca);
  const nx = -dmath.sin(ca), ny = dmath.cos(ca);
  const top = at(0);
  const L = p.chuteLength;
  return {
    b, T, rOuter, at,
    /** Corridor center at parameter t (between lap t and lap t + 2π). */
    mid: (t: number) => at(t, p.width / 2),
    chuteUpper: [top.x - dx * L, top.y - dy * L, top.x, top.y],
    chuteLower: [top.x + nx * p.width - dx * L, top.y + ny * p.width - dy * L, top.x + nx * p.width, top.y + ny * p.width],
    /** Where balls wait at the top of the chute. */
    entry: { x: top.x - dx * (L - 30) + nx * p.width * 0.5, y: top.y - dy * (L - 30) + ny * p.width * 0.5 },
  };
}

export const track: ObjectBlock = {
  type: 'track', category: 'object', kind: 'track', label: 'Spiral', output: true,
  params: [
    name('Spiral'),
    ...pos,
    { key: 'inner', label: 'Inner radius', type: 'number', default: 44, min: 0, max: 5000, step: 1 },
    { key: 'width', label: 'Channel width', type: 'number', default: 74, min: 4, max: 1000, step: 1 },
    { key: 'turns', label: 'Turns', type: 'number', default: 4.5, min: 0.5, max: 40, step: 0.25 },
    { key: 'thickness', label: 'Thickness', type: 'number', default: 5, min: 0.5, max: 100, step: 0.5 },
    { key: 'chute', label: 'Entry chute', type: 'bool', default: true },
    { key: 'chuteLength', label: 'Chute length', type: 'number', default: 150, min: 20, max: 2000, step: 1, showIf: (p) => p.chute },
    bounce,
    palette('sunset'),
    { ...color('#8EC5FF'), showIf: (p) => p.palette === 'single' },
  ],
  summary: (p) => `${p.turns} turns`,
  build(sim, g) {
    const p = g.params;
    const geo = spiralGeometry({ x: Number(p.x) || 0, y: Number(p.y) || 0, inner: Number(p.inner), width: Number(p.width), turns: Number(p.turns), chuteLength: Number(p.chuteLength) });
    const ht = Number(p.thickness) / 2;
    const pts: number[] = [];
    for (let t = 0; t <= geo.T + 1e-9; t += 0.06) {
      const q = geo.at(t);
      pts.push(q.x, q.y);
    }
    const pieces: PieceDef[] = polyline(pts, ht);
    if (p.chute) {
      const u = geo.chuteUpper, l = geo.chuteLower;
      pieces.push({ kind: 'segment', ax: u[0], ay: u[1], bx: u[2], by: u[3], halfThickness: ht });
      pieces.push({ kind: 'segment', ax: l[0], ay: l[1], bx: l[2], by: l[3], halfThickness: ht });
    }
    const col = p.palette === 'single' ? p.color : samplePalette(p.palette, 0.4);
    const id = sim.addCollider(g, 'track', { x: 0, y: 0, pieces, restitution: Number(p.bounciness) }, geo.rOuter, { type: 'none' }, col);
    if (p.palette !== 'single') sim.colGrad[id] = PALETTES[p.palette];
    sim.colGradCenter[id] = [Number(p.x) || 0, Number(p.y) || 0];
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
    { key: 'label', label: 'Label', type: 'text', default: '' },
    { key: 'visible', label: 'Visible', type: 'bool', default: true },
    color('#FFB020'),
  ],
  summary: (p) => (p.label ? `${p.label} · ` : '') + (p.shape === 'circle' ? `r ${p.radius}` : `${p.width} × ${p.height}`),
  build(sim, g) {
    const p = g.params;
    sim.zones.push({
      group: g.index, shape: p.shape, x: Number(p.x) || 0, y: Number(p.y) || 0,
      r: Number(p.radius), w: Number(p.width), h: Number(p.height), color: p.color, visible: !!p.visible, alive: true, label: String(p.label ?? ''),
    });
  },
};

export const counter: ObjectBlock = {
  type: 'counter', category: 'object', kind: 'counter', label: 'Counter', output: false,
  params: [
    name('Score'),
    { key: 'source', label: 'Shows', type: 'enum', default: 'value', options: [{ value: 'value', label: 'A number' }, { value: 'count', label: 'How many' }] },
    { key: 'initial', label: 'Start at', type: 'number', default: 0, min: -1e9, max: 1e9, step: 1, showIf: (p) => p.source !== 'count' },
    { key: 'group', label: 'Of', type: 'ref', refKinds: ['ball', 'ring', 'wall', 'zone'], default: '', showIf: (p) => p.source === 'count' },
    { key: 'show', label: 'Show', type: 'bool', default: true },
    { key: 'place', label: 'Where', type: 'enum', default: 'corner', options: [{ value: 'corner', label: 'Corner' }, { value: 'center', label: 'Center' }], showIf: (p) => p.show },
  ],
  summary: (p, n) => (p.source === 'count' ? `count of ${p.group ? n(p.group) : '?'}` : `starts at ${p.initial}`),
};

export const sledge: ObjectBlock = {
  type: 'sledge', category: 'object', kind: 'sledge', label: 'Sledge', output: true,
  params: [
    name('Sledge'),
    ...pos,
    { key: 'length', label: 'Arm length', type: 'number', default: 196, min: 20, max: 2000, step: 1 },
    { key: 'headLength', label: 'Head length', type: 'number', default: 76, min: 10, max: 500, step: 1 },
    { key: 'headWidth', label: 'Head width', type: 'number', default: 58, min: 10, max: 500, step: 1 },
    { key: 'swing', label: 'Swing', type: 'angle', default: 30, min: 2, max: 170, step: 1, unit: '°' },
    { key: 'hold', label: 'Rest', type: 'number', default: 0.75, min: 0, max: 10, step: 0.05, unit: 's' },
    { key: 'swingTime', label: 'Swing time', type: 'number', default: 0.5, min: 0.05, max: 10, step: 0.05, unit: 's' },
    { key: 'reach', label: 'Stops reach', type: 'number', default: 296, min: 20, max: 5000, step: 1 },
  ],
  summary: (p) => `±${Number(p.swing) / 2}°, rests ${p.hold}s`,
  build(sim, g) {
    const p = g.params;
    sim.sledges.push(new Sledge(sim, g, {
      x: Number(p.x) || 0, y: Number(p.y) || 0, length: Number(p.length), headLength: Number(p.headLength), headWidth: Number(p.headWidth),
      handle: 16, swing: Number(p.swing) * D2R, tilt: (Number(p.swing) / 2) * D2R, hold: Number(p.hold), swingTime: Number(p.swingTime),
      reach: Number(p.reach), stopWidth: 36,
    }));
  },
};

export const pickups: ObjectBlock = {
  type: 'pickups', category: 'object', kind: 'pickups', label: 'Powerups', output: false,
  params: [
    name('Powerups'),
    { key: 'red', label: 'Red: +1 damage', type: 'bool', default: true },
    { key: 'green', label: 'Green: heal 1', type: 'bool', default: true },
    { key: 'cyan', label: 'Cyan: shield', type: 'bool', default: true },
    { key: 'magenta', label: 'Magenta: teleport', type: 'bool', default: true },
    { key: 'min', label: 'Every (min)', type: 'number', default: 5, min: 0.2, max: 120, step: 0.1, unit: 's' },
    { key: 'max', label: 'Every (max)', type: 'number', default: 10, min: 0.2, max: 120, step: 0.1, unit: 's' },
    { key: 'redTime', label: 'Red lasts', type: 'number', default: 2, min: 0.1, max: 60, step: 0.1, unit: 's' },
    { key: 'size', label: 'Size', type: 'number', default: 9, min: 2, max: 100, step: 0.5 },
    { key: 'area', label: 'Area', type: 'number', default: 230, min: 10, max: 5000, step: 1 },
    ...pos,
    { key: 'collectors', label: 'Picked up by', type: 'ref', refKinds: ['ball'], anyLabel: 'Any ball', default: '' },
  ],
  summary: (p) => POWERUP_KINDS.filter((k) => p[k]).join(', ') || 'none',
  build(sim, g) {
    const p = g.params;
    const kinds = POWERUP_KINDS.filter((k) => p[k]) as PowerupKind[];
    let collectors: Uint8Array | null = null;
    sim.hooks.afterBuild.push(() => { if (p.collectors) collectors = sim.groupMask([p.collectors]); if (sim.arena.pickupCfg) sim.arena.pickupCfg.collectors = collectors; });
    sim.arena.pickupCfg = {
      kinds, min: Math.min(p.min, p.max), max: Math.max(p.min, p.max), size: Number(p.size), area: Number(p.area),
      cx: Number(p.x) || 0, cy: Number(p.y) || 0, collectors, redTime: Number(p.redTime),
    };
    void g;
  },
};

export const weapon: ObjectBlock = {
  type: 'weapon', category: 'object', kind: 'weapon', label: 'Weapons', output: false,
  params: [
    name('Weapons'),
    { key: 'holders', label: 'Held by', type: 'ref', refKinds: ['ball'], default: '' },
    {
      key: 'type', label: 'Weapon', type: 'enum', default: 'random',
      options: [{ value: 'random', label: 'Random each' }, ...WEAPON_TYPES.map((w) => ({ value: w, label: w === 'rod' ? 'Lightning rod' : w[0].toUpperCase() + w.slice(1) }))],
    },
    { key: 'teams', label: 'Spare teammates', type: 'bool', default: false },
  ],
  summary: (p, n) => `${p.type} for ${p.holders ? n(p.holders) : '?'}`,
  build(sim, g) {
    const p = g.params;
    sim.hooks.afterBuild.push(() => {
      const holders = sim.groupMask([p.holders]);
      const wc = { holders, type: p.type as WeaponType | 'random', teams: !!p.teams };
      sim.arena.weaponCfgs.push(wc);
      const w = sim.world;
      for (let i = 0; i < w.highWater; i++) if (w.alive[i] && holders[w.group[i]]) sim.arena.arm(i, wc);
    });
  },
};

export const OBJECT_BLOCKS: ObjectBlock[] = [ball, ringBlock, wall, track, zone, counter, sledge, pickups, weapon];
