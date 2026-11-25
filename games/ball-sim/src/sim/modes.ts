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

/** Pushes nodes in the same column down so none overlap in the editor. */
function tidy(nodes: NodeDef[]): void {
  const cols = new Map<number, NodeDef[]>();
  for (const n of nodes) {
    const k = Math.round(n.x / 140);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k)!.push(n);
  }
  for (const col of cols.values()) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + 84);
  }
}

function def(name: string, seed: number, g: G, settings: Partial<SimSettings>): SimDef {
  tidy(g.nodes);
  return { v: 1, name, seed, settings: { ...DEFAULT_SETTINGS, ...settings }, graph: { nodes: g.nodes, wires: g.wires } };
}

const COLORFUL: LookSetting['mode'] = 'preset';
const pick = <T,>(r: Rng, a: T[]): T => a[r.int(a.length)];
const vivid = (r: Rng) => pick(r, PALETTE_NAMES.filter((p) => p !== 'titanium' && !p.startsWith('duo')));
const ballLook = (r: Rng): LookSetting => ({ mode: COLORFUL, preset: pick(r, ['palette', 'gradients', 'patterns', 'spectrum']) as any });

export interface Variant { name: string; desc: string }
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
  if (v >= 1) return ringGauntlet(v, seed, r, g);
  const count = 10 + r.int(5);
  const rings = g.n('ring', {
    name: 'Rings', count, radius: 64, spacing: 24, thickness: 5, gaps: 1, gapWidth: 30 + r.int(12), gapPlacement: 'random',
    spin: 40 + r.int(30), spinPattern: r.chance(0.5) ? 'alternate' : 'faster', palette: vivid(r),
  }, C[0], 220);
  const ball = g.n('ball', { name: 'Ball', count: 1, radius: 11, speed: 0, look: { mode: 'fixed', look: { t: 'gradient', c: ['#FFFFFF', '#FDE68A'], kind: 'radial', angle: 0 } } }, C[0], 40);
  g.n('counter', { name: 'Rings', source: 'count', group: rings, show: true }, C[0], 380);
  const bounce = g.n('bounce', { wall: '' }, C[1], 40);
  const faster = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1.03, clamp: true, min: 0, max: 1500 }, C[2], 40);
  const leave = g.n('leave', { container: rings }, C[1], 160);
  const breakRing = g.n('destroy', { target: 'other' }, C[2], 160);
  const done = g.n('groupCount', { group: rings, cmp: 'atMost', value: 0 }, C[1], 280);
  const escaped = g.n('end', { label: 'Escaped in {time}' }, C[2], 280);
  const timer = g.n('after', { time: 60 }, C[1], 400);
  const timeUp = g.n('end', { label: 'Time’s up' }, C[2], 400);
  g.w(ball, bounce, leave);
  g.w(bounce, faster);
  g.w(leave, breakRing);
  g.w(done, escaped);
  g.w(timer, timeUp);
  return def('Ring Escape', seed, g, { gravity: 520, clock: 'down', clockFrom: 60, maxObjects: 16 });
}

/**
 * Gauntlet: hundreds of thin rings spinning together with their gaps lined up
 * into one rotating tunnel. The ball breaks out through the tunnel, rings it
 * passes turn to powder, the tunnel wall knocks it back, and the remaining
 * rings snap back in around it. No gravity, steady speed.
 */
