import { describe, expect, it } from 'vitest';
import { dialogueEn } from '../../src/contracts/fixtures';
import { BEATS, validatePreviews } from '../../src/contracts';
import type { WorldEvent } from '../../src/contracts';
import { fullPlan, PLAN_OPENING, PLAN_UPPER, planArena } from '../../src/sim/autopilot';
import { newSim, runPlan, step } from './helpers';

const cueKeys = (log: readonly WorldEvent[]) => log.filter((e) => e.type === 'DialogueCue').map((e) => e.key);
const types = (log: readonly WorldEvent[]) => log.map((e) => e.type);

function expectedCues(route: 'upper' | 'lower'): string[] {
  const other = route === 'upper' ? 'lower' : 'upper';
  return [...new Set(dialogueEn.lines
    .filter((l) => l.branch !== other)
    .map((l) => l.trigger.replace(/^DialogueCue:/, '')))];
}

describe.each(['upper', 'lower'] as const)('full scripted playthrough (%s route)', (route) => {
  const sim = newSim(1047);
  const commands = runPlan(sim, fullPlan(route));
  const log = sim.eventLog();
  const s = sim.state();

  it('reaches the tram crossing with every predicate true', () => {
    expect(s.flags).toEqual({
      channelLocated: true, channelSensorVerified: true, channelEdgeRestored: true,
      playerAuthorized: true, capacitySafe: true, gateOpen: true,
    });
    expect(s.tramCrossed).toBe(true);
    expect(s.branch).toBe(route);
    expect(s.keeper.phase).toBe(4);
    expect(s.keeper.sealsRemaining).toBe(0);
    expect(commands.length).toBeLessThan(60 * 60 * 5); // whole route in a few minutes at ~6 m/s
  });

  it('visits every beat of its route and emits the story events once, in order', () => {
    const beats = log.filter((e) => e.type === 'BeatEntered').map((e) => e.key);
    const skipped = route === 'upper' ? 'lower-conduit' : 'upper-lattice';
    for (const b of BEATS) if (b !== skipped && b !== 'west-approach') expect(beats).toContain(b);
    expect(beats).not.toContain(skipped);
    const order = ['ChannelLocated', 'KeeperDisabled', 'PanelOpened', 'SensorVerified', 'EdgeRestored', 'TransferAuthorized', 'GateOpened', 'TramCrossed'];
    const idx = order.map((t) => types(log).indexOf(t as WorldEvent['type']));
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    for (const t of ['GateOpened', 'TransferAuthorized', 'TramCrossed', 'ChannelLocated', 'SensorVerified', 'EdgeRestored', 'KeeperDisabled'] as const) {
      expect(types(log).filter((x) => x === t)).toHaveLength(1);
    }
    expect(types(log).filter((t) => t === 'SealBroken')).toHaveLength(3);
    expect(log.filter((e) => e.type === 'RouteChosen').map((e) => e.key)).toEqual([route]);
  });

  it('fires every scripted dialogue cue of this route exactly once', () => {
    const cues = cueKeys(log);
    expect(new Set(cues).size).toBe(cues.length);
    expect([...cues].sort()).toEqual(expectedCues(route).sort());
  });

  it('event ids are unique and stable', () => {
    const ids = log.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of log) expect(e.id).toBe(`${e.type}:${e.tick}:${e.key}`);
  });

  it('final pressure view has three valid previews derived by the sim', () => {
    const v = sim.pressureView();
    expect(validatePreviews(v.previews)).toEqual([]);
    const byDest = Object.fromEntries(v.previews.map((p) => [p.destination, p]));
    expect(byDest['occupied-street']!.safe).toBe(false);
    expect(byDest['protected-pump']!.safe).toBe(false);
    expect(byDest['relief-channel']!.safe).toBe(true);
    expect(byDest['relief-channel']!.reason).toBe(sim.manifest.pressure.reasons['reason.relief.safe']);
    const verified = log.find((e) => e.type === 'SensorVerified')!;
    expect(byDest['relief-channel']!.evidenceSource).toEqual({ origin: 'authored-simulation', fixtureId: sim.manifest.pressure.fixtureId, eventId: verified.id });
    expect(v.routes.find((r) => r.id === 'reservoir-to-relief')!.approved).toBe(true);
    expect(v.routes.find((r) => r.id === 'reservoir-to-street')!.approved).toBe(false);
    expect(v.capacityChecks).toEqual({ pumpWithinTolerance: true, streetUnoccupiedByFlow: true, reliefWithinTolerance: true });
  });

  it('route reward is applied: overdrive on upper, 30 s surges on lower', () => {
    if (route === 'upper') {
      expect(log.some((e) => e.type === 'SealExposed' && e.payload.cause === 'overdrive')).toBe(true);
      expect(s.keeper.surgeIntervalTicks).toBe(1200);
    } else {
      expect(s.keeper.surgeIntervalTicks).toBe(1800);
      expect(s.player.overdrive).toBe(0);
    }
  });
});

describe('failure trace (ADR 0004)', () => {
  it('authorize before scan is rejected; the same save then completes', () => {
    const sim = newSim(7);
    runPlan(sim, [...PLAN_OPENING, ...PLAN_UPPER, ...planArena(true)]);
    expect(step(sim, { control: { kind: 'open-panel' } }).map((e) => e.type)).toContain('PanelOpened');
    const early = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(early.find((e) => e.type === 'TransferRejected')?.payload.reasonKey).toBe('reason.relief.unverified');
    const street = step(sim, { control: { kind: 'authorize', destination: 'occupied-street' } });
    expect(street.find((e) => e.type === 'TransferRejected')?.payload.reasonKey).toBe('reason.street.occupied');
    const restoreEarly = step(sim, { control: { kind: 'restore-edge' } });
    expect(restoreEarly.find((e) => e.type === 'TransferRejected')?.payload.reasonKey).toBe('reason.relief.unverified');
    expect(sim.state().flags.gateOpen).toBe(false);
    expect(sim.state().pressure.routes.find((r) => r.id === 'reservoir-to-relief')!.approved).toBe(false);
    step(sim, { control: { kind: 'scan-sensor' } });
    const noRestore = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(noRestore.find((e) => e.type === 'TransferRejected')?.payload.reasonKey).toBe('reason.relief.unrestored');
    step(sim, { control: { kind: 'restore-edge' } });
    const noPreview = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(noPreview.find((e) => e.type === 'TransferRejected')?.payload.reasonKey).toBe('reason.preview.incomplete');
    for (const d of ['occupied-street', 'protected-pump', 'relief-channel'] as const) step(sim, { control: { kind: 'preview', destination: d } });
    const ok = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(ok.map((e) => e.type)).toEqual(expect.arrayContaining(['TransferAuthorized', 'GateOpened']));
    const again = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
    expect(again.map((e) => e.type)).not.toContain('GateOpened');
    for (let i = 0; i < 200; i++) step(sim);
    expect(sim.state().tramCrossed).toBe(true);
  });
});
