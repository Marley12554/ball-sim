import { describe, expect, it } from 'vitest';
import { analyzeGraph } from '@engine/index';
import { Sim } from './sim';
import { MODES, generate, codeOf, parseCode, fromCode } from './modes';
import { registry } from './blocks';

function run(modeId: string, v: number, seed: number, seconds: number, stopAfterEnd = true) {
  const mode = MODES.find((m) => m.id === modeId)!;
  const sim = new Sim(generate(mode, v, seed).def);
  const steps = Math.round(seconds / sim.dt);
  for (let s = 0; s < steps && !(stopAfterEnd && sim.outcome && sim.sinceEnd > 0.5); s++) sim.step();
  return sim;
}

describe('modes', () => {
  for (const mode of MODES) {
    mode.variants.forEach((variant, v) => {
      it(`${mode.id} ${variant.name}: wires valid, runs, replays identically`, () => {
        const d = generate(mode, v, 12345).def;
        const a = analyzeGraph(d.graph, registry);
        expect(d.graph.wires.filter((_, k) => a.wireError[k])).toEqual([]);
        const secs = mode.id === 'ring-escape' && v > 0 ? 4 : 8;
        const s1 = run(mode.id, v, 12345, secs), s2 = run(mode.id, v, 12345, secs);
        expect(s1.world.stateHash()).toBe(s2.world.stateHash());
      });
    });
  }

  it('codes round-trip', () => {
    const m = MODES[3];
    const code = codeOf(m, 1, 987654);
    expect(parseCode(code)).toEqual({ mode: m, variant: 1, seed: 987654, look: '' });
    expect(parseCode(codeOf(m, 0, 42, 'C'))).toEqual({ mode: m, variant: 0, seed: 42, look: 'C' });
    expect(fromCode(code.toLowerCase())?.code).toBe(code);
    expect(parseCode('ZZ1-ABC')).toBeNull();
  });

  it('nothing moves during the start delay', () => {
    const sim = run('ring-escape', 0, 1, 1.0);
    expect(sim.world.stepCount).toBe(0);
  });
});

describe('mechanics', () => {
  it('ring escape: escaping breaks rings', () => {
    const sim = run('ring-escape', 0, 7, 62);
    expect(sim.world.colAlive.filter(Boolean).length).toBeLessThan(10);
    expect(sim.outcome).not.toBeNull();
  });

  it('gauntlet: the ball tunnels through many rings', () => {
    const sim = run('ring-escape', 1, 3, 30);
    const alive = sim.world.colAlive.filter(Boolean).length;
    expect(1000 - alive).toBeGreaterThan(15);
  });

  it('leak: every escape adds two balls', () => {
    const sim = run('leak', 0, 5, 25);
    expect(sim.countAllBalls()).toBeGreaterThan(8);
  });

  it('sledge: crushed balls double and stay visible', () => {
    const sim = run('sledge', 0, 2, 25);
    expect(sim.countAllBalls()).toBeGreaterThan(12);
    // Crushed balls go through the head; none are hidden or faded.
    for (let i = 0; i < sim.world.highWater; i++) if (sim.world.alive[i]) expect(sim.alpha[i]).toBe(1);
  });

  it('mitosis: cells divide', () => {
    const sim = run('mitosis', 0, 4, 20);
    expect(sim.countAllBalls()).toBeGreaterThan(10);
  });

  it('arena duel: someone wins', () => {
    const sim = run('arena', 0, 9, 240);
    expect(sim.outcome).not.toBeNull();
  });

  it('arena weapons: fights end', () => {
    const sim = run('arena', 4, 11, 240);
    expect(sim.outcome).not.toBeNull();
  });
});

describe('guards', () => {
  it('object cap holds under runaway duplication', () => {
    const d = generate(MODES.find((m) => m.id === 'mitosis')!, 0, 1).def;
    d.settings.maxObjects = 200;
    const sim = new Sim(d);
    for (let s = 0; s < 120 * 40; s++) sim.step();
    expect(sim.world.aliveCount).toBeLessThanOrEqual(200);
  });
});
