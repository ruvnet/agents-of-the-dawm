/**
 * Headless Node reference for the seeded demo route: the same W1 autopilot plan the browser demo
 * uses (src/app/autopilot-input.ts), stepped directly on the simulation with no renderer, clock or
 * DOM. The browser runs must reproduce these per-tick hashes exactly (R03 / G02 evidence).
 */
import { idle } from '../../src/contracts/input';
import { createSimulation } from '../../src/sim';
import { createAutopilot, fullPlan } from '../../src/sim/autopilot';
import { HASH_EVERY, loadManifestNode } from './helpers';

export interface ReferenceRun {
  route: 'upper' | 'lower';
  seed: number;
  planDoneTick: number;
  tramTick: number | null;
  hashes: Record<string, string>;
  keyEventIds: string[];
  finalTick: number;
  finalHash: string;
}

const KEY = new Set(['CheckpointReached', 'GateOpened', 'TramCrossed']);

export function referenceRun(route: 'upper' | 'lower', untilTick: number, seed = 1047): ReferenceRun {
  const m = loadManifestNode();
  const sim = createSimulation(m, { seed });
  const pilot = createAutopilot(m, fullPlan(route));
  const hashes: Record<string, string> = {};
  const keyEventIds: string[] = [];
  let planDoneTick = -1;
  let tramTick: number | null = null;
  while (sim.state().tick < untilTick) {
    const s = sim.state();
    let cmd = pilot.done ? null : pilot.next(s);
    if (!cmd) { if (planDoneTick < 0) planDoneTick = s.tick; cmd = idle(s.tick); }
    const ev = sim.step({ ...cmd, tick: s.tick });
    const t = sim.state().tick;
    if (t % HASH_EVERY === 0 || ev.some((e) => KEY.has(e.type))) hashes[String(t)] = sim.hash();
    for (const e of ev) {
      if (KEY.has(e.type)) keyEventIds.push(e.id);
      if (e.type === 'TramCrossed') tramTick = e.tick;
    }
  }
  return { route, seed, planDoneTick, tramTick, hashes, keyEventIds, finalTick: sim.state().tick, finalHash: sim.hash() };
}

/** Compare browser-observed hashes with the reference over their common ticks. */
export function compareHashes(observed: Record<string, string>, ref: Record<string, string>): {
  commonTicks: number; mismatches: { tick: string; observed: string; reference: string }[]; lastCommonTick: number | null;
} {
  const mismatches: { tick: string; observed: string; reference: string }[] = [];
  let common = 0;
  let last: number | null = null;
  for (const [tick, h] of Object.entries(observed)) {
    const r = ref[tick];
    if (r === undefined) continue;
    common += 1;
    last = Math.max(last ?? 0, Number(tick));
    if (r !== h) mismatches.push({ tick, observed: h, reference: r });
  }
  return { commonTicks: common, mismatches, lastCommonTick: last };
}
