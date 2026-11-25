import { Rng } from '@engine/index';
import type { NodeDef, WireDef, Params } from '@engine/index';
import type { SimDef, SimSettings, LookSetting } from './types';
import { DEFAULT_SETTINGS } from './types';
import { PALETTE_NAMES } from './palettes';
import { spiralGeometry } from './blocks/objects';

/** Tiny graph builder. Positions lay nodes out in columns for the editor. */
class G {
  nodes: NodeDef[] = [];
  wires: WireDef[] = [];
  private k = 0;
  n(type: string, params: Params, x: number, y: number): string {
    const id = `n${++this.k}`;
    this.nodes.push({ id, type, params, x, y });
    return id;
  }
  w(from: string, ...to: string[]): void {
    for (const t of to) this.wires.push({ from, to: t });
  }
  set(id: string, key: string, v: unknown): void {
    this.nodes.find((n) => n.id === id)!.params[key] = v;
  }
}

const C = [40, 320, 600, 880];

function def(name: string, seed: number, g: G, settings: Partial<SimSettings>): SimDef {
  return { v: 1, name, seed, settings: { ...DEFAULT_SETTINGS, ...settings }, graph: { nodes: g.nodes, wires: g.wires } };
}

const COLORFUL: LookSetting['mode'] = 'preset';
const pick = <T,>(r: Rng, a: T[]): T => a[r.int(a.length)];
const vivid = (r: Rng) => pick(r, PALETTE_NAMES.filter((p) => p !== 'titanium'));
const ballLook = (r: Rng): LookSetting => ({ mode: COLORFUL, preset: pick(r, ['palette', 'gradients', 'patterns', 'spectrum']) as any });

export interface Variant { name: string }
export interface Mode {
  id: string;
  name: string;
  prefix: string;
  variants: Variant[];
  make(v: number, seed: number): SimDef;
}

/* --------------------------------- Ring Escape --------------------------------- */

function ringEscape(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const gauntlet = v >= 1;
  const count = v === 2 ? 10000 : v === 1 ? 1000 : 10 + r.int(5);
  const rings = g.n('ring', gauntlet ? {
    name: 'Rings', count, radius: 60, spacing: 30, thickness: 4, gaps: 1, gapPlacement: 'tunnel', gapLength: 42, gapAngle: 90,
    roughness: 7, blockEvery: (v === 2 ? 50 : 26) + r.int(14), spin: 0, closeIn: true, closeDelay: 2.2, closeRate: 0.4, bounciness: 0.7,
    palette: vivid(r), paletteCycle: 36,
  } : {
    name: 'Rings', count, radius: 64, spacing: 24, thickness: 5, gaps: 1, gapWidth: 30 + r.int(12), gapPlacement: 'random',
    spin: 40 + r.int(30), spinPattern: r.chance(0.5) ? 'alternate' : 'faster', palette: vivid(r),
  }, C[0], 220);
  const ball = g.n('ball', { name: 'Ball', count: 1, radius: gauntlet ? 10 : 11, speed: 0, drag: gauntlet ? 0.8 : 0, look: { mode: 'fixed', look: { t: 'gradient', c: ['#FFFFFF', '#FDE68A'], kind: 'radial', angle: 0 } } }, C[0], 40);
  const left = g.n('counter', { name: 'Rings', source: 'count', group: rings, show: true }, C[0], 380);
  const bounce = g.n('bounce', { wall: '' }, C[1], 40);
  const faster = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: gauntlet ? 1 : 1.03, clamp: true, min: 0, max: gauntlet ? 1300 : 1500 }, C[2], 40);
  const leave = g.n('leave', { container: rings }, C[1], 160);
  const breakRing = g.n('destroy', { target: 'other' }, C[2], 160);
  const done = g.n('groupCount', { group: rings, cmp: 'atMost', value: 0 }, C[1], 280);
  const escaped = g.n('end', { label: gauntlet ? `Escaped all ${count.toLocaleString('en-US')} rings in {time}` : 'Escaped in {time}' }, C[2], 280);
  g.w(ball, bounce, leave);
  g.w(bounce, faster);
  g.w(leave, breakRing);
  g.w(done, escaped);
  void left;
  if (!gauntlet) {
    const timer = g.n('after', { time: 60 }, C[1], 400);
    const timeUp = g.n('end', { label: 'Time’s up' }, C[2], 400);
    g.w(timer, timeUp);
  }
  const name = ['Ring Escape', 'Ring Gauntlet', 'Ring Gauntlet 10K'][v];
  return def(name, seed, g, gauntlet
    ? { gravity: 600, clock: 'up', camera: 'follow', view: 330, maxObjects: 16, speedLimit: 2500 }
    : { gravity: 520, clock: 'down', clockFrom: 60, maxObjects: 16 });
}

