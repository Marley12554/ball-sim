import { Runner } from '@engine/index';
import { Sim } from '../sim/sim';
import type { SimDef } from '../sim/types';
import { Renderer } from '../render/renderer';

/* One animation loop for everything on screen. */
type Tick = (dt: number) => void;
const ticks = new Set<Tick>();
let last = 0;
let running = false;
function loop(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  for (const t of [...ticks]) t(dt);
  if (ticks.size) requestAnimationFrame(loop);
  else { running = false; last = 0; }
}
export function onTick(t: Tick): () => void {
  ticks.add(t);
  if (!running) { running = true; requestAnimationFrame(loop); }
  return () => ticks.delete(t);
}

export interface PlayerOptions {
  hud?: boolean;
  /** Restart automatically some seconds after the outcome. */
  loop?: boolean;
  budgetMs?: number;
  dprCap?: number;
  hudTop?: number;
}

/** A sim running in a canvas: sim + fixed-step runner + renderer. */
export class Player {
  def!: SimDef;
  sim!: Sim;
  runner!: Runner;
  readonly renderer: Renderer;
  error: string | null = null;
  speed = 1;
  paused = false;
  onFire: ((nodeId: string) => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, def: SimDef, readonly opts: PlayerOptions = {}) {
    this.renderer = new Renderer(canvas);
    this.load(def);
  }

  load(def: SimDef): void {
    this.def = def;
    try {
      this.sim = new Sim(def);
      this.error = null;
    } catch (e) {
      console.error(e);
      this.error = String((e as Error).message ?? e);
      this.sim = new Sim({ ...def, graph: { nodes: [], wires: [] } });
    }
    const sim = this.sim;
    if (this.onFire) {
      const f = this.onFire;
      const orig = sim.dispatcher.fire.bind(sim.dispatcher);
      sim.dispatcher.fire = (t, key, time, e) => {
        const ok = orig(t, key, time, e);
        if (ok) f(t.id);
        return ok;
      };
    }
    this.runner = new Runner(() => sim.step(), { dt: sim.dt, budgetMs: this.opts.budgetMs ?? 10 });
    this.runner.speed = this.speed;
    this.runner.paused = this.paused;
    this.renderer.fit(sim);
    this.onRestart?.();
  }

  restart(): void {
    this.load(this.def);
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.runner.speed = s;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.runner.paused = p;
  }

  frame(dt: number): void {
    this.runner.frame(dt);
    if (this.opts.loop && this.sim.outcome && this.sim.sinceEnd > this.def.settings.endHold) this.restart();
    this.draw();
  }

  draw(): void {
    this.renderer.resize(this.opts.dprCap ?? 2);
    this.renderer.draw(this.sim, { hud: this.opts.hud, hudTop: this.opts.hudTop });
  }
}

export function simMeta(sim: Sim): string {
  const w = sim.world;
  const objects = w.aliveCount + w.colAlive.filter(Boolean).length + sim.zones.length;
  const rules = sim.triggers.length;
  return `${objects} object${objects === 1 ? '' : 's'} · ${rules} rule${rules === 1 ? '' : 's'} · seed ${sim.def.seed}`;
}
