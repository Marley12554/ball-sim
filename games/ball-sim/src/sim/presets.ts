import type { NodeDef, WireDef, Params } from '@engine/index';
import type { SimDef, SimSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

/** Tiny graph builder for presets. Positions lay nodes out in columns. */
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
}

const COL = [40, 320, 600, 880];

function sim(name: string, seed: number, g: G, settings: Partial<SimSettings>): SimDef {
  return { v: 1, name, seed, settings: { ...DEFAULT_SETTINGS, ...settings }, graph: { nodes: g.nodes, wires: g.wires } };
}

function ringEscape(): SimDef {
  const g = new G();
  const rings = g.n('ring', { name: 'Rings', count: 12, radius: 70, spacing: 20, thickness: 3, gaps: 1, gapWidth: 32, gapPlacement: 'random', spin: 50, spinPattern: 'alternate', color: '#4A515C' }, COL[0], 220);
  const ball = g.n('ball', { name: 'Ball', count: 1, radius: 7, speed: 240, look: { mode: 'fixed', look: { t: 'solid', c: '#FF5A1F' } } }, COL[0], 40);
  const bounce = g.n('bounce', { wall: '' }, COL[1], 40);
  const faster = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1.03, clamp: true, min: 0, max: 1600 }, COL[2], 40);
  const leave = g.n('leave', { container: rings }, COL[1], 160);
  const breakRing = g.n('destroy', { target: 'other' }, COL[2], 160);
  const done = g.n('groupCount', { group: rings, cmp: 'atMost', value: 0 }, COL[1], 290);
  const escaped = g.n('end', { label: 'Escaped in {time}' }, COL[2], 290);
  const timer = g.n('after', { time: 60 }, COL[1], 400);
  const timeUp = g.n('end', { label: 'Time’s up' }, COL[2], 400);
  g.w(ball, bounce, leave);
  g.w(bounce, faster);
  g.w(leave, breakRing);
  g.w(done, escaped);
  g.w(timer, timeUp);
  void rings;
  return sim('Ring Escape', 7, g, { gravity: 500, clock: 'down', clockFrom: 60 });
}

function tetherBattle(): SimDef {
  const g = new G();
  const arena = g.n('ring', { name: 'Arena', count: 1, radius: 260, thickness: 4, gaps: 0, spin: 0, color: '#4A515C' }, COL[0], 220);
  const balls = g.n('ball', { name: 'Fighters', count: 5, radius: 13, speed: 340, placement: 'circle', spread: 120, look: { mode: 'preset', preset: 'countries' } }, COL[0], 40);
  const bounce = g.n('bounce', { wall: arena }, COL[1], 20);
  const tie = g.n('attachTether', { to: 'point', stiffness: 0.6, slack: 'current', limit: 6 }, COL[2], 0);
  const keep = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1, clamp: true, min: 300, max: 700 }, COL[2], 90);
  const cross = g.n('crossTether', {}, COL[1], 170);
  const cut = g.n('cutTether', { which: 'crossed' }, COL[2], 170);
  const none = g.n('valueReaches', { prop: 'tethers', cmp: 'below', value: 1 }, COL[1], 280);
  const gone = g.n('destroy', { target: 'self' }, COL[2], 280);
  const last = g.n('groupCount', { group: balls, cmp: 'atMost', value: 1 }, COL[1], 400);
  const win = g.n('end', { label: '{self} wins' }, COL[2], 400);
  g.w(balls, bounce, cross, none);
  g.w(bounce, tie, keep);
  g.w(cross, cut);
  g.w(none, gone);
  g.w(last, win);
  return sim('Tether Battle', 21, g, { clock: 'up' });
}

function doublingJaw(): SimDef {
  const g = new G();
  const ringN = g.n('ring', { name: 'Ring', count: 1, radius: 250, thickness: 5, gaps: 0, spin: 0, color: '#4A515C' }, COL[0], 260);
  const jawL = g.n('wall', { name: 'Jaw left', shape: 'line', x: 0, y: -40, angle: 60, length: 150, thickness: 6, motion: 'swing', amount: 26, period: 1.3, phase: 0, color: '#E7E9EC' }, COL[0], 380);
  const jawR = g.n('wall', { name: 'Jaw right', shape: 'line', x: 0, y: -40, angle: 120, length: 150, thickness: 6, motion: 'swing', amount: 26, period: 1.3, phase: 180, color: '#E7E9EC' }, COL[0], 500);
  const balls = g.n('ball', { name: 'Balls', count: 1, radius: 5, speed: 220, x: 0, y: 150, look: { mode: 'preset', preset: 'spectrum' } }, COL[0], 40);
  const bounce = g.n('bounce', { wall: '' }, COL[1], 40);
  const notRing = g.n('otherIs', { mode: 'notIn', group: ringN }, COL[2], 40);
  const dup = g.n('duplicate', { target: 'self', count: 1, spread: 70 }, COL[3], 40);
  const full = g.n('groupCount', { group: balls, cmp: 'atLeast', value: 800 }, COL[1], 200);
  const burst = g.n('destroy', { target: 'group', group: ringN }, COL[2], 160);
  const boom = g.n('explode', { at: 'center', radius: 500, strength: 900 }, COL[2], 250);
  const out = g.n('end', { label: 'The ring gave way' }, COL[2], 340);
  g.nodes.find((n) => n.id === bounce)!.params.cooldown = 0.5;
  g.w(balls, bounce);
  g.w(bounce, notRing);
  g.w(notRing, dup);
  g.w(full, burst, boom, out);
  void jawL; void jawR;
  return sim('Doubling Jaw', 3, g, { gravity: 300, maxObjects: 2000, endHold: 5 });
}

