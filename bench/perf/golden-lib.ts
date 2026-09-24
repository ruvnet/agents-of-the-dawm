/**
 * Golden determinism fixture (W7.PERF.01). Drives fullPlan(route) with seed 1047 through the real
 * simulation and records: final hash, the hash + cumulative event count at every tick that emitted
 * CheckpointReached, the event-log hash, the command-stream hash and a rolling hash over EVERY
 * tick's canonical state hash. Any behaviour change in src/sim shows up here.
 */
import { loadSector01 } from '../../src/contracts/fixtures';
import { canonicalHash, fnv1a64 } from '../../src/contracts/hash';
import { createSimulation } from '../../src/sim';
import { createAutopilot, fullPlan } from '../../src/sim/autopilot';

export interface GoldenRoute {
  seed: number;
  ticks: number;
  finalHash: string;
  eventCount: number;
  eventLogHash: string;
  commandsHash: string;
  perTickChain: string;
  checkpoints: { tick: number; key: string; hash: string; eventCount: number }[];
}

export function goldenRoute(route: 'upper' | 'lower', seed = 1047): GoldenRoute {
  const m = loadSector01();
  const sim = createSimulation(m, { seed });
  const pilot = createAutopilot(m, fullPlan(route));
  const checkpoints: GoldenRoute['checkpoints'] = [];
  const cmds: unknown[] = [];
  let chain = fnv1a64('start');
  while (!pilot.done) {
    const c = pilot.next(sim.state());
    if (!c) break;
    const events = sim.step(c);
    cmds.push(c);
    chain = fnv1a64(chain + sim.hash());
    for (const e of events) {
      if (e.type === 'CheckpointReached') {
        checkpoints.push({ tick: sim.state().tick, key: e.key, hash: sim.hash(), eventCount: sim.eventLog().length });
      }
    }
    if (cmds.length > 60 * 60 * 20) throw new Error('budget');
  }
  return {
    seed,
    ticks: sim.state().tick,
    finalHash: sim.hash(),
    eventCount: sim.eventLog().length,
    eventLogHash: canonicalHash(sim.eventLog()),
    commandsHash: canonicalHash(cmds),
    perTickChain: chain,
    checkpoints,
  };
}
