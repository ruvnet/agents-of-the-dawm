/**
 * Manifest-backed authored evidence for the final control screen when the WorldGraph semantic
 * projection is unavailable (ADR 0003 W04). Clearly labelled authored/degraded: it is NOT a WorldGraph
 * query result and NOT a sensor measurement. Every value comes from the validated manifest or the
 * authoritative simulation's pressure view.
 */
import type { DerivedStateDef, LevelManifest, PressureView } from '../contracts';

export interface AuthoredStateEvidence {
  readonly id: number;
  readonly key: DerivedStateDef['key'];
  readonly subjectKey: string;
  readonly statement: string;
  /** From the simulation's pressure view; null when the pressure view does not report it. */
  readonly established: boolean | null;
}

export interface AuthoredEvidence {
  readonly origin: 'authored-manifest';
  readonly degraded: true;
  readonly label: string;
  readonly source: string;
  readonly fixtureId: string;
  readonly modelVersion: string;
  readonly calibrationVersion: string;
  readonly privacyDecision: string;
  readonly states: readonly AuthoredStateEvidence[];
  readonly previewSources: readonly { destination: string; origin: 'authored-simulation'; fixtureId: string; eventId?: string }[];
}

export const DEGRADED_LABEL =
  'Semantic detail unavailable: showing authored manifest evidence (fictional scenario, no live sensing, not a WorldGraph query).';

function establishedFor(key: DerivedStateDef['key'], v: Readonly<PressureView>): boolean | null {
  switch (key) {
    case 'channel-located': return v.channelLocated;
    case 'sensor-verified': return v.channelSensorVerified;
    case 'edge-restored': return v.channelEdgeRestored;
    case 'transfer-authorized': return v.playerAuthorized;
    case 'gate-opened': return v.gateOpen;
  }
}

export function authoredEvidence(manifest: LevelManifest, pressureView: Readonly<PressureView>): AuthoredEvidence {
  return {
    origin: 'authored-manifest',
    degraded: true,
    label: DEGRADED_LABEL,
    source: manifest.provenance.source,
    fixtureId: manifest.pressure.fixtureId,
    modelVersion: manifest.provenance.modelVersion,
    calibrationVersion: manifest.provenance.calibrationVersion,
    privacyDecision: manifest.provenance.privacyDecision,
    states: manifest.derivedStates.map((d) => ({
      id: d.id, key: d.key, subjectKey: d.subjectKey, statement: d.statement, established: establishedFor(d.key, pressureView),
    })),
    previewSources: pressureView.previews.map((p) => ({ destination: p.destination, ...p.evidenceSource })),
  };
}