function spiralDrop(): SimDef {
  const g = new G();
  g.n('track', { name: 'Spiral', inner: 34, spacing: 36, turns: 6, thickness: 3, color: '#4A515C' }, COL[0], 300);
  const balls = g.n('ball', { name: 'Ball', count: 1, radius: 7, x: 113, y: -196, direction: 'angle', angle: -150, speed: 340, speedJitter: 30, drag: 0.5, look: { mode: 'preset', preset: 'palette' } }, COL[0], 40);
  const bonus = g.n('zone', { name: 'Bonus', shape: 'circle', x: -126, y: 0, radius: 14, color: '#FFB020' }, COL[0], 420);
  const center = g.n('zone', { name: 'Center', shape: 'circle', x: 0, y: 0, radius: 22, color: '#FF5A1F' }, COL[0], 540);
  const tries = g.n('counter', { name: 'Ball', initial: 1, show: true }, COL[0], 660);
  const score = g.n('counter', { name: 'Score', initial: 0, show: true }, COL[0], 760);
  const slow = g.n('valueReaches', { prop: 'speed', cmp: 'below', value: 85 }, COL[1], 40);
  const kill = g.n('destroy', { target: 'self' }, COL[2], 0);
  const next = g.n('spawn', { group: balls, count: 1, at: 'home' }, COL[2], 80);
  const harder = g.n('setProp', { target: 'defaults', group: balls, prop: 'speed', op: 'multiply', amount: 1.22 }, COL[2], 160);
  const count = g.n('count', { counter: tries, op: 'add', amount: 1 }, COL[2], 240);
  const enterBonus = g.n('enter', { container: bonus }, COL[1], 330);
  const dbl = g.n('count', { counter: score, op: 'add', amount: 10 }, COL[2], 330);
  const bounce = g.n('bounce', { wall: '' }, COL[1], 430);
  const pt = g.n('count', { counter: score, op: 'add', amount: 1 }, COL[2], 430);
  const enterCenter = g.n('enter', { container: center }, COL[1], 530);
  const win = g.n('end', { label: 'Reached the center' }, COL[2], 530);
  g.w(balls, slow, enterBonus, bounce, enterCenter);
  g.w(slow, kill, next, harder, count);
  g.w(enterBonus, dbl);
  g.w(bounce, pt);
  g.w(enterCenter, win);
  g.nodes.find((n) => n.id === bounce)!.params.cooldown = 0.2;
  return sim('Spiral Drop', 11, g, { gravityMode: 'point', gravity: 1200, clock: 'up', speedLimit: 2000 });
}

