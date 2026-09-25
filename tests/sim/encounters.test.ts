import { describe, expect, it } from 'vitest';
import type { SimState, WorldEvent } from '../../src/contracts';
import { PLAYER_MAX_HEALTH } from '../../src/contracts';
import { RULES } from '../../src/sim';
import { fullPlan, PLAN_LOWER, PLAN_OPENING, PLAN_UPPER } from '../../src/sim/autopilot';
import { idleTicks, mutate, newSim, runPlan, step } from './helpers';

const ofType = (log: readonly WorldEvent[], t: WorldEvent['type']) => log.filter((e) => e.type === t);

function arenaSim(route: 'upper' | 'lower') {
  const sim = newSim(1047);
  runPlan(sim, [...PLAN_OPENING, ...(route === 'upper' ? PLAN_UPPER : PLAN_LOWER), { kind: 'goto', to: [110.5, 14, 0.5] }]);
  expect(sim.state().keeper.phase).toBe(1);
  return sim;
}

describe('keeper encounter', () => {
  it('surges every 20 s with a 3 s telegraph (30 s after the lower route valves)', () => {
    for (const [route, interval] of [['upper', 1200], ['lower', 1800]] as const) {
      const sim = arenaSim(route);
      const t0 = sim.state().tick;
      const log = idleTicks(sim, interval * 2 + 10);
      const tele = ofType(log, 'SurgeTelegraph').map((e) => e.tick - t0);
      const surge = ofType(log, 'Surge').map((e) => e.tick - t0);
      expect(surge).toHaveLength(2);
      expect(surge[1]! - surge[0]!).toBe(interval);
      expect(tele.map((t, i) => surge[i]! - t)).toEqual([180, 180]);
      expect(sim.state().player.health).toBe(PLAYER_MAX_HEALTH - 2 * RULES.keeper.surgeDamage);
    }
  });

  it('zero health restarts the current phase with full health, standard charge and retained seals', () => {
    const sim = arenaSim('lower');
    runPlan(sim, [{ kind: 'goto', to: [115, 14, -6] }, { kind: 'shift', anchor: 'anchor-keeper-left' }]);
    step(sim, { spike: true });
    expect(sim.state().keeper.phase).toBe(2);
    mutate(sim, (s) => { s.player.health = 5; s.player.charge = 0; s.keeper.surgeTimerTicks = 2; s.player.pos = [110, 14, 5]; });
    const log = idleTicks(sim, 3);
    expect(ofType(log, 'PlayerDefeated')).toHaveLength(1);
    const s = sim.state();
    expect(s.player.health).toBe(PLAYER_MAX_HEALTH);
    expect(s.player.charge).toBe(RULES.standardCharge);
    expect(s.keeper.phase).toBe(2);
    expect(s.keeper.sealsRemaining).toBe(2);
    expect(s.checkpointKey).toBe('cp-arena');
    expect(s.player.pos).toEqual([110.5, 14, 0.5]);
    // dialogue for the arena does not replay
    expect(ofType(log, 'DialogueCue')).toHaveLength(0);
  });

  it('seals are only exposed by the authored interaction for the current phase', () => {
    const sim = arenaSim('lower');
    runPlan(sim, [{ kind: 'goto', to: [115, 14, 7] }, { kind: 'shift', anchor: 'anchor-keeper-right' }]);
    expect(sim.state().keeper.sealExposedTicks).toBe(0);
    const miss = step(sim, { spike: true });
    expect(ofType(miss, 'SealBroken')).toHaveLength(0);
    expect(sim.state().player.charge).toBe(3);
  });

  it('extended exposure assist widens the seal window to five seconds', () => {
    const sim = newSim(1047, undefined, { extendedExposure: true });
    runPlan(sim, [...PLAN_OPENING, ...PLAN_LOWER, { kind: 'goto', to: [115, 14, -6] }, { kind: 'shift', anchor: 'anchor-keeper-left' }]);
    expect(sim.state().keeper.sealExposedTicks).toBe(RULES.keeper.exposeTicksAssist - 1); // the shift tick counts
  });

  it('a fall in the arena returns to a safe point with bounded damage', () => {
    const sim = arenaSim('upper');
    mutate(sim, (s) => { s.player.pos = [118, 14, -7.5]; });
    let log: WorldEvent[] = [];
    for (let i = 0; i < 200 && !log.some((e) => e.type === 'PlayerFell'); i++) log = log.concat(step(sim, { move2: [-1, 0] }));
    expect(ofType(log, 'PlayerFell')).toHaveLength(0); // the arena rail holds
    mutate(sim, (s) => { s.player.pos = [118, 20, -9.5]; });
    log = idleTicks(sim, 200);
    expect(ofType(log, 'PlayerFell')).toHaveLength(1);
    expect(sim.state().player.health).toBe(80);
    expect(sim.state().keeper.phase).toBe(1);
  });
});

