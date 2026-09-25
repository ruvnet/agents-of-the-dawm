/**
 * Game pressure graph, control-screen actions and the final PressureView (ADR 0003/0004).
 * The simulation is the only authority. The single write of `approved=true` on reservoir-to-relief
 * is `restore-edge`; the single write of `gateOpen=true` is a successful `authorize` of relief.
 */
import type { ControlAction } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import type { CapacityChecks, Destination, PressureView, PreviewFixture, RoutePreview } from '../contracts/pressure';
import { DESTINATIONS } from '../contracts/pressure';
import type { SimState } from '../contracts/sim';
import type { Ctx } from './ctx';
import { RULES, cue, emit, once } from './ctx';

export const RELIEF: Destination = 'relief-channel';
export const RELIEF_ROUTE = 'reservoir-to-relief';
export const SENSOR_TICK_KEY = 'sensor-verified-tick';

export function fixtureFor(m: LevelManifest, d: Destination): PreviewFixture {
  const f = m.pressure.previews.find((p) => p.destination === d);
  if (!f) throw new Error(`pressure fixture missing ${d}`);
  return f;
}

const withinLoad = (f: PreviewFixture) => f.projectedLoad <= f.safeThreshold;
const pumpOk = (f: PreviewFixture) => f.pumpLoadAfter <= f.pumpThreshold;

/** Deterministic capacity preflight for one destination (pure fixture + verified evidence). */
export function preflightSafe(m: LevelManifest, s: SimState, d: Destination): boolean {
  const f = fixtureFor(m, d);
  const capacity = !f.occupied && withinLoad(f) && pumpOk(f);
  if (d !== RELIEF) return capacity;
  // Relief occupancy is only known clear after the in-world sensor scan.
  return s.flags.channelLocated && s.flags.channelSensorVerified && capacity;
}

export function reliefReasonKey(m: LevelManifest, s: SimState): string {
  if (!s.flags.channelLocated) return 'reason.relief.unlocated';
  if (!s.flags.channelSensorVerified) return 'reason.relief.unverified';
  if (!s.flags.channelEdgeRestored) return 'reason.relief.unrestored';
  const f = fixtureFor(m, RELIEF);
  if (!pumpOk(f)) return 'reason.pump.overload';
  return f.reasonKey;
}

export function reasonKeyFor(m: LevelManifest, s: SimState, d: Destination): string {
  return d === RELIEF ? reliefReasonKey(m, s) : fixtureFor(m, d).reasonKey;
}

export function computeCapacity(m: LevelManifest, s: SimState): CapacityChecks {
  const sel = s.pressure.selectedDestination;
  if (!sel) return { pumpWithinTolerance: false, streetUnoccupiedByFlow: false, reliefWithinTolerance: false };
  const f = fixtureFor(m, sel);
  return {
    pumpWithinTolerance: pumpOk(f),
    streetUnoccupiedByFlow: sel !== 'occupied-street' && !f.occupied,
    reliefWithinTolerance: sel === RELIEF && withinLoad(f),
  };
}

/**
 * capacitySafe: relief is the selected destination, all three capacity checks hold, the relief
 * sensor verified it, and all three destinations were previewed (ADR 0004 "from a preview of all
 * three destinations").
 */
export function refreshCapacity(m: LevelManifest, s: SimState): void {
  if (s.flags.gateOpen) return; // frozen after the single successful transfer
  const checks = computeCapacity(m, s);
  s.pressure.capacityChecks = checks;
  s.flags.capacitySafe = s.pressure.selectedDestination === RELIEF
    && checks.pumpWithinTolerance && checks.streetUnoccupiedByFlow && checks.reliefWithinTolerance
    && s.flags.channelSensorVerified
    && DESTINATIONS.every((d) => s.pressure.previewed.includes(d));
}

function reject(c: Ctx, action: string, reasonKey: string, destination: Destination | null = null): void {
  emit(c, 'TransferRejected', action, {
    reasonKey, reason: c.m.pressure.reasons[reasonKey] ?? reasonKey, destination,
  });
}

