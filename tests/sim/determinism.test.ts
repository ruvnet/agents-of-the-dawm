import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../../src/contracts';
import { fullPlan } from '../../src/sim/autopilot';
import { driveAtFps, recordReplay, verifyReplay } from '../../src/sim/replay';
import { cmd, manifest, newSim, runPlan, step } from './helpers';

const SEED = 1047;

function withPauses(commands: readonly InputCommand[]): InputCommand[] {
  // Insert a 45-tick pause every 700 ticks; ticks keep advancing while paused.
  const out: InputCommand[] = [];
  let t = 0;
  for (const c of commands) {
    if (c.tick > 0 && c.tick % 700 === 0) for (let i = 0; i < 45; i++) out.push(cmd(t++, { pause: true, move2: [1, 1] }));
    out.push({ ...c, tick: t++ });
  }
  return out;
}

describe('G02 seeded replay determinism', () => {
  const recorded = runPlan(newSim(SEED), fullPlan('upper'));
  const replay = recordReplay(manifest, { seed: SEED }, recorded);

  it('replay captures a hash at every checkpoint and re-verifies', () => {
    expect(Object.keys(replay.checkpoints).length).toBeGreaterThan(12);
    const v = verifyReplay(manifest, replay);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('30, 60 and 120 FPS accumulator drivers yield identical checkpoint hashes', () => {
    const runs = [30, 60, 120].map((fps) => driveAtFps(manifest, { seed: SEED }, recorded, fps));
    for (const r of runs) expect(r.checkpoints).toEqual(replay.checkpoints);
    expect(runs[0]!.frames).toBeLessThan(runs[2]!.frames);
  });

  it('re-running the whole autopilot is bit-identical, and a different seed still completes', () => {
    const again = newSim(SEED);
    runPlan(again, fullPlan('upper'));
    expect(again.hash()).toBe(replay.checkpoints['final']);
    const other = newSim(99);
    runPlan(other, fullPlan('upper'));
    expect(other.state().flags.gateOpen).toBe(true);
  });

  it('a tampered replay is detected', () => {
    const tampered = { ...replay, commands: replay.commands.map((c, i) => (i === 500 ? { ...c, move2: [0, 0] as const } : c)) };
    expect(verifyReplay(manifest, tampered).ok).toBe(false);
  });

  it('paused ticks advance the tick but no game action', () => {
    const paused = withPauses(recorded);
    const a = driveAtFps(manifest, { seed: SEED }, paused, 60);
    const b = driveAtFps(manifest, { seed: SEED }, paused, 30);
    expect(a.checkpoints).toEqual(b.checkpoints);
    const sim = newSim(SEED);
    const before = structuredClone(sim.state());
    for (let i = 0; i < 90; i++) expect(step(sim, { pause: true, move2: [1, 1], jump: true, pulse: true })).toEqual([]);
    const after = sim.state();
    expect(after.tick).toBe(90);
    expect({ ...after, tick: 0, paused: false }).toEqual({ ...before, paused: false });
  });
});

describe('tick contract and snapshots', () => {
  it('rejects commands whose tick is not the current tick', () => {
    const sim = newSim();
    expect(sim.step(cmd(5, { move2: [0, 1] }))).toEqual([]);
    expect(sim.state().tick).toBe(0);
    step(sim, { move2: [0, 1] });
    expect(sim.step(cmd(0, { move2: [0, 1] }))).toEqual([]);
    expect(sim.state().tick).toBe(1);
  });

  it('sanitizes out-of-range and non-finite input', () => {
    const sim = newSim();
    const bad = { move2: [Number.NaN, 50], look2: [99, Number.POSITIVE_INFINITY], control: { kind: 'authorize', destination: 'moon' } } as unknown as Partial<InputCommand>;
    for (let i = 0; i < 30; i++) step(sim, bad);
    const p = sim.state().player;
    expect(p.pos.every(Number.isFinite)).toBe(true);
    expect(Math.abs(p.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(() => sim.hash()).not.toThrow();
  });

  it('snapshot/restore round-trips deep copies and truncates the event log', () => {
    const sim = newSim();
    for (let i = 0; i < 20; i++) step(sim, { move2: [0, 1] });
    const snap = sim.snapshot();
    const h = sim.hash();
    const n = sim.eventLog().length;
    for (let i = 0; i < 200; i++) step(sim, { move2: [0, 1] });
    expect(sim.hash()).not.toBe(h);
    sim.restore(snap);
    expect(sim.hash()).toBe(h);
    expect(sim.eventLog()).toHaveLength(n);
    (snap.state.player.pos as unknown as number[])[0] = 999;
    expect(sim.state().player.pos[0]).not.toBe(999);
  });

  it('state objects handed out are never mutated by later steps', () => {
    const sim = newSim();
    const s0 = sim.state();
    const h0 = JSON.stringify(s0);
    for (let i = 0; i < 30; i++) step(sim, { move2: [0, 1] });
    expect(JSON.stringify(s0)).toBe(h0);
  });
});
