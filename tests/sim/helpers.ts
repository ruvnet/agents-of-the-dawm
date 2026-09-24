import { loadSector01 } from '../../src/contracts/fixtures';
import type { InputCommand, LevelManifest, SimState, Simulation, WorldEvent } from '../../src/contracts';
import { IDLE_COMMAND } from '../../src/contracts';
import { createSimulation } from '../../src/sim';
import { isGrounded } from '../../src/sim/state';

export const manifest: LevelManifest = loadSector01();

export function newSim(seed = 1047, m: LevelManifest = manifest, assist?: Partial<SimState['assist']>): Simulation {
  return createSimulation(m, { seed, assist });
}

export function cmd(tick: number, over: Partial<InputCommand> = {}): InputCommand {
  return { tick, ...IDLE_COMMAND, ...over };
}

/** Step once with the given overrides at the current tick. */
export function step(sim: Simulation, over: Partial<InputCommand> = {}): readonly WorldEvent[] {
  return sim.step(cmd(sim.state().tick, over));
}

export function idleTicks(sim: Simulation, n: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...step(sim));
  return out;
}

/** Test-only teleport via the public snapshot/restore API. */
export function mutate(sim: Simulation, fn: (s: SimState) => void): void {
  const snap = sim.snapshot();
  const s = structuredClone(snap.state);
  fn(s);
  s.player.grounded = isGrounded(sim.manifest, s);
  sim.restore({ ...snap, state: s });
}

import { createAutopilot, drive } from '../../src/sim/autopilot';
import type { BotStep } from '../../src/sim/autopilot';

/** Drive `sim` through `plan` with the reusable autopilot; returns the issued commands. */
export function runPlan(sim: Simulation, plan: readonly BotStep[]): InputCommand[] {
  return drive(sim, createAutopilot(sim.manifest, plan));
}