export const GAUNTLET = { spin: 62, spread: 35, gap: 64, speed: 400 };
function ringGauntlet(v: number, seed: number, r: Rng, g: G): SimDef {
  const count = v === 2 ? 10000 : 1000;
  const rings = g.n('ring', {
    name: 'Rings', count, radius: 84, spacing: 9, thickness: 3, gaps: 1, gapPlacement: 'aligned', gapWidth: GAUNTLET.gap,
    gapAngle: r.int(360), spin: (GAUNTLET.spin + r.int(12)) * (r.chance(0.5) ? 1 : -1), spinPattern: 'same',
    snapBack: true, palette: vivid(r), paletteCycle: 45,
  }, C[0], 220);
  const ball = g.n('ball', { name: 'Ball', count: 1, radius: 6, speed: GAUNTLET.speed, direction: 'random', gravity: 0, look: { mode: 'fixed', look: { t: 'gradient', c: ['#FFFFFF', '#E0F2FE'], kind: 'radial', angle: 0 } } }, C[0], 40);
  g.n('counter', { name: 'Rings', source: 'count', group: rings, show: true, place: 'center' }, C[0], 380);
  const bounce = g.n('bounce', { wall: '' }, C[1], 40);
  // A nudge toward the middle on every bounce keeps the ball from skimming around the wall forever.
  // Every bounce sends the ball back across the circle. A round wall would otherwise keep a shallow angle forever.
  const facing = g.n('wallFaces', { toward: 'center', within: 45 }, C[2], 0);
  const aimBack = g.n('aim', { target: 'self', toward: 'center', spread: GAUNTLET.spread }, C[3], 0);
  const steady = g.n('setProp', { target: 'self', prop: 'speed', op: 'set', amount: GAUNTLET.speed }, C[2], 140);
  const leave = g.n('leave', { container: rings }, C[1], 160);
  const breakRing = g.n('destroy', { target: 'other' }, C[2], 160);
  const done = g.n('groupCount', { group: rings, cmp: 'atMost', value: 0 }, C[1], 280);
  const escaped = g.n('end', { label: `Escaped all ${count.toLocaleString('en-US')} rings in {time}` }, C[2], 280);
  g.w(ball, bounce, leave);
  g.w(bounce, facing, steady);
  g.w(facing, aimBack);
  g.w(leave, breakRing);
  g.w(done, escaped);
  return def(v === 2 ? 'Ring Gauntlet 10K' : 'Ring Gauntlet', seed, g, { gravity: 0, clock: 'up', view: 330, camera: 'zoom', maxObjects: 16, speedLimit: 2000, restThreshold: 0, impactThreshold: 0 });
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
  const full = g.n('fill', { container: ringN, percent: 102, hold: 3 }, C[1], 280);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 260);
  const boom = g.n('explode', { at: 'center', radius: 900, strength: 1300 }, C[2], 340);
  const endN = g.n('end', { label: 'The ring burst at {time}' }, C[2], 420);
  g.w(balls, out, gone);
  g.w(out, two);
  g.w(gone, del);
  g.w(full, pop, boom, endN);
  return def(['Leak', 'Leak: Twin Gaps', 'Leak: Pinhole'][v], seed, g, { gravity: 520, clock: 'up', maxObjects: 2600, pairCorrection: 0.22, restThreshold: 40, endHold: 6 });
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
  const full = g.n('fill', { container: ringN, percent: 88, hold: 3 }, C[1], 220);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 180);
  const pop2 = g.n('destroy', { target: 'group', group: sl }, C[2], 260);
  const boom = g.n('explode', { at: 'center', radius: 1000, strength: 1500 }, C[2], 340);
  const endN = g.n('end', { label: 'The ring gave way at {time}' }, C[2], 420);
  g.w(balls, crush);
  g.w(crush, dup);
  g.w(full, pop, pop2, boom, endN);
  return def(['Doubling Sledge', 'Doubling Sledge: Frenzy', 'Doubling Sledge: Heavy'][v], seed, g, { gravity: 560, clock: 'up', maxObjects: 2600, pairCorrection: 0.22, restThreshold: 45, endHold: 6 });
}

/* --------------------------------- Spiral Drop ---------------------------------- */

export const SPIRAL_DRAG = [0.012, 0.012];
export const SPIRAL_LAUNCH = { speed: 300, mult: 1.3 };

