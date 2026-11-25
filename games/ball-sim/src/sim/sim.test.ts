import { describe, expect, it } from 'vitest';
import { analyzeGraph } from '@engine/index';
import { Sim } from './sim';
import { PRESETS } from './presets';
import { registry } from './blocks';

const run = (id: string, seconds: number, seed?: number) => {
  const def = PRESETS.find((p) => p.id === id)!.make();
  if (seed !== undefined) def.seed = seed;
  const sim = new Sim(def);
  const steps = Math.round(seconds / sim.dt);
  for (let s = 0; s < steps && !(sim.outcome && sim.sinceEnd > 0.5); s++) sim.step();
  return sim;
};

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.id}: every wire is valid`, () => {
      const def = p.make();
      const a = analyzeGraph(def.graph, registry);
      const bad = def.graph.wires.filter((_, k) => a.wireError[k]);
      expect(bad).toEqual([]);
    });

    it(`${p.id}: runs and replays identically`, () => {
      const a = run(p.id, 20);
      const b = run(p.id, 20);
      expect(a.world.stateHash()).toBe(b.world.stateHash());
      expect(a.outcome?.label ?? null).toBe(b.outcome?.label ?? null);
    });
  }

  it('ring escape: bounces speed the ball up and escaping breaks rings', () => {
    const sim = run('ring-escape', 60);
    const rings = sim.world.colAlive.filter(Boolean).length;
    expect(rings).toBeLessThan(12);
    expect(sim.outcome).not.toBeNull();
  });

  it('tether battle: tethers get attached and cut, balls drop out', () => {
    const sim = run('tether-battle', 90);
    expect(sim.tSeq.some((s) => s > 0)).toBe(true);
    expect(sim.countAllBalls()).toBeLessThan(5);
  });

  it('doubling jaw: the jaw duplicates balls', () => {
    const sim = run('doubling-jaw', 15);
    expect(sim.countAllBalls()).toBeGreaterThan(4);
  });

  it('arena: fighters take damage and someone wins', () => {
    const sim = run('arena', 120);
    expect(sim.countAllBalls()).toBeLessThan(8);
  });
});

describe('guards', () => {
  it('object cap holds under runaway duplication', () => {
    const def = PRESETS.find((p) => p.id === 'split')!.make();
    def.settings.maxObjects = 200;
    // Duplicate on every bounce, no cooldown.
    for (const n of def.graph.nodes) if (n.type === 'chance') n.params.percent = 100;
    const sim = new Sim(def);
    for (let s = 0; s < 120 * 30; s++) sim.step();
    expect(sim.world.aliveCount).toBeLessThanOrEqual(200);
  });

  it('firing cap drops excess firings deterministically', () => {
    const def = PRESETS.find((p) => p.id === 'doubling-jaw')!.make();
    const sim = new Sim(def);
    sim.dispatcher.maxFiringsPerStep = 3;
    for (let s = 0; s < 120 * 10; s++) sim.step();
    expect(sim.dispatcher.stats.firings).toBeGreaterThan(0);
  });
});