/* ------------------------------------ Leak ------------------------------------- */

function leak(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const ringN = g.n('ring', {
    name: 'Ring', count: 1, radius: 250, thickness: 7, gaps: v === 1 ? 2 : 1, gapWidth: v === 2 ? 26 : 34 + r.int(10),
    spin: (v === 1 ? 90 : 55) + r.int(30), palette: vivid(r),
  }, C[0], 220);
  const balls = g.n('ball', { name: 'Balls', count: 1, radius: 12, speed: 380, speedJitter: 80, direction: 'random', look: ballLook(r) }, C[0], 40);
  g.n('counter', { name: 'Balls', source: 'count', group: balls, show: true }, C[0], 380);
  const out = g.n('leave', { container: ringN }, C[1], 40);
  const two = g.n('spawn', { group: balls, count: 2, at: 'center' }, C[2], 40);
  const gone = g.n('valueReaches', { prop: 'dist', cmp: 'above', value: 700 }, C[1], 160);
  const del = g.n('destroy', { target: 'self' }, C[2], 160);
  const full = g.n('fill', { container: ringN, percent: 70, hold: 3 }, C[1], 280);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 260);
  const boom = g.n('explode', { at: 'center', radius: 900, strength: 1300 }, C[2], 340);
  const endN = g.n('end', { label: 'The ring burst at {time}' }, C[2], 420);
  g.w(balls, out, gone);
  g.w(out, two);
  g.w(gone, del);
  g.w(full, pop, boom, endN);
  return def(['Leak', 'Leak: Twin Gaps', 'Leak: Pinhole'][v], seed, g, { gravity: 520, clock: 'up', maxObjects: 1600, pairCorrection: 0.6, restThreshold: 40, endHold: 6 });
}

/* ------------------------------- Doubling Sledge -------------------------------- */

function sledge(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const ringN = g.n('ring', { name: 'Ring', count: 1, radius: 290, thickness: 8, gaps: 0, spin: 0, palette: vivid(r) }, C[0], 260);
  const sl = g.n('sledge', {
    name: 'Sledge', length: 236, headLength: v === 2 ? 100 : 92, headWidth: v === 2 ? 70 : 58, swing: v === 2 ? 34 : 30,
    hold: v === 1 ? 0.45 : 0.75, swingTime: v === 1 ? 0.38 : 0.5, reach: 300,
  }, C[0], 400);
  // Start in the gap the hammer is about to sweep, so the first slam doubles them.
  const balls = g.n('ball', { name: 'Balls', count: 2, radius: 11, placement: 'line', spread: 12, x: 0, y: 238, speed: 0, look: ballLook(r) }, C[0], 40);
  g.n('counter', { name: 'Balls', source: 'count', group: balls, show: true }, C[0], 540);
  const crush = g.n('crushed', {}, C[1], 40);
  const dup = g.n('duplicate', { target: 'self', count: 1, mode: 'burst', spread: 0 }, C[2], 40);
  const full = g.n('fill', { container: ringN, percent: 60, hold: 3 }, C[1], 220);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 180);
  const pop2 = g.n('destroy', { target: 'group', group: sl }, C[2], 260);
  const boom = g.n('explode', { at: 'center', radius: 1000, strength: 1500 }, C[2], 340);
  const endN = g.n('end', { label: 'The ring gave way at {time}' }, C[2], 420);
  g.w(balls, crush);
  g.w(crush, dup);
  g.w(full, pop, pop2, boom, endN);
  return def(['Doubling Sledge', 'Doubling Sledge: Frenzy', 'Doubling Sledge: Heavy'][v], seed, g, { gravity: 560, clock: 'up', maxObjects: 1600, pairCorrection: 0.5, restThreshold: 45, endHold: 6 });
}

