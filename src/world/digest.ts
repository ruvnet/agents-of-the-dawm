/**
 * Canonical semantic projection digest (ADR 0003 W01): parse the WorldGraph JSON snapshot returned by
 * exportRvfJson(), keep schema version + nodes sorted by WorldId + WorldEdgeRecords sorted by stable
 * edge id, drop allocator counters (next_id, next_edge_id), registration and insertion order, then hash
 * with the shared contract canonicalHash (floats normalised, keys sorted).
 */
import { canonicalHash } from '../contracts';

export interface CanonicalProjection {
  readonly schema_version: number;
  readonly nodes: readonly Record<string, unknown>[];
  readonly edges: readonly { id: number; from: number; to: number; edge: Record<string, unknown> }[];
}

export function canonicalProjection(snapshotJson: string): CanonicalProjection {
  const snap = JSON.parse(snapshotJson) as Record<string, unknown>;
  if (typeof snap.schema_version !== 'number' || !Array.isArray(snap.nodes) || !Array.isArray(snap.edges)) {
    throw new Error('snapshot missing schema_version/nodes/edges');
  }
  const nodes = [...(snap.nodes as Record<string, unknown>[])].sort((a, b) => (a.id as number) - (b.id as number));
  const edges = (snap.edges as Record<string, unknown>[])
    .map((r) => ({ id: r.id as number, from: r.from as number, to: r.to as number, edge: r.edge as Record<string, unknown> }))
    .sort((a, b) => a.id - b.id);
  return { schema_version: snap.schema_version, nodes, edges };
}

export const digestOfSnapshot = (snapshotJson: string): string => canonicalHash(canonicalProjection(snapshotJson));
