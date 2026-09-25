/**
 * Read-through cache over a SemanticAdapter for the per-frame FinalGraphView (W7.PERF.01).
 * composeFinalGraphView ran every frame, and once the WorldGraph adapter is ready each call did a
 * full `exportRvfJson()` in WASM, hashed it with the BigInt FNV, and made one `getProvenance`
 * WASM call per derived state: ~0.5 ms of a ~1.2 ms app frame in headless Chromium.
 *
 * The semantic graph only changes inside the adapter's `init()` and `flush()`. Cached reads are
 * keyed on (status, appliedBatches, init generation) and dropped as soon as any of them changes,
 * so a view is never staler than the adapter's last applied batch. Adapters that do not expose
 * `appliedBatches()` are returned unwrapped (no caching, previous behaviour).
 */
import type { SemanticAdapter, SemanticProvenanceView } from '../contracts/semantic';

export interface CachedSemantic {
  /** Adapter to hand to composeFinalGraphView (cached reads). */
  readonly view: SemanticAdapter;
  /** Number of cache fills (evidence the cache is hit, not recomputed, per frame). */
  fills(): number;
}

export function cacheSemanticReads(a: SemanticAdapter): CachedSemantic {
  const batches = (a as Partial<{ appliedBatches: () => number }>).appliedBatches;
  if (typeof batches !== 'function') return { view: a, fills: () => 0 };
  let key = '';
  let generation = 0;
  let digest: string | null | undefined;
  const prov = new Map<number, SemanticProvenanceView | null>();
  let fills = 0;
  const check = (): void => {
    const k = `${a.status()}|${batches.call(a)}|${generation}`;
    if (k !== key) {
      key = k;
      digest = undefined;
      prov.clear();
    }
  };
  const view: SemanticAdapter = {
    status: () => a.status(),
    unavailableReason: () => a.unavailableReason(),
    init: (m) => { generation += 1; return a.init(m); },
    enqueue: (e) => a.enqueue(e),
    flush: (t) => a.flush(t),
    provenance(id) {
      check();
      if (!prov.has(id)) { fills += 1; prov.set(id, a.provenance(id)); check(); }
      return prov.get(id) ?? null;
    },
    canonicalDigest() {
      check();
      if (digest === undefined) { fills += 1; digest = a.canonicalDigest(); check(); }
      return digest ?? null;
    },
    exportSnapshotJson: () => a.exportSnapshotJson(),
    receipt: () => a.receipt(),
    dispose: () => { generation += 1; a.dispose(); },
  };
  return { view, fills: () => fills };
}