/* --------------------------------- Spiral Drop ---------------------------------- */

function spiralDrop(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const turns = v === 1 ? 6.5 : 4.5;
  const geo = spiralGeometry({ x: 0, y: 30, inner: 44, width: 74, turns, chuteLength: 150 });
  g.n('track', { name: 'Spiral', x: 0, y: 30, inner: 44, width: 74, turns, chute: true, chuteLength: 150, palette: vivid(r) }, C[0], 300);
  const balls = g.n('ball', {
    name: 'Balls', count: 1, radius: 13, x: Math.round(geo.entry.x), y: Math.round(geo.entry.y), direction: 'angle', angle: 35,
    speed: 160, speedJitter: 20, drag: v === 1 ? 0.068 : 0.095, look: ballLook(r),
  }, C[0], 40);
  const gates: string[] = [];
  const gateTs = v === 1 ? [[2.3, 2], [6.4, 3], [10.2, 2]] : [[2.4, 2], [6.3, 3]];
  gateTs.forEach(([t, m], k) => {
    const p = geo.mid(t * Math.PI);
    gates.push(g.n('zone', { name: `×${m}`, shape: 'circle', x: Math.round(p.x), y: Math.round(p.y), radius: 20, label: `×${m}`, color: m === 3 ? '#F472B6' : '#FBBF24' }, C[0], 440 + k * 120));
  });
  const center = g.n('zone', { name: 'Center', shape: 'circle', x: 0, y: 30, radius: 30, label: '', color: '#5EEAD4' }, C[0], 800);
  const round = g.n('counter', { name: 'Round', initial: 1, show: true }, C[0], 920);
  g.n('counter', { name: 'Balls', source: 'count', group: balls, show: true }, C[0], 1020);
  const stall = g.n('valueReaches', { prop: 'stall', cmp: 'above', value: 1.9 }, C[1], 40);
  const fall = g.n('fallOff', { target: 'self' }, C[2], 40);
  const empty = g.n('groupCount', { group: balls, cmp: 'atMost', value: 0 }, C[1], 160);
  const next = g.n('count', { counter: round, op: 'add', amount: 1 }, C[2], 120);
  const spawnN = g.n('spawn', { group: balls, countFrom: round, at: 'home', stagger: 0.45 }, C[2], 200);
  const faster = g.n('setProp', { target: 'defaults', group: balls, prop: 'speed', op: 'multiply', amount: 1.07 }, C[2], 280);
  gates.forEach((gate, k) => {
    const m = gateTs[k][1];
    const enter = g.n('enter', { container: gate }, C[1], 360 + k * 110);
    const orig = g.n('onlyIf', { subject: 'self', prop: 'copy', cmp: 'below', value: 0.5 }, C[2], 360 + k * 110);
    const trail = g.n('duplicate', { target: 'self', count: m - 1, mode: 'trail', interval: 0.13 }, C[3], 360 + k * 110);
    g.w(balls, enter);
    g.w(enter, orig);
    g.w(orig, trail);
  });
  const reach = g.n('enter', { container: center }, C[1], 700);
  const win = g.n('end', { label: 'Reached the center in round {round}' }, C[2], 700);
  g.w(balls, stall, reach);
  g.w(stall, fall);
  g.w(empty, next, spawnN, faster);
  g.w(reach, win);
  return def(['Spiral Drop', 'Spiral Drop: Long Way Down'][v], seed, g, { gravity: 650, clock: 'up', maxObjects: 400, restThreshold: 60, speedLimit: 2400 });
}