export function nearControlScreen(c: Ctx, center: readonly number[]): boolean {
  const it = c.m.geometry.interactables.find((i) => i.kind === 'control-screen');
  if (!it) return false;
  const d = Math.hypot(center[0]! - it.pos[0], center[1]! - it.pos[1], center[2]! - it.pos[2]);
  return d <= it.radius;
}

export function selectRelief(c: Ctx): void {
  cue(c, 'relief-selected');
  if (!c.s.flags.channelSensorVerified) cue(c, 'before-scan');
}

/** Handle one control-screen action. `near` = player within the control-screen interactable. */
export function applyControl(c: Ctx, a: ControlAction, near: boolean): void {
  const { m, s } = c;
  const p = s.pressure;
  if (a.kind === 'open-panel') {
    if (p.panelOpen) return;
    if (s.keeper.phase !== 4) return reject(c, 'open-panel', 'reason.panel.keeper-active');
    if (!near) return reject(c, 'open-panel', 'reason.panel.out-of-reach');
    p.panelOpen = true;
    emit(c, 'PanelOpened', 'control-screen');
    cue(c, 'panel-opened');
    return;
  }
  if (!p.panelOpen) return reject(c, a.kind, 'reason.panel.closed', 'destination' in a ? a.destination : null);
  if (a.kind === 'close-panel') {
    p.panelOpen = false;
    emit(c, 'PanelClosed', 'control-screen');
    return;
  }
  if (s.flags.gateOpen) return; // transfer committed; further edits are inert and never re-emit GateOpened
  switch (a.kind) {
    case 'scan-sensor': {
      if (!s.flags.channelLocated) return reject(c, 'scan-sensor', 'reason.relief.unlocated', RELIEF);
      selectRelief(c);
      if (!s.flags.channelSensorVerified) {
        s.flags.channelSensorVerified = true;
        s.puzzles[SENSOR_TICK_KEY] = c.tick;
        emit(c, 'SensorVerified', 'relief-sensor', { occupied: fixtureFor(m, RELIEF).occupied, fixtureId: m.pressure.fixtureId });
        cue(c, 'sensor-verified');
      }
      refreshCapacity(m, s);
      return;
    }
    case 'preview': {
      const d = a.destination;
      if (!DESTINATIONS.includes(d)) return;
      if (d === RELIEF && !s.flags.channelLocated) return reject(c, 'preview', 'reason.relief.unlocated', d);
      if (d === RELIEF) selectRelief(c);
      p.selectedDestination = d;
      if (!p.previewed.includes(d)) {
        p.previewed.push(d);
        p.previewed.sort();
      }
      refreshCapacity(m, s);
      const f = fixtureFor(m, d);
      emit(c, 'PreviewShown', d, {
        safe: preflightSafe(m, s, d), reasonKey: reasonKeyFor(m, s, d),
        projectedLoad: f.projectedLoad, safeThreshold: f.safeThreshold, unit: 'kPa',
      });
      if (s.flags.channelSensorVerified) cue(c, 'preview-opened');
      // Deterministic preflight rejects unsafe destinations with their reason; nothing is routed.
      if (!preflightSafe(m, s, d)) reject(c, 'preview', reasonKeyFor(m, s, d), d);
      return;
    }
    case 'restore-edge': {
      if (!s.flags.channelLocated) return reject(c, 'restore-edge', 'reason.relief.unlocated', RELIEF);
      if (!s.flags.channelSensorVerified) return reject(c, 'restore-edge', 'reason.relief.unverified', RELIEF);
      if (!preflightSafe(m, s, RELIEF)) return reject(c, 'restore-edge', 'reason.pump.overload', RELIEF);
      if (s.flags.channelEdgeRestored) return;
      const route = p.routes.find((r) => r.id === RELIEF_ROUTE);
      if (!route || !route.physicalPipePresent) return reject(c, 'restore-edge', 'reason.relief.unlocated', RELIEF);
      route.approved = true;
      s.flags.channelEdgeRestored = true;
      emit(c, 'EdgeRestored', RELIEF_ROUTE, { from: route.from, to: route.to });
      refreshCapacity(m, s);
      return;
    }
    case 'authorize': {
      const d = a.destination;
      if (!DESTINATIONS.includes(d)) return;
      if (d !== RELIEF) return reject(c, 'authorize', fixtureFor(m, d).reasonKey, d);
      p.selectedDestination = RELIEF;
      refreshCapacity(m, s);
      if (!s.flags.channelLocated) return reject(c, 'authorize', 'reason.relief.unlocated', d);
      if (!s.flags.channelSensorVerified) return reject(c, 'authorize', 'reason.relief.unverified', d);
      if (!s.flags.channelEdgeRestored) return reject(c, 'authorize', 'reason.relief.unrestored', d);
      if (!DESTINATIONS.every((x) => p.previewed.includes(x))) return reject(c, 'authorize', 'reason.preview.incomplete', d);
      if (!s.flags.capacitySafe) return reject(c, 'authorize', 'reason.pump.overload', d);
      // All five predicates hold: this is the only place playerAuthorized and gateOpen become true.
      s.flags.playerAuthorized = true;
      emit(c, 'TransferAuthorized', RELIEF, { route: RELIEF_ROUTE });
      cue(c, 'authorized');
      if (once(s, 'gate-opened')) {
        s.flags.gateOpen = true;
        emit(c, 'GateOpened', 'locked-gate', { destination: RELIEF });
        s.puzzles['tram-timer'] = RULES.tramDelayTicks;
      }
      return;
    }
  }
}

