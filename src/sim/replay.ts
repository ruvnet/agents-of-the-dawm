/**
 * Replay recording/verification (ADR 0004): initial versioned state + seed + per-tick commands,
 * with a canonical state hash captured at every CheckpointReached. Also provides the fixed-step
 * accumulator driver used by render loops, so G02 can prove render FPS never changes results.
 */
import type { InputCommand } from '../contracts/input';
import { idle } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import type { Replay, SimOptions, Simulation, WorldEvent } from '../contracts/sim';
import { MAX_CATCHUP_TICKS, TICK_MS } from '../contracts/sim';
import { createSimulation } from './index';

function recordCheckpoints(sim: Simulation, events: readonly WorldEvent[], into: Record<string, string>): void {
  if (events.some((e) => e.type === 'CheckpointReached')) into[String(sim.state().tick)] = sim.hash();
}

/** Run `commands` from a fresh simulation and capture the replay with checkpoint hashes. */
export function recordReplay(manifest: LevelManifest, options: SimOptions, commands: readonly InputCommand[]): Replay {
  const sim = createSimulation(manifest, options);
  const initialStateHash = sim.hash();
  const checkpoints: Record<string, string> = {};
  for (const c of commands) recordCheckpoints(sim, sim.step(c), checkpoints);
  checkpoints['final'] = sim.hash();
  return { version: 1, manifestId: manifest.id, seed: options.seed, initialStateHash, commands: [...commands], checkpoints };
}

export interface ReplayVerification {
  ok: boolean;
  mismatches: string[];
  finalHash: string;
}

/** Re-run a replay from scratch and compare every checkpoint hash. */
export function verifyReplay(manifest: LevelManifest, replay: Replay, options?: Partial<SimOptions>): ReplayVerification {
  const mismatches: string[] = [];
  if (replay.version !== 1) mismatches.push('unsupported replay version');
  if (replay.manifestId !== manifest.id) mismatches.push(`manifest ${replay.manifestId} != ${manifest.id}`);
  const sim = createSimulation(manifest, { ...options, seed: replay.seed });
  if (sim.hash() !== replay.initialStateHash) mismatches.push('initial state hash differs');
  const seen: Record<string, string> = {};
  for (const c of replay.commands) {
    const before = sim.state().tick;
    const events = sim.step(c);
    if (sim.state().tick !== before + 1) mismatches.push(`command rejected at tick ${c.tick}`);
    else recordCheckpoints(sim, events, seen);
  }
  seen['final'] = sim.hash();
  for (const [k, h] of Object.entries(replay.checkpoints)) if (seen[k] !== h) mismatches.push(`checkpoint ${k}: ${seen[k] ?? 'missing'} != ${h}`);
  for (const k of Object.keys(seen)) if (!(k in replay.checkpoints)) mismatches.push(`unexpected checkpoint ${k}`);
  return { ok: mismatches.length === 0, mismatches, finalHash: seen['final']! };
}

export interface FrameDriverResult {
  frames: number;
  checkpoints: Record<string, string>;
  finalHash: string;
}

/**
 * Feed a tick-indexed command stream through a render-style accumulator at `fps`, with the
 * MAX_CATCHUP_TICKS clamp. Frame time is simulated integer microseconds, never a wall clock.
 * Ticks without a recorded command receive an idle command.
 */
export function driveAtFps(manifest: LevelManifest, options: SimOptions, commands: readonly InputCommand[], fps: number): FrameDriverResult {
  const sim = createSimulation(manifest, options);
  const byTick = new Map<number, InputCommand>();
  for (const c of commands) byTick.set(c.tick, c);
  const lastTick = commands.length ? commands[commands.length - 1]!.tick : -1;
  const frameUs = Math.round(1e6 / fps);
  const tickUs = Math.round(TICK_MS * 1000);
  const checkpoints: Record<string, string> = {};
  let acc = 0;
  let frames = 0;
  while (sim.state().tick <= lastTick) {
    frames += 1;
    acc += frameUs;
    let steps = 0;
    while (acc >= tickUs && steps < MAX_CATCHUP_TICKS && sim.state().tick <= lastTick) {
      const t = sim.state().tick;
      recordCheckpoints(sim, sim.step(byTick.get(t) ?? idle(t)), checkpoints);
      acc -= tickUs;
      steps += 1;
    }
    if (steps === MAX_CATCHUP_TICKS) acc = Math.min(acc, tickUs);
    if (frames > 10_000_000) throw new Error('driveAtFps: runaway');
  }
  checkpoints['final'] = sim.hash();
  return { frames, checkpoints, finalHash: sim.hash() };
}
