/**
 * Story events -> authored `semantic_state` upserts plus their reserved `derived_from` edges (ADR 0003
 * "Authored provenance"). Provenance is synthetic and labelled; timestamps come from the manifest's
 * deterministic synthetic epoch and the simulation tick, never the wall clock.
 */
import { TICK_MS, type DerivedStateDef, type LevelManifest, type WorldEvent, type WorldEventType } from '../contracts';
import type { TwinCommand } from './commands';

export const SEMANTIC_EVENT_MAP: Readonly<Partial<Record<WorldEventType, DerivedStateDef['key']>>> = {
  ChannelLocated: 'channel-located',
  SensorVerified: 'sensor-verified',
  EdgeRestored: 'edge-restored',
  TransferAuthorized: 'transfer-authorized',
  GateOpened: 'gate-opened',
};

export const CALIBRATION_VERSION = 'fictional-scene-enu-v1';
export const PRIVACY_DECISION = 'synthetic:no-personal-data';
const MAX_EVENT_ID = 200;

/** Deterministic synthetic time for a simulation tick (i64 in WorldGraph: integral ms). */
export const syntheticMs = (m: LevelManifest, tick: number): number =>
  Math.round(m.provenance.syntheticEpochMs + tick * TICK_MS);

export const eventEvidence = (m: LevelManifest, eventId: string): string => `${m.provenance.source}#event/${eventId}`;

export function isSemanticEvent(e: WorldEvent): boolean {
  return SEMANTIC_EVENT_MAP[e.type] !== undefined;
}

/** Validate one semantic story event (untrusted boundary). Returns an error or null. */
export function checkEvent(e: WorldEvent): string | null {
  if (!e || typeof e !== 'object') return 'event must be an object';
  if (typeof e.id !== 'string' || !e.id || e.id.length > MAX_EVENT_ID) return 'event id must be a short non-empty string';
  if (!Number.isSafeInteger(e.tick) || e.tick < 0) return `event ${e.id}: tick must be a non-negative safe integer`;
  return null;
}

/**
 * Commands for one semantic event: an upsert of the reserved derived state node and its reserved
 * derived_from edge to the authored subject. Pure and deterministic: the same event yields byte-identical
 * commands, so replay is idempotent at the wire level.
 */
export function commandsForEvent(m: LevelManifest, e: WorldEvent, idByKey: ReadonlyMap<string, number>): TwinCommand[] {
  const key = SEMANTIC_EVENT_MAP[e.type];
  if (!key) return [];
  const def = m.derivedStates.find((d) => d.key === key);
  if (!def) throw new Error(`manifest has no derived state for ${key}`);
  const subject = idByKey.get(def.subjectKey);
  if (subject === undefined) throw new Error(`derived state ${key}: subject ${def.subjectKey} not projected`);
  const evidence = eventEvidence(m, e.id);
  return [
    {
      op: 'upsert_node',
      node: {
        kind: 'semantic_state',
        id: def.id,
        statement: def.statement,
        confidence: 1,
        provenance: {
          evidence: [m.provenance.source, evidence],
          model_version: m.provenance.modelVersion,
          // validateManifest pins these to CALIBRATION_VERSION / PRIVACY_DECISION.
          calibration_version: m.provenance.calibrationVersion,
          privacy_decision: m.provenance.privacyDecision,
        },
        valid_from_unix_ms: syntheticMs(m, e.tick),
      },
    },
    { op: 'upsert_edge', id: def.edgeId, from: def.id, to: subject, edge: { rel: 'derived_from', evidence } },
  ];
}