export function pressureView(m: LevelManifest, s: SimState): PressureView {
  const sensorTick = s.puzzles[SENSOR_TICK_KEY];
  const previews: RoutePreview[] = DESTINATIONS.map((d) => {
    const f = fixtureFor(m, d);
    const reasonKey = reasonKeyFor(m, s, d);
    const evidenceSource: RoutePreview['evidenceSource'] = d === RELIEF && s.flags.channelSensorVerified && sensorTick !== undefined
      ? { origin: 'authored-simulation', fixtureId: m.pressure.fixtureId, eventId: `SensorVerified:${sensorTick}:relief-sensor` }
      : { origin: 'authored-simulation', fixtureId: m.pressure.fixtureId };
    return {
      destination: d,
      occupied: f.occupied,
      projectedLoad: f.projectedLoad,
      safeThreshold: f.safeThreshold,
      unit: 'kPa',
      safe: preflightSafe(m, s, d),
      reason: m.pressure.reasons[reasonKey] ?? reasonKey,
      evidenceSource,
    };
  });
  return {
    routes: s.pressure.routes.map((r) => ({ ...r })),
    previews,
    selectedDestination: s.pressure.selectedDestination,
    channelLocated: s.flags.channelLocated,
    channelSensorVerified: s.flags.channelSensorVerified,
    channelEdgeRestored: s.flags.channelEdgeRestored,
    playerAuthorized: s.flags.playerAuthorized,
    capacityChecks: { ...s.pressure.capacityChecks },
    capacitySafe: s.flags.capacitySafe,
    gateOpen: s.flags.gateOpen,
  };
}

/** Post-authorization timeline: tram crossing, then the wider map and the two further outlines. */
export function tickEpilogue(c: Ctx): void {
  const s = c.s;
  const t = s.puzzles['tram-timer'];
  if (t !== undefined && t > 0) {
    s.puzzles['tram-timer'] = t - 1;
    if (t - 1 === 0 && s.flags.gateOpen && once(s, 'tram-crossed')) {
      s.tramCrossed = true;
      emit(c, 'TramCrossed', 'tram', { occupants: 4 });
      cue(c, 'tram-crossed');
      s.puzzles['epilogue-timer'] = RULES.widerMapDelayTicks + RULES.moreOutlinesDelayTicks;
    }
  }
  const e = s.puzzles['epilogue-timer'];
  if (e !== undefined && e > 0) {
    s.puzzles['epilogue-timer'] = e - 1;
    if (e - 1 === RULES.moreOutlinesDelayTicks) cue(c, 'wider-map');
    if (e - 1 === 0) cue(c, 'more-outlines');
  }
}
