/**
 * Final control-screen view (ADR 0003): the authoritative pressure view is passed through unchanged;
 * WorldGraph provenance is attached only when the adapter is 'ready', otherwise the labelled
 * manifest-backed authored evidence is shown. Never fabricates a successful semantic query.
 */
import type { FinalGraphView, LevelManifest, PressureView, SemanticAdapter, SemanticProvenanceView } from '../contracts';
import { authoredEvidence } from './fallback';

export interface ReadySemanticDetail {
  readonly origin: 'worldgraph-wasm';
  readonly digest: string;
  readonly states: readonly SemanticProvenanceView[];
}

export function composeFinalGraphView(
  pressureView: Readonly<PressureView>,
  adapter: SemanticAdapter | null,
  manifest: LevelManifest,
): FinalGraphView {
  if (adapter && adapter.status() === 'ready') {
    try {
      const digest = adapter.canonicalDigest();
      const states = manifest.derivedStates
        .map((d) => adapter.provenance(d.id))
        .filter((p): p is SemanticProvenanceView => p !== null);
      // A failure during these reads flips the adapter to 'unavailable'; re-check before claiming ready.
      if (digest !== null && adapter.status() === 'ready') {
        const provenance: ReadySemanticDetail = { origin: 'worldgraph-wasm', digest, states };
        return { pressure: pressureView, semantic: { status: 'ready', provenance } };
      }
    } catch { /* fall through to the authored fallback */ }
  }
  return {
    pressure: pressureView,
    semantic: {
      status: 'unavailable',
      authoredEvidence: {
        ...authoredEvidence(manifest, pressureView),
        semanticStatus: adapter?.status() ?? 'unavailable',
        reason: adapter?.unavailableReason() ?? 'semantic adapter not created',
      },
    },
  };
}
