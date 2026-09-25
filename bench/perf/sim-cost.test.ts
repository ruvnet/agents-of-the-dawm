/**
 * Simulation CPU cost per tick in node (W7.PERF.01 baseline 2a). Only runs when PERF_OUT is set:
 *   PERF_OUT=bench/perf/results/sim-before.json npx vitest run --config bench/perf/vitest.config.ts sim-cost
 * The autopilot commands are recorded once, then only `sim.step` is timed (hrtime.bigint per tick)
 * over both full playthroughs, RUNS times after WARMUP untimed runs.
 */
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { describe, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import type { InputCommand } from '../../src/contracts/input';
import { canonicalHash } from '../../src/contracts/hash';
import { createSimulation } from '../../src/sim';
import { createAutopilot, drive, fullPlan } from '../../src/sim/autopilot';

const OUT = process.env.PERF_OUT;
const RUNS = Number(process.env.PERF_RUNS ?? 20);
const WARMUP = 5;

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

describe.skipIf(!OUT)('sim cost per tick', () => {
  it('measures ns/tick over both playthroughs', () => {
    const m = loadSector01();
    const routes = (['upper', 'lower'] as const).map((r) => {
      const sim = createSimulation(m, { seed: 1047 });
      return { route: r, cmds: drive(sim, createAutopilot(m, fullPlan(r))) as InputCommand[] };
    });
    const samples: number[] = [];
    const runTotalsMs: number[] = [];
    let cloneNs = 0;
    let cloneN = 0;
    for (let run = 0; run < WARMUP + RUNS; run++) {
      let total = 0n;
      for (const { cmds } of routes) {
        const sim = createSimulation(m, { seed: 1047 });
        for (const c of cmds) {
          const t0 = process.hrtime.bigint();
          sim.step(c);
          const dt = process.hrtime.bigint() - t0;
          total += dt;
          if (run >= WARMUP) samples.push(Number(dt));
        }
        if (run >= WARMUP) {
          // Isolated cost of one full-state structuredClone of the final state.
          const s = sim.state();
          const t0 = process.hrtime.bigint();
          for (let i = 0; i < 200; i++) structuredClone(s);
          cloneNs += Number(process.hrtime.bigint() - t0);
          cloneN += 200;
        }
      }
      if (run >= WARMUP) runTotalsMs.push(Number(total) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const ticksPerRun = routes.reduce((a, r) => a + r.cmds.length, 0);
    const result = {
      env: { cpu: cpus()[0]?.model, node: process.version, runs: RUNS, warmup: WARMUP, ticksPerRun },
      nsPerTick: { mean: Math.round(mean), p50: pct(samples, 50), p95: pct(samples, 95), p99: pct(samples, 99), max: samples[samples.length - 1] },
      runTotalMs: { min: Math.min(...runTotalsMs), median: [...runTotalsMs].sort((a, b) => a - b)[Math.floor(runTotalsMs.length / 2)] },
      structuredCloneFinalStateNs: Math.round(cloneNs / cloneN),
      finalStateBytesJson: JSON.stringify(createSimulation(m, { seed: 1047 }).state()).length,
      commandsHash: canonicalHash(routes.map((r) => r.cmds.length)),
    };
    writeFileSync(OUT!, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  });
});
