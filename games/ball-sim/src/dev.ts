// Dev page: renders a preset by id (?p=spiral-drop&speed=4). Not part of the app UI.
import { Runner } from '@engine/index';
import { Sim } from './sim/sim';
import { PRESETS } from './sim/presets';
import { Renderer } from './render/renderer';

const q = new URLSearchParams(location.search);
const def = (PRESETS.find((p) => p.id === q.get('p')) ?? PRESETS[0]).make();
if (q.get('seed')) def.seed = Number(q.get('seed'));
const sim = new Sim(def);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new Renderer(canvas);
const runner = new Runner(() => sim.step(), { dt: sim.dt });
runner.speed = Number(q.get('speed') ?? 1);
const skip = Number(q.get('skip') ?? 0);
for (let s = 0; s < skip * 120; s++) sim.step();
let last = performance.now();
(window as any).sim = sim;
function frame(now: number) {
  runner.frame((now - last) / 1000);
  last = now;
  r.resize();
  r.draw(sim, { hud: true });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