/* ----------------------------------- Mitosis ------------------------------------ */

function mitosis(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const ringN = g.n('ring', { name: 'Ring', count: 1, radius: 290, thickness: 7, gaps: 0, spin: 0, palette: vivid(r) }, C[0], 300);
  const cells = g.n('ball', { name: 'Cells', count: v === 1 ? 4 : 2, radius: 13, placement: 'line', spread: 120, speed: 0, look: { mode: 'preset', preset: v === 1 ? 'spectrum' : pick(r, ['gradients', 'palette']) } }, C[0], 40);
  g.n('counter', { name: 'Cells', source: 'count', group: cells, show: true }, C[0], 440);
  const tick = g.n('every', { interval: 0.6 }, C[1], 20);
  const grow = g.n('setProp', { target: 'self', prop: 'size', op: 'multiply', amount: 1.045 }, C[2], 20);
  const bounce = g.n('bounce', { wall: '' }, C[1], 120);
  const feed = g.n('setProp', { target: 'self', prop: 'size', op: 'multiply', amount: 1.03 }, C[2], 120);
  const big = g.n('valueReaches', { prop: 'size', cmp: 'above', value: 21 }, C[1], 220);
  const divide = g.n('duplicate', { target: 'self', count: 1, mode: 'split', spread: 140 }, C[2], 220);
  const full = g.n('fill', { container: ringN, percent: 84, hold: 3 }, C[1], 340);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 320);
  const boom = g.n('explode', { at: 'center', radius: 1000, strength: 1400 }, C[2], 400);
  const endN = g.n('end', { label: 'Overgrown at {time}' }, C[2], 480);
  g.w(cells, tick, bounce, big);
  g.w(tick, grow);
  g.w(bounce, feed);
  g.w(big, divide);
  g.w(full, pop, boom, endN);
  return def(['Mitosis', 'Mitosis: Rainbow'][v], seed, g, { gravity: 450, clock: 'up', maxObjects: 1600, pairCorrection: 0.45, restThreshold: 45, endHold: 6 });
}

/* ----------------------------------- Growth ------------------------------------- */

function growth(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  g.n('ring', { name: 'Ring', count: 1, radius: 280, thickness: 6, gaps: 0, spin: 0, palette: vivid(r) }, C[0], 220);
  const balls = g.n('ball', { name: 'Balls', count: v === 1 ? 6 : 3, radius: 11, placement: 'line', spread: 120, speed: 120, speedJitter: 60, look: { mode: 'preset', preset: 'countries' } }, C[0], 40);
  const bounce = g.n('bounce', { wall: '' }, C[1], 40);
  const grow = g.n('setProp', { target: 'self', prop: 'size', op: 'multiply', amount: 1.035 }, C[2], 40);
  const bigN = g.n('valueReaches', { prop: 'size', cmp: 'above', value: v === 1 ? 90 : 120 }, C[1], 160);
  const endN = g.n('end', { label: '{self} filled the ring' }, C[2], 160);
  g.w(balls, bounce, bigN);
  g.w(bounce, grow);
  g.w(bigN, endN);
  return def(['Growth', 'Growth: Crowd'][v], seed, g, { gravity: 450, clock: 'up', restThreshold: 20 });
}

/* -------------------------------- Tether Battle --------------------------------- */

