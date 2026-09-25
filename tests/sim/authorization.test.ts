import { describe, expect, it } from 'vitest';
import type { ControlAction, InputCommand, SimSnapshot, SimState, Simulation } from '../../src/contracts';
import { DESTINATIONS, validatePreviews } from '../../src/contracts';
import { PLAN_OPENING, PLAN_UPPER, planArena } from '../../src/sim/autopilot';
import { mutate, newSim, runPlan, step } from './helpers';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIONS: (ControlAction | null)[] = [
  null,
  { kind: 'open-panel' }, { kind: 'close-panel' }, { kind: 'scan-sensor' }, { kind: 'restore-edge' },
  ...DESTINATIONS.map((d) => ({ kind: 'preview', destination: d }) as ControlAction),
  ...DESTINATIONS.map((d) => ({ kind: 'authorize', destination: d }) as ControlAction),
  { kind: 'authorize', destination: 'relief-channel' }, { kind: 'authorize', destination: 'relief-channel' },
];

const GOOD: ControlAction[] = [
  { kind: 'open-panel' }, { kind: 'scan-sensor' },
  ...DESTINATIONS.map((d) => ({ kind: 'preview', destination: d }) as ControlAction),
  { kind: 'restore-edge' }, { kind: 'authorize', destination: 'relief-channel' },
];

function checkInvariant(s: Readonly<SimState>): void {
  const f = s.flags;
  if (f.gateOpen) {
    expect(f.channelLocated && f.channelSensorVerified && f.channelEdgeRestored && f.playerAuthorized && f.capacitySafe).toBe(true);
    expect(s.pressure.capacityChecks.pumpWithinTolerance && s.pressure.capacityChecks.streetUnoccupiedByFlow).toBe(true);
    expect(s.pressure.selectedDestination).toBe('relief-channel');
  }
  if (f.playerAuthorized) expect(f.gateOpen).toBe(true);
  const relief = s.pressure.routes.find((r) => r.id === 'reservoir-to-relief')!;
  if (relief.approved) expect(f.channelLocated && f.channelSensorVerified).toBe(true);
  expect(relief.approved).toBe(f.channelEdgeRestored);
  // unsafe destinations never become approved routes; the pump route is untouched
  expect(s.pressure.routes.find((r) => r.id === 'reservoir-to-street')!.approved).toBe(false);
  expect(s.pressure.routes.find((r) => r.id === 'reservoir-to-pump')!.approved).toBe(true);
}

interface Start { name: string; snap: SimSnapshot }

