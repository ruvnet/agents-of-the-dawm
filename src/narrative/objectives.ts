/**
 * Objective text derived purely from committed simulation state (beat plus story progress).
 * Checks run from the latest story stage back to the first, so the most advanced true condition wins.
 */
import type { Objective } from '../contracts/narrative';
import type { SimState } from '../contracts/sim';
import { t, type LocaleId, type ObjectiveKey } from './strings';

const fired = (s: Readonly<SimState>, cueKey: string): boolean => s.fired.includes(`cue:${cueKey}`);

export function objectiveKeyFor(s: Readonly<SimState>): ObjectiveKey {
  const f = s.flags;
  if (s.tramCrossed) return 'complete';
  if (f.gateOpen) return 'watch-tram';
  if (s.keeper.phase === 4) {
    if (!s.pressure.panelOpen) return 'open-control-screen';
    if (!f.channelSensorVerified) return 'scan-relief-sensor';
    if (s.pressure.previewed.length < 3) return 'preview-destinations';
    if (!f.channelEdgeRestored) return 'restore-route';
    return 'authorize-transfer';
  }
  if (s.keeper.phase > 0 || s.beat === 'keeper-arena') return 'expose-seals';
  if (s.branch === 'upper' || s.beat === 'upper-lattice') return 'cross-lattice';
  if (s.branch === 'lower' || s.beat === 'lower-conduit') return 'redirect-conduit';
  if (f.channelLocated || s.beat === 'junction') return 'choose-route';
  if (s.puzzles['gantry-settled'] === 1) return 'inspect-channel-marker';
  if (fired(s, 'deck-cleared') || s.beat === 'floating-gantry') return 'move-gantry';
  if (s.beat === 'maintenance-deck' || fired(s, 'first-skimmer-wakes')) return 'disable-skimmers';
  if (s.beat === 'inspection-wall' || fired(s, 'first-shift')) return 'climb-wall';
  return 'reach-inspection-anchor';
}

export function objectiveFor(state: Readonly<SimState>, locale: LocaleId = 'en'): Objective {
  const key = objectiveKeyFor(state);
  return { key, text: t(`objective.${key}`, locale) };
}