function spiralDrop(v: number, seed: number): SimDef {
  const r = new Rng(seed);
  const g = new G();
  // The channel is only a little wider than a ball, with dull walls, so balls slide instead of rattling.
  const BALL = 12, WIDTH = 30;
  const turns = v === 1 ? 11 : 8;
  const geo = spiralGeometry({ x: 0, y: 30, inner: 54, width: WIDTH, turns, chuteLength: 150 });
  g.n('track', { name: 'Spiral', x: 0, y: 30, inner: 54, width: WIDTH, turns, thickness: 4, bounciness: 0.6, chute: true, chuteLength: 150, palette: vivid(r) }, C[0], 300);
  const balls = g.n('ball', {
    name: 'Balls', count: 1, radius: BALL, x: Math.round(geo.entry.x), y: Math.round(geo.entry.y), direction: 'angle', angle: 35,
    speed: SPIRAL_LAUNCH.speed, speedJitter: 60, drag: SPIRAL_DRAG[v], bounciness: 0.3, collide: false, look: ballLook(r),
  }, C[0], 40);
  const gates: string[] = [];
  const gateTs = v === 1 ? [[3.2, 2], [8.4, 3], [14.2, 2]] : [[3.2, 2], [8.6, 3]];
  gateTs.forEach(([t, m], k) => {
    const p = geo.mid(t * Math.PI);
    gates.push(g.n('zone', { name: `×${m}`, shape: 'circle', x: Math.round(p.x), y: Math.round(p.y), radius: 13, label: `×${m}`, color: m === 3 ? '#F472B6' : '#FBBF24' }, C[0], 440 + k * 120));
  });
  const center = g.n('zone', { name: 'Center', shape: 'circle', x: 0, y: 30, radius: 36, label: '', color: '#5EEAD4' }, C[0], 800);
  const round = g.n('counter', { name: 'Round', initial: 1, show: true }, C[0], 920);
  g.n('counter', { name: 'Balls', source: 'count', group: balls, show: true }, C[0], 1020);
  const stall = g.n('valueReaches', { prop: 'stall', cmp: 'above', value: 1.9 }, C[1], 40);
  const fall = g.n('fallOff', { target: 'self' }, C[2], 40);
  const empty = g.n('groupCount', { group: balls, cmp: 'atMost', value: 0 }, C[1], 160);
  const next = g.n('count', { counter: round, op: 'add', amount: 1 }, C[2], 120);
  const spawnN = g.n('spawn', { group: balls, countFrom: round, at: 'home', stagger: 0.45 }, C[2], 200);
  const faster = g.n('setProp', { target: 'defaults', group: balls, prop: 'speed', op: 'multiply', amount: SPIRAL_LAUNCH.mult }, C[2], 280);
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
  const full = g.n('fill', { container: ringN, percent: 102, hold: 3 }, C[1], 340);
  const pop = g.n('destroy', { target: 'group', group: ringN }, C[2], 320);
  const boom = g.n('explode', { at: 'center', radius: 1000, strength: 1400 }, C[2], 400);
  const endN = g.n('end', { label: 'Overgrown at {time}' }, C[2], 480);
  g.w(cells, tick, bounce, big);
  g.w(tick, grow);
  g.w(bounce, feed);
  g.w(big, divide);
  g.w(full, pop, boom, endN);
  return def(['Mitosis', 'Mitosis: Rainbow'][v], seed, g, { gravity: 450, clock: 'up', maxObjects: 2600, pairCorrection: 0.22, restThreshold: 45, endHold: 6 });
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
    const nudge = g.n('push', { target: 'self', direction: 'random', strength: 60 }, C[2], y - 40);
    g.w(b, nudge);
    // Steady speed: a bounce changes direction a little, never speed.
    const k = g.n('setProp', { target: 'self', prop: 'speed', op: 'set', amount: weapons ? 300 : 330 }, C[2], y);
    g.w(holder, b);
    g.w(b, k);
  };
  // Sudden death: after a minute everyone grows and speeds up, so fights can't stall.
  const suddenDeath = (holder: string, y: number) => {
    const tick = g.n('every', { interval: 6, from: 60 }, C[1], y);
    const grow = g.n('setProp', { target: 'group', group: holder, prop: 'size', op: 'multiply', amount: 1.12, clamp: true, min: 4, max: 44 }, C[2], y);
    g.w(tick, grow);
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
    const a = square('Orange', 3, { look: { mode: 'fixed', look: { t: 'gradient', c: ['#FDBA74', '#F43F5E'], kind: 'radial', angle: 0 } }, x: -110, spread: 120 });
    const b = square('Blue', 3, { look: { mode: 'fixed', look: { t: 'gradient', c: ['#67E8F9', '#6366F1'], kind: 'radial', angle: 0 } }, x: 110, spread: 120 });
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
  { id: 'ring-escape', name: 'Ring Escape', prefix: 'RE', make: ringEscape, variants: [
    { name: 'Classic', desc: 'A dozen spinning rings with random gaps. Escape them all before the clock runs out.' },
    { name: 'Gauntlet', desc: '1,000 thin rings spinning together. Break out through the tunnel, the hole closes behind you.' },
    { name: 'Gauntlet 10K', desc: 'The same, with 10,000 rings.' },
  ] },
  { id: 'leak', name: 'Leak', prefix: 'LK', make: leak, variants: [
    { name: 'Classic', desc: 'Every ball that gets out brings two more. The ring bursts once it is packed solid.' },
    { name: 'Twin Gaps', desc: 'Two gaps and a faster spin.' },
    { name: 'Pinhole', desc: 'A tiny gap. Slow to start, then it runs away.' },
  ] },
  { id: 'sledge', name: 'Doubling Sledge', prefix: 'DS', make: sledge, variants: [
    { name: 'Classic', desc: 'A titanium hammer slams side to side. Every ball it crushes comes out the other side doubled.' },
    { name: 'Frenzy', desc: 'Shorter rests, faster swings.' },
    { name: 'Heavy', desc: 'Bigger heads and a wider swing.' },
  ] },
  { id: 'spiral', name: 'Spiral Drop', prefix: 'SD', make: spiralDrop, variants: [
    { name: 'Classic', desc: 'Balls slide down a spiral. One more ball each round, a bit faster. Gates multiply them.' },
    { name: 'Long Way Down', desc: 'More turns and three gates.' },
  ] },
  { id: 'mitosis', name: 'Mitosis', prefix: 'MI', make: mitosis, variants: [
    { name: 'Classic', desc: 'Cells grow and split in half until the ring is packed solid.' },
    { name: 'Rainbow', desc: 'Four starting cells in spectrum colors.' },
  ] },
  { id: 'arena', name: 'Arena', prefix: 'AR', make: arena, variants: [
    { name: 'Duel', desc: 'Two squares. Contact hurts both. Powerups decide it.' },
    { name: 'Free-for-all', desc: 'Four or five squares, last one standing.' },
    { name: 'Teams', desc: 'Orange against blue. Teammates can’t hurt each other.' },
    { name: 'Boss', desc: 'Four heroes against the Imp.' },
    { name: 'Weapons Duel', desc: 'Two fighters with random weapons. Hits charge a special move.' },
    { name: 'Weapons Brawl', desc: 'Four or five armed fighters.' },
  ] },
  { id: 'tether', name: 'Tether Battle', prefix: 'TB', make: tetherBattle, variants: [
    { name: 'Classic', desc: 'Bounces tie strings to the wall. Crossing a string cuts it. Lose them all and you drop out.' },
    { name: 'Duel', desc: 'Just two.' },
  ] },
  { id: 'growth', name: 'Growth', prefix: 'GR', make: growth, variants: [
    { name: 'Classic', desc: 'Balls grow on every bounce until one fills the ring.' },
    { name: 'Crowd', desc: 'Six balls.' },
  ] },
];