function arena(): SimDef {
  const g = new G();
  g.n('wall', { name: 'Arena', shape: 'box', width: 540, height: 540, thickness: 4, color: '#4A515C' }, COL[0], 420);
  const fighters = g.n('ball', { name: 'Fighters', count: 6, radius: 14, hp: 100, speed: 260, placement: 'circle', spread: 170, look: { mode: 'preset', preset: 'countries' } }, COL[0], 40);
  const tanks = g.n('ball', { name: 'Tanks', count: 2, radius: 22, hp: 220, density: 2, speed: 140, placement: 'line', spread: 60, look: { mode: 'preset', preset: 'countries' } }, COL[0], 230);
  const hitF = g.n('touch', { with: '' }, COL[1], 20);
  const dmgF = g.n('setProp', { target: 'other', prop: 'hp', op: 'add', amount: -12 }, COL[2], 20);
  const hitT = g.n('touch', { with: '' }, COL[1], 120);
  const dmgT = g.n('setProp', { target: 'other', prop: 'hp', op: 'add', amount: -22 }, COL[2], 120);
  const dash = g.n('every', { interval: 2.5 }, COL[1], 220);
  const dashA = g.n('push', { target: 'self', direction: 'random', strength: 300 }, COL[2], 220);
  const keep = g.n('bounce', { wall: '' }, COL[1], 320);
  const keepA = g.n('setProp', { target: 'self', prop: 'speed', op: 'multiply', amount: 1, clamp: true, min: 150, max: 520 }, COL[2], 320);
  const dead = g.n('valueReaches', { prop: 'hp', cmp: 'below', value: 1 }, COL[1], 420);
  const kill = g.n('destroy', { target: 'self' }, COL[2], 400);
  const pop = g.n('explode', { at: 'point', radius: 90, strength: 350 }, COL[2], 480);
  const last = g.n('groupCount', { group: '', cmp: 'atMost', value: 1 }, COL[1], 560);
  const win = g.n('end', { label: '{self} wins' }, COL[2], 560);
  g.nodes.find((n) => n.id === hitF)!.params.cooldown = 0.3;
  g.nodes.find((n) => n.id === hitT)!.params.cooldown = 0.6;
  g.w(fighters, hitF, dash, keep, dead);
  g.w(tanks, hitT, keep, dead);
  g.w(hitF, dmgF);
  g.w(hitT, dmgT);
  g.w(dash, dashA);
  g.w(keep, keepA);
  g.w(dead, kill, pop);
  g.w(last, win);
  return sim('Arena', 5, g, { clock: 'up' });
}

function growth(): SimDef {
  const g = new G();
  g.n('ring', { name: 'Ring', count: 1, radius: 250, thickness: 4, gaps: 0, spin: 0, color: '#4A515C' }, COL[0], 220);
  const balls = g.n('ball', { name: 'Balls', count: 3, radius: 6, speed: 320, placement: 'line', spread: 60, look: { mode: 'preset', preset: 'countries' } }, COL[0], 40);
  const bounce = g.n('bounce', { wall: '' }, COL[1], 40);
  const grow = g.n('setProp', { target: 'self', prop: 'size', op: 'multiply', amount: 1.035 }, COL[2], 40);
  const big = g.n('valueReaches', { prop: 'size', cmp: 'above', value: 110 }, COL[1], 160);
  const end = g.n('end', { label: '{self} filled the ring' }, COL[2], 160);
  g.w(balls, bounce, big);
  g.w(bounce, grow);
  g.w(big, end);
  return sim('Growth', 9, g, { gravity: 450, clock: 'up' });
}

function split(): SimDef {
  const g = new G();
  g.n('wall', { name: 'Box', shape: 'box', width: 520, height: 520, thickness: 4, color: '#4A515C' }, COL[0], 300);
  const balls = g.n('ball', { name: 'Cells', count: 1, radius: 6, speed: 260, look: { mode: 'preset', preset: 'patterns' } }, COL[0], 40);
  const bounce = g.n('bounce', { wall: '' }, COL[1], 40);
  const ch = g.n('chance', { percent: 35 }, COL[2], 40);
  const dup = g.n('duplicate', { target: 'self', count: 1, spread: 120 }, COL[3], 40);
  const old = g.n('valueReaches', { prop: 'age', cmp: 'above', value: 14 }, COL[1], 170);
  const fade = g.n('destroy', { target: 'self' }, COL[2], 170);
  const many = g.n('groupCount', { group: balls, cmp: 'atLeast', value: 600 }, COL[1], 280);
  const out = g.n('end', { label: 'Overgrown at {time}' }, COL[2], 280);
  const gone = g.n('groupCount', { group: balls, cmp: 'atMost', value: 0 }, COL[1], 380);
  const out2 = g.n('end', { label: 'Died out at {time}' }, COL[2], 380);
  g.w(balls, bounce, old);
  g.w(bounce, ch);
  g.w(ch, dup);
  g.w(old, fade);
  g.w(many, out);
  g.w(gone, out2);
  return sim('Split', 4, g, { clock: 'up', maxObjects: 1500 });
}

export interface Preset {
  id: string;
  make: () => SimDef;
}

export const PRESETS: Preset[] = [
  { id: 'ring-escape', make: ringEscape },
  { id: 'tether-battle', make: tetherBattle },
  { id: 'doubling-jaw', make: doublingJaw },
  { id: 'spiral-drop', make: spiralDrop },
  { id: 'arena', make: arena },
  { id: 'growth', make: growth },
  { id: 'split', make: split },
];

export function blankSim(): SimDef {
  const g = new G();
  g.n('ring', { name: 'Ring', count: 1, radius: 220, gaps: 0, spin: 0, color: '#4A515C' }, COL[0], 200);
  g.n('ball', { name: 'Balls', count: 3, radius: 8, speed: 260, placement: 'scatter', spread: 80 }, COL[0], 40);
  return sim('Untitled', Math.floor(Math.random() * 100000), g, { gravity: 400 });
}