function tetherBattle(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const arena = g.n('ring', { name: 'Arena', count: 1, radius: 270, thickness: 6, gaps: 0, spin: 0, palette: vivid(r) }, C[0], 220);
  const balls = g.n('ball', { name: 'Fighters', count: v === 1 ? 2 : 5, radius: 15, speed: 340, placement: 'circle', spread: 120, look: { mode: 'preset', preset: 'countries' } }, C[0], 40);
  const bounce = g.n('bounce', { wall: arena }, C[1], 20);
  const tie = g.n('attachTether', { to: 'point', stiffness: 0.6, slack: 'current', limit: 6 }, C[2], 0);
  const keep = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1, clamp: true, min: 320, max: 720 }, C[2], 90);
  const cross = g.n('crossTether', {}, C[1], 170);
  const cut = g.n('cutTether', { which: 'crossed' }, C[2], 170);
  const none = g.n('valueReaches', { prop: 'tethers', cmp: 'below', value: 1 }, C[1], 280);
  const settled = g.n('onlyIf', { subject: 'self', prop: 'age', cmp: 'above', value: 8 }, C[2], 280);
  const gone = g.n('fallOff', { target: 'self' }, C[3], 280);
  const last = g.n('groupCount', { group: balls, cmp: 'atMost', value: 1 }, C[1], 400);
  const win = g.n('end', { label: '{self} wins' }, C[2], 400);
  g.w(balls, bounce, cross, none);
  g.w(bounce, tie, keep);
  g.w(cross, cut);
  g.w(none, settled);
  g.w(settled, gone);
  g.w(last, win);
  return def(['Tether Battle', 'Tether Battle: Duel'][v], seed, g, { gravity: 300, clock: 'up' });
}

/* ------------------------------------ Arena ------------------------------------- */

