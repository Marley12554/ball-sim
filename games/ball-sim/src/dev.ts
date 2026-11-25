// Dev page: renders one sim full screen. ?p=<mode>&v=<variant>&code=<code>&skip=<seconds>&speed=<x>
import { MODES, randomOf, fromCode } from './sim/modes';
import { Player, onTick } from './ui/player';

const q = new URLSearchParams(location.search);
const mode = MODES.find((m) => m.id === q.get('p')) ?? MODES[0];
const gen = q.get('code') ? fromCode(q.get('code')!)! : randomOf(mode, Number(q.get('v') ?? 0));
const canvas = document.getElementById('c') as HTMLCanvasElement;
const player = new Player(canvas, gen.def, { hud: true });
player.setSpeed(Number(q.get('speed') ?? 1));
const skip = Number(q.get('skip') ?? 0);
for (let s = 0; s < skip * 120; s++) player.sim.step();
player.sim.fx = [];
(window as any).sim = player.sim;
onTick((dt) => player.frame(dt));