describe('G04 authorization property (seeded fuzz)', () => {
  const base = newSim(1047);
  runPlan(base, [...PLAN_OPENING, ...PLAN_UPPER, ...planArena(true)]);
  const atScreen = base.snapshot();
  const variant = (fn: (s: SimState) => void): SimSnapshot => {
    const sim = newSim(1047);
    sim.restore(atScreen);
    mutate(sim, fn);
    return sim.snapshot();
  };
  const starts: Start[] = [
    { name: 'ready', snap: atScreen },
    { name: 'unlocated', snap: variant((s) => { s.flags.channelLocated = false; }) },
    { name: 'keeper-active', snap: variant((s) => { s.keeper.phase = 3; s.keeper.sealsRemaining = 1; }) },
    { name: 'away-from-screen', snap: variant((s) => { s.player.pos = [110.5, 14, 0.5]; }) },
  ];

  it('holds across 2000+ random control sequences with duplicates and random order', () => {
    const rand = mulberry32(20260924);
    let opened = 0;
    const sim: Simulation = newSim(1047);
    for (let seq = 0; seq < 2400; seq++) {
      const start = starts[seq % starts.length]!;
      sim.restore(start.snap);
      const len = 1 + Math.floor(rand() * 16);
      const plan: (ControlAction | null)[] = [];
      if (seq % 3 === 0) {
        // guided: the successful order with random noise, duplicates and reorderings interleaved
        for (const a of GOOD) {
          while (rand() < 0.35) plan.push(ACTIONS[Math.floor(rand() * ACTIONS.length)]!);
          plan.push(a);
          if (rand() < 0.2) plan.push(a);
        }
        if (rand() < 0.3) { const i = Math.floor(rand() * plan.length); const j = Math.floor(rand() * plan.length); [plan[i], plan[j]] = [plan[j]!, plan[i]!]; }
      } else for (let i = 0; i < len; i++) plan.push(ACTIONS[Math.floor(rand() * ACTIONS.length)]!);
      let gateEvents = 0;
      let wasOpen = false;
      for (const action of plan) {
        const over: { -readonly [K in keyof InputCommand]?: InputCommand[K] } = { control: action };
        if (rand() < 0.1) over.interact = true;
        if (rand() < 0.05) over.move2 = [rand() * 2 - 1, rand() * 2 - 1];
        const ev = step(sim, over);
        gateEvents += ev.filter((e) => e.type === 'GateOpened').length;
        const s = sim.state();
        checkInvariant(s);
        if (wasOpen) expect(s.flags.gateOpen).toBe(true);
        wasOpen = s.flags.gateOpen;
        if (action?.kind === 'authorize' && action.destination !== 'relief-channel') {
          expect(ev.some((e) => e.type === 'GateOpened' || e.type === 'TransferAuthorized')).toBe(false);
        }
        expect(validatePreviews(sim.pressureView().previews)).toEqual([]);
      }
      expect(gateEvents).toBeLessThanOrEqual(1);
      if (start.name !== 'ready') expect(sim.state().flags.gateOpen).toBe(false);
      if (sim.state().flags.gateOpen) opened += 1;
    }
    // the fuzz must actually reach the success state sometimes, or it proves nothing
    expect(opened).toBeGreaterThan(0);
  });

  it('GateOpened is emitted at most once even after checkpoint restarts', () => {
    const sim = newSim(1047);
    sim.restore(atScreen);
    step(sim, { control: { kind: 'open-panel' } });
    step(sim, { control: { kind: 'scan-sensor' } });
    for (const d of DESTINATIONS) step(sim, { control: { kind: 'preview', destination: d } });
    step(sim, { control: { kind: 'restore-edge' } });
    step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    sim.restartFromCheckpoint();
    step(sim, { control: { kind: 'open-panel' } });
    step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(sim.eventLog().filter((e) => e.type === 'GateOpened')).toHaveLength(1);
    checkInvariant(sim.state());
  });

  it('pressure view reasons track unlocated / unverified / unrestored / safe', () => {
    const reasons = newSim().manifest.pressure.reasons;
    const relief = (sim: Simulation) => sim.pressureView().previews.find((p) => p.destination === 'relief-channel')!;
    const sim = newSim(1047);
    sim.restore(starts[1]!.snap);
    expect(relief(sim).reason).toBe(reasons['reason.relief.unlocated']);
    expect(relief(sim).safe).toBe(false);
    sim.restore(atScreen);
    expect(relief(sim).reason).toBe(reasons['reason.relief.unverified']);
    expect(relief(sim).evidenceSource.eventId).toBeUndefined();
    step(sim, { control: { kind: 'open-panel' } });
    step(sim, { control: { kind: 'scan-sensor' } });
    expect(relief(sim).reason).toBe(reasons['reason.relief.unrestored']);
    expect(relief(sim).evidenceSource.eventId).toMatch(/^SensorVerified:\d+:relief-sensor$/);
    step(sim, { control: { kind: 'restore-edge' } });
    expect(relief(sim).reason).toBe(reasons['reason.relief.safe']);
    expect(relief(sim).safe).toBe(true);
    const v = sim.pressureView();
    expect(v.previews.find((p) => p.destination === 'occupied-street')!.reason).toBe(reasons['reason.street.occupied']);
    expect(v.previews.find((p) => p.destination === 'protected-pump')!.reason).toBe(reasons['reason.pump.overload']);
    expect(v.previews.every((p) => p.evidenceSource.fixtureId === sim.manifest.pressure.fixtureId)).toBe(true);
  });
});