function arena(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  const weapons = v >= 4;
  g.n('wall', { name: 'Arena', shape: 'box', width: 540, height: 540, thickness: 6, color: '#8EC5FF', material: 'titanium' }, C[0], 520);
  const keepMoving = (holder: string, y: number) => {
    const b = g.n('bounce', { wall: '' }, C[1], y);
    const nudge = g.n('push', { target: 'self', direction: 'random', strength: 70 }, C[2], y - 40);
    g.w(b, nudge);
    const k = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1, clamp: true, min: weapons ? 200 : 240, max: weapons ? 440 : 520 }, C[2], y);
    g.w(holder, b);
    g.w(b, k);
  };
  // Sudden death: after a minute everyone grows and speeds up, so fights can't stall.
  const suddenDeath = (holder: string, y: number) => {
    const tick = g.n('every', { interval: 6, from: 60 }, C[1], y);
    const grow = g.n('setProp', { target: 'group', group: holder, prop: 'size', op: 'multiply', amount: 1.12, clamp: true, min: 4, max: 44 }, C[2], y);
    const fast = g.n('setProp', { target: 'group', group: holder, prop: 'speed', op: 'multiply', amount: 1.1, clamp: true, min: 0, max: 700 }, C[2], y + 70);
    g.w(tick, grow, fast);
  };
  const dies = (holder: string, y: number) => {
    const d = g.n('valueReaches', { prop: 'hp', cmp: 'below', value: weapons ? 0.01 : 0.5 }, C[1], y);
    const kill = g.n('destroy', { target: 'self' }, C[2], y);
    const pop = g.n('explode', { at: 'point', radius: 90, strength: 380 }, C[2], y + 70);
    g.w(holder, d);
    g.w(d, kill, pop);
  };
  const square = (name: string, count: number, extra: Params = {}) => g.n('ball', {
    name, count, shape: 'square', radius: 18, hp: weapons ? 16 : 10, speed: 300, placement: 'spaced', spread: 200, direction: 'skew',
    gravity: 0, look: { mode: 'preset', preset: 'countries' }, ...extra,
  }, C[0], 40 + g.nodes.length * 30);
  if (v === 3) {
    // Boss fight.
    const imp = g.n('ball', { name: 'Imp', count: 1, radius: 46, hp: 26, density: 5, speed: 170, direction: 'skew', gravity: 0, look: { mode: 'fixed', look: { t: 'imp' } } }, C[0], 40);
    const heroes = square('Heroes', 4, { hp: 10, radius: 16, x: 0, y: 0 });
    g.n('pickups', { name: 'Powerups', collectors: heroes, area: 235 }, C[0], 700);
    const hh = g.n('touch', { with: imp }, C[1], 20);
    const hd = g.n('damage', { target: 'other', amount: 1 }, C[2], 20);
    const ih = g.n('touch', { with: heroes }, C[1], 110);
    const id = g.n('damage', { target: 'other', amount: 2 }, C[2], 110);
    const stomp = g.n('every', { interval: 7 }, C[1], 200);
    const shock = g.n('explode', { at: 'self', radius: 190, strength: 650 }, C[2], 200);
    g.set(hh, 'cooldown', 0.5);
    g.set(ih, 'cooldown', 1);
    g.w(heroes, hh);
    g.w(hh, hd);
    g.w(imp, ih, stomp);
    g.w(ih, id);
    g.w(stomp, shock);
    keepMoving(heroes, 300);
    keepMoving(imp, 380);
    dies(heroes, 460);
    dies(imp, 600);
    suddenDeath(heroes, 900);
    suddenDeath(imp, 980);
    const iw = g.n('groupCount', { group: imp, cmp: 'atMost', value: 0 }, C[1], 740);
    const iwEnd = g.n('end', { label: 'The heroes win' }, C[2], 740);
    const hw = g.n('groupCount', { group: heroes, cmp: 'atMost', value: 0 }, C[1], 820);
    const hwEnd = g.n('end', { label: 'The Imp wins' }, C[2], 820);
    g.w(iw, iwEnd);
    g.w(hw, hwEnd);
    return def('Arena: Boss', seed, g, { gravity: 0, clock: 'up' });
  }
  if (v === 2) {
    const a = square('Orange', 3, { look: { mode: 'fixed', look: { t: 'gradient', c: ['#FDBA74', '#F43F5E'], kind: 'radial', angle: 0 } }, x: -120 });
    const b = square('Blue', 3, { look: { mode: 'fixed', look: { t: 'gradient', c: ['#67E8F9', '#6366F1'], kind: 'radial', angle: 0 } }, x: 120 });
    g.n('pickups', { name: 'Powerups', area: 235 }, C[0], 700);
    for (const [team, y] of [[a, 20], [b, 110]] as [string, number][]) {
      const t = g.n('touch', { with: '' }, C[1], y);
      const f = g.n('otherIs', { mode: 'different' }, C[2], y);
      const d = g.n('damage', { target: 'other', amount: 1 }, C[3], y);
      g.set(t, 'cooldown', 0.5);
      g.w(team, t);
      g.w(t, f);
      g.w(f, d);
      keepMoving(team, y + 200);
      dies(team, y + 380);
      suddenDeath(team, y + 900);
    }
    const aw = g.n('groupCount', { group: b, cmp: 'atMost', value: 0 }, C[1], 760);
    const awEnd = g.n('end', { label: 'Orange wins' }, C[2], 760);
    const bw = g.n('groupCount', { group: a, cmp: 'atMost', value: 0 }, C[1], 840);
    const bwEnd = g.n('end', { label: 'Blue wins' }, C[2], 840);
    g.w(aw, awEnd);
    g.w(bw, bwEnd);
    return def('Arena: Teams', seed, g, { gravity: 0, clock: 'up' });
  }
  const n = v === 0 || v === 4 ? 2 : 4 + r.int(2);
  const fighters = square('Fighters', n);
  if (weapons) {
    g.n('weapon', { name: 'Weapons', holders: fighters, type: 'random' }, C[0], 700);
  } else {
    g.n('pickups', { name: 'Powerups', area: 235, min: n === 2 ? 4 : 5, max: n === 2 ? 8 : 10 }, C[0], 700);
    const t = g.n('touch', { with: '' }, C[1], 20);
    const d = g.n('damage', { target: 'other', amount: 1 }, C[2], 20);
    g.set(t, 'cooldown', 0.5);
    g.w(fighters, t);
    g.w(t, d);
  }
  keepMoving(fighters, 200);
  dies(fighters, 360);
  suddenDeath(fighters, 640);
  const last = g.n('groupCount', { group: fighters, cmp: 'atMost', value: 1 }, C[1], 520);
  const win = g.n('end', { label: '{self} wins' }, C[2], 520);
  g.w(last, win);
  return def(['Arena: Duel', 'Arena: Free-for-all', '', '', 'Arena: Weapons Duel', 'Arena: Weapons Brawl'][v], seed, g, { gravity: 0, clock: 'up' });
}

