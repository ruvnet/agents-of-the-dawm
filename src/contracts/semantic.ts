import type { LevelManifest } from './manifest';
import type { WorldEvent } from './sim';

export type SemanticStatus = 'loading' | 'ready' | 'unavailable' | 'disposed';

/** Bounded semantic sync cadence (ADR 0003 runtime boundary item 4). */
export const MAX_SEMANTIC_UPDATES_PER_SECOND = 10;

export interface SemanticProvenanceView {
  readonly id: number;
  readonly statement: string | null;
  readonly evidence: readonly string[];
  readonly model_version: string;
  readonly calibration_version: string;
  readonly privacy_decision: string;
}

/**
 * WorldGraph WASM projection adapter. Never authoritative. Must degrade to 'unavailable'
 * explicitly, never fabricate a successful query (W04).
 */
export interface SemanticAdapter {
  status(): SemanticStatus;
  unavailableReason(): string | null;
  init(manifest: LevelManifest): Promise<SemanticStatus>;
  /** Queue validated, ordered story events; applied at <= MAX_SEMANTIC_UPDATES_PER_SECOND via flush. */
  enqueue(events: readonly WorldEvent[]): void;
  /** Apply queued commands if the cadence allows. Never called from the physics step. */
  flush(nowMs: number): void;
  provenance(id: number): SemanticProvenanceView | null;
  /** Canonical ID-sorted semantic projection digest (W01), or null when unavailable. */
  canonicalDigest(): string | null;
  exportSnapshotJson(): string | null;
  /** Receipt describing binary provenance and init cost (W03 evidence). */
  receipt(): SemanticReceipt;
  dispose(): void;
}

export interface SemanticReceipt {
  readonly module: 'worldgraph-wasm' | 'none';
  readonly sourceCommit: string | null;
  readonly wasmSha256: string | null;
  readonly initMs: number | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly status: SemanticStatus;
  readonly reason: string | null;
}

export type CreateSemanticAdapter = (options?: { loader?: () => Promise<unknown> }) => SemanticAdapter;