/** Ball look overrides, one letter each in codes. */
export const LOOK_CODES: { code: string; label: string; preset: LookSetting | null }[] = [
  { code: '', label: 'Default', preset: null },
  { code: 'P', label: 'Colors', preset: { mode: 'preset', preset: 'palette' } },
  { code: 'C', label: 'Countries', preset: { mode: 'preset', preset: 'countries' } },
  { code: 'G', label: 'Gradients', preset: { mode: 'preset', preset: 'gradients' } },
  { code: 'T', label: 'Patterns', preset: { mode: 'preset', preset: 'patterns' } },
  { code: 'S', label: 'Spectrum', preset: { mode: 'preset', preset: 'spectrum' } },
  { code: 'R', label: 'Anything', preset: { mode: 'preset', preset: 'random' } },
];

function applyLook(d: SimDef, look: string): void {
  const l = LOOK_CODES.find((x) => x.code === look)?.preset;
  if (!l) return;
  for (const n of d.graph.nodes) {
    if (n.type !== 'ball') continue;
    const cur = n.params.look as LookSetting | undefined;
    if (cur && cur.mode === 'fixed' && cur.look.t === 'imp') continue;
    n.params.look = structuredClone(l);
  }
}

/* ------------------------------------ Codes ------------------------------------- */

export interface Generated { mode: Mode; variant: number; seed: number; look: string; code: string; def: SimDef }

/** Short code: mode, variant, seed, and an optional look letter (`RE2-4F9K2` or `RE2-4F9K2-C`). */
export function codeOf(mode: Mode, variant: number, seed: number, look = ''): string {
  return `${mode.prefix}${variant + 1}-${(seed >>> 0).toString(36).toUpperCase()}${look ? `-${look}` : ''}`;
}

export function parseCode(code: string): { mode: Mode; variant: number; seed: number; look: string } | null {
  const m = /^([A-Z]{2})(\d+)-([0-9A-Z]+)(?:-([A-Z]))?$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const mode = MODES.find((x) => x.prefix === m[1]);
  const variant = Number(m[2]) - 1;
  if (!mode || variant < 0 || variant >= mode.variants.length) return null;
  const seed = parseInt(m[3], 36);
  if (!Number.isFinite(seed)) return null;
  const look = m[4] ?? '';
  if (look && !LOOK_CODES.some((l) => l.code === look)) return null;
  return { mode, variant, seed: seed >>> 0, look };
}

export function generate(mode: Mode, variant: number, seed: number, look = ''): Generated {
  const d = mode.make(variant, seed);
  applyLook(d, look);
  return { mode, variant, seed, look, code: codeOf(mode, variant, seed, look), def: d };
}

export function fromCode(code: string): Generated | null {
  const p = parseCode(code);
  return p ? generate(p.mode, p.variant, p.seed, p.look) : null;
}

/** A fresh random seed of a mode (variant 0 unless given). Uses Math.random only to pick the seed. */
export function randomOf(mode: Mode, variant = 0, look = ''): Generated {
  const seed = (Math.random() * 2 ** 31) >>> 0;
  return generate(mode, variant, seed, look);
}

export function blankSim(): SimDef {
  const g = new G();
  g.n('ring', { name: 'Ring', count: 1, radius: 240, gaps: 0, spin: 0, palette: 'aurora' }, C[0], 200);
  g.n('ball', { name: 'Balls', count: 3, radius: 14, placement: 'scatter', spread: 80, speed: 200, look: { mode: 'preset', preset: 'palette' } }, C[0], 40);
  return def('Untitled', (Math.random() * 100000) | 0, g, { gravity: 450 });
}