export const MODES: Mode[] = [
  { id: 'ring-escape', name: 'Ring Escape', prefix: 'RE', variants: [{ name: 'Classic' }, { name: 'Gauntlet' }, { name: 'Gauntlet 10K' }], make: ringEscape },
  { id: 'leak', name: 'Leak', prefix: 'LK', variants: [{ name: 'Classic' }, { name: 'Twin Gaps' }, { name: 'Pinhole' }], make: leak },
  { id: 'sledge', name: 'Doubling Sledge', prefix: 'DS', variants: [{ name: 'Classic' }, { name: 'Frenzy' }, { name: 'Heavy' }], make: sledge },
  { id: 'spiral', name: 'Spiral Drop', prefix: 'SD', variants: [{ name: 'Classic' }, { name: 'Long Way Down' }], make: spiralDrop },
  { id: 'mitosis', name: 'Mitosis', prefix: 'MI', variants: [{ name: 'Classic' }, { name: 'Rainbow' }], make: mitosis },
  { id: 'arena', name: 'Arena', prefix: 'AR', variants: [{ name: 'Duel' }, { name: 'Free-for-all' }, { name: 'Teams' }, { name: 'Boss' }, { name: 'Weapons Duel' }, { name: 'Weapons Brawl' }], make: arena },
  { id: 'tether', name: 'Tether Battle', prefix: 'TB', variants: [{ name: 'Classic' }, { name: 'Duel' }], make: tetherBattle },
  { id: 'growth', name: 'Growth', prefix: 'GR', variants: [{ name: 'Classic' }, { name: 'Crowd' }], make: growth },
];

/* ------------------------------------ Codes ------------------------------------- */

export interface Generated { mode: Mode; variant: number; seed: number; code: string; def: SimDef }

export function codeOf(mode: Mode, variant: number, seed: number): string {
  return `${mode.prefix}${variant + 1}-${(seed >>> 0).toString(36).toUpperCase()}`;
}

export function parseCode(code: string): { mode: Mode; variant: number; seed: number } | null {
  const m = /^([A-Z]{2})(\d+)-([0-9A-Z]+)$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const mode = MODES.find((x) => x.prefix === m[1]);
  const variant = Number(m[2]) - 1;
  if (!mode || variant < 0 || variant >= mode.variants.length) return null;
  const seed = parseInt(m[3], 36);
  if (!Number.isFinite(seed)) return null;
  return { mode, variant, seed: seed >>> 0 };
}

export function generate(mode: Mode, variant: number, seed: number): Generated {
  const d = mode.make(variant, seed);
  return { mode, variant, seed, code: codeOf(mode, variant, seed), def: d };
}

export function fromCode(code: string): Generated | null {
  const p = parseCode(code);
  return p ? generate(p.mode, p.variant, p.seed) : null;
}

/** A fresh random sim of a mode (random variant unless given). Uses Math.random only to pick the seed. */
export function randomOf(mode: Mode, variant?: number): Generated {
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const v = variant ?? Math.floor(Math.random() * mode.variants.length);
  return generate(mode, v, seed);
}

export function blankSim(): SimDef {
  const g = new G();
  g.n('ring', { name: 'Ring', count: 1, radius: 240, gaps: 0, spin: 0, palette: 'aurora' }, C[0], 200);
  g.n('ball', { name: 'Balls', count: 3, radius: 14, placement: 'scatter', spread: 80, speed: 200, look: { mode: 'preset', preset: 'palette' } }, C[0], 40);
  return def('Untitled', (Math.random() * 100000) | 0, g, { gravity: 450 });
}
