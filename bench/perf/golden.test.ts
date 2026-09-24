import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import { IDLE_COMMAND } from '../../src/contracts/input';
import { createSimulation } from '../../src/sim';
import { createAutopilot, fullPlan } from '../../src/sim/autopilot';
import { clonePlain } from '../../src/sim/clone';
import { goldenRoute } from './golden-lib';

const FILE = new URL('./golden-hashes.json', import.meta.url);

describe('W7.PERF golden determinism', () => {
  it('upper + lower full playthroughs match the pre-optimisation golden hashes byte-for-byte', () => {
    const now = { upper: goldenRoute('upper'), lower: goldenRoute('lower') };
    const text = `${JSON.stringify(now, null, 2)}\n`;
    if (process.env.GOLDEN_WRITE === '1') writeFileSync(FILE, text);
    expect(text).toBe(readFileSync(FILE, 'utf8'));
  });

  it('every state handed out during a full playthrough is never mutated later', () => {
    const m = loadSector01();
    const sim = createSimulation(m, { seed: 1047 });
    const pilot = createAutopilot(m, fullPlan('lower'));
    const kept: { s: unknown; json: string }[] = [];
    let n = 0;
    while (!pilot.done) {
      const s = sim.state();
      if (n % 37 === 0) kept.push({ s, json: JSON.stringify(s) });
      const c = pilot.next(s);
      if (!c) break;
      sim.step(c);
      n += 1;
    }
    // Retry and restore paths as well.
    kept.push({ s: sim.state(), json: JSON.stringify(sim.state()) });
    sim.restartFromCheckpoint();
    const snap = sim.snapshot();
    kept.push({ s: sim.state(), json: JSON.stringify(sim.state()) });
    for (let i = 0; i < 20; i++) sim.step({ ...IDLE_COMMAND, tick: sim.state().tick, move2: [1, 1], pulse: true });
    sim.restore(snap);
    kept.push({ s: sim.state(), json: JSON.stringify(sim.state()) });
    for (let i = 0; i < 20; i++) sim.step({ ...IDLE_COMMAND, tick: sim.state().tick, move2: [-1, 1], spike: true });
    for (const k of kept) expect(JSON.stringify(k.s)).toBe(k.json);
    expect(kept.length).toBeGreaterThan(80);
  });

  it('consecutive committed states share no object or array at any depth (both routes)', () => {
    const containers = (v: unknown, out: Set<object>): Set<object> => {
      if (typeof v === 'object' && v !== null) {
        out.add(v);
        for (const x of Array.isArray(v) ? v : Object.values(v)) containers(x, out);
      }
      return out;
    };
    const m = loadSector01();
    for (const route of ['upper', 'lower'] as const) {
      const sim = createSimulation(m, { seed: 1047 });
      const pilot = createAutopilot(m, fullPlan(route));
      let n = 0;
      while (!pilot.done) {
        const before = sim.state();
        const c = pilot.next(before);
        if (!c) break;
        sim.step(c);
        if (n++ % 53 === 0) {
          const a = containers(before, new Set());
          for (const o of containers(sim.state(), new Set())) expect(a.has(o)).toBe(false);
          expect(JSON.stringify(clonePlain(sim.state()))).toBe(JSON.stringify(structuredClone(sim.state())));
        }
      }
      const b = sim.state();
      sim.restartFromCheckpoint();
      const a = containers(b, new Set());
      for (const o of containers(sim.state(), new Set())) expect(a.has(o)).toBe(false);
    }
  });
});