describe('machines', () => {
  it('pulse stuns, spike pins for 300 ticks, pin end powers the machine down', () => {
    const sim = newSim(3);
    mutate(sim, (s) => { s.player.pos = [40, 14, 5]; s.player.charge = 3; s.beat = 'maintenance-deck'; });
    const w = step(sim, { pulse: true });
    expect(ofType(w, 'MachineWoke').map((e) => e.key)).toContain('skimmer-d1');
    expect(sim.state().machines.find((m) => m.key === 'skimmer-d1')!.mode).toBe('stunned');
    idleTicks(sim, RULES.toolCooldown);
    const sp = step(sim, { spike: true });
    const pin = ofType(sp, 'MachinePinned')[0]!;
    expect(pin.key).toBe('skimmer-d1');
    const log = idleTicks(sim, 300);
    const dis = ofType(log, 'MachineDisabled')[0]!;
    expect(dis.key).toBe('skimmer-d1');
    expect(dis.tick - pin.tick).toBe(RULES.pinTicks - 1); // the pin tick counts as the first of 300
  });

  it('spike without a target spends no charge', () => {
    const sim = newSim(3);
    const ev = step(sim, { spike: true });
    expect(ev[0]?.payload.hit).toBe(false);
    expect(sim.state().player.charge).toBe(RULES.startCharge);
  });
});

describe('route choice', () => {
  it('backtracking before the first challenge switches branch and machines; neither route removes evidence', () => {
    const sim = newSim(1047);
    runPlan(sim, [...PLAN_OPENING, { kind: 'goto', to: [78, 14, 5.5] }, { kind: 'goto', to: [83, 14, 5.5] }]);
    expect(sim.state().branch).toBe('upper');
    const upperKeys = ['skimmer-u1', 'skimmer-u2', 'hauler-upper'];
    expect(sim.state().machines.filter((m) => upperKeys.includes(m.key)).every((m) => m.active)).toBe(true);
    runPlan(sim, [{ kind: 'goto', to: [78, 14, 0.5] }, { kind: 'goto', to: [78, 14, -5] }, { kind: 'goto', to: [83, 14, -5] }]);
    const s: SimState = sim.state();
    expect(s.branch).toBe('lower');
    expect(s.machines.filter((m) => upperKeys.includes(m.key)).every((m) => !m.active)).toBe(true);
    expect(sim.eventLog().filter((e) => e.type === 'RouteChosen').map((e) => e.key)).toEqual(['upper', 'lower']);
    expect(s.flags.channelLocated).toBe(true);
    runPlan(sim, [...PLAN_LOWER.slice(2)]);
    expect(sim.state().puzzles['route-locked']).toBe(1);
    runPlan(sim, [{ kind: 'goto', to: [100, 14, -5] }]);
    // locked: the other trigger no longer switches
    expect(sim.state().branch).toBe('lower');
  });
});

describe('G06 assists do not change story or authorization', () => {
  it('identical flags, routes and story events with every assist enabled', () => {
    const plain = newSim(1047);
    runPlan(plain, fullPlan('upper'));
    const assisted = newSim(1047, undefined, { aimAssist: true, halfDamage: true, extendedExposure: true });
    runPlan(assisted, fullPlan('upper'));
    expect(assisted.state().flags).toEqual(plain.state().flags);
    expect(assisted.state().pressure.routes).toEqual(plain.state().pressure.routes);
    expect(assisted.state().tramCrossed).toBe(true);
    const story = ['ChannelLocated', 'SensorVerified', 'EdgeRestored', 'TransferAuthorized', 'GateOpened', 'TramCrossed'];
    const seq = (sim: typeof plain) => sim.eventLog().filter((e) => story.includes(e.type)).map((e) => `${e.type}:${e.key}`);
    expect(seq(assisted)).toEqual(seq(plain));
    const cues = (sim: typeof plain) => sim.eventLog().filter((e) => e.type === 'DialogueCue').map((e) => e.key).sort();
    expect(cues(assisted)).toEqual(cues(plain));
  });
});
