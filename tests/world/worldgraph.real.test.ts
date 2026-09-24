/**
 * W03 real-module evidence: every test here runs the ACTUAL source-built worldgraph-wasm binary
 * (src/wasm/pkg, pinned commit in RECEIPT.json) in Node. No mocked bridge.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SEMANTIC_UPDATES_PER_SECOND } from '../../src/contracts';
import { WASM_RECEIPT } from '../../src/wasm';
import {
  ALLOWED_RELS, CALIBRATION_VERSION, PRIVACY_DECISION, createSemanticAdapter, createWorldgraphAdapter,
  footprintOf, syntheticMs,
} from '../../src/world';
import { ev, manifest, realLoader, storyEvents, wasmBytes, wasmSha256 } from './helpers';

const PIN = '9b1c79c836cdacfb7b44f058c593157bac4c1dab';

async function readyAdapter() {
  const a = createWorldgraphAdapter({ loader: realLoader });
  const status = await a.init(manifest());
  expect(status, a.unavailableReason() ?? '').toBe('ready');
  return a;
}

function snapshot(a: { exportSnapshotJson(): string | null }) {
  return JSON.parse(a.exportSnapshotJson()!) as {
    schema_version: number; nodes: Record<string, any>[]; edges: { id: number; from: number; to: number; edge: Record<string, any> }[];
  };
}

describe('worldgraph-wasm real module (W03)', () => {
  it('binary provenance matches the receipt and pinned source commit', () => {
    expect(WASM_RECEIPT.sourceCommit).toBe(PIN);
    expect(wasmSha256()).toBe(WASM_RECEIPT.wasmSha256);
    expect(wasmBytes().length).toBe(WASM_RECEIPT.wasmBytes);
    expect(WASM_RECEIPT.crateLicense).toBe('MIT OR Apache-2.0');
  });

  it('createSemanticAdapter initialises the real module and projects the authored district', async () => {
    const m = manifest();
    const a = createSemanticAdapter({ loader: realLoader });
    expect(a.status()).toBe('loading');
    expect(await a.init(m)).toBe('ready');
    const r = a.receipt();
    expect(r).toMatchObject({ module: 'worldgraph-wasm', sourceCommit: PIN, wasmSha256: wasmSha256(), status: 'ready', reason: null });
    expect(Number.isFinite(r.initMs)).toBe(true);
    expect(r.nodeCount).toBe(m.entities.length);
    expect(r.edgeCount).toBe(m.semanticEdges.length);
    const s = snapshot(a);
    expect(s.schema_version).toBe(2);
    const kinds = new Set(s.nodes.map((n) => n.kind));
    expect([...kinds].sort()).toEqual(['doorway', 'object_anchor', 'room', 'wall']);
    for (const n of s.nodes) expect(n).not.toHaveProperty('type');
    console.info(`[W03] initMs=${r.initMs?.toFixed(2)} nodes=${r.nodeCount} edges=${r.edgeCount}`);
  });

  it('room bounds_enu are the 2D ENU footprint of the authored zone (north = -z)', async () => {
    const m = manifest();
    const a = await readyAdapter();
    const s = snapshot(a);
    const room = (key: string) => s.nodes.find((n) => n.area_id === `${m.id}:${key}`)!;
    // Exact fixture for the mapping itself (independent of W1-owned geometry).
    expect(footprintOf({ min: [1, 0, -3], max: [2, 5, 7] })).toEqual({ shape: 'rectangle', min_e: 1, max_e: 2, min_n: -7, max_n: 3 });
    // Data-driven over whatever geometry W1 authors: zone rooms get their footprint; others are labelled unplaced.
    const zoneKeys = new Set(m.geometry.zones.map((z) => z.key));
    for (const z of m.geometry.zones) {
      if (m.entities.find((e) => e.key === z.key)?.kind !== 'room') continue;
      expect(room(z.key).bounds_enu, z.key).toEqual(footprintOf(z.box));
      expect(a.placements()[z.key]).toBe('authored');
    }
    for (const e of m.entities.filter((x) => x.kind === 'room' && !zoneKeys.has(x.key))) {
      expect(a.placements()[e.key], e.key).toBe('unplaced');
      expect(room(e.key).bounds_enu, e.key).toEqual({ shape: 'polygon', vertices: [] });
    }
    const tally: Record<string, number> = {};
    for (const p of Object.values(a.placements())) tally[p] = (tally[p] ?? 0) + 1;
    console.info(`[W03] placements ${JSON.stringify(tally)}`);
  });

  it('edges use only located_in / adjacent_to / derived_from with stable manifest IDs; adjacency via doorways', async () => {
    const m = manifest();
    const a = await readyAdapter();
    a.enqueue(storyEvents());
    a.flush(0);
    const s = snapshot(a);
    for (const e of s.edges) expect(ALLOWED_RELS).toContain(e.edge.rel);
    expect(s.edges.some((e) => /pressure|hydraulic|supports|observes/.test(e.edge.rel))).toBe(false);
    const ids = s.edges.map((e) => e.id).sort((x, y) => x - y);
    const expected = [...m.semanticEdges.map((e) => e.id), ...m.derivedStates.map((d) => d.edgeId)].sort((x, y) => x - y);
    expect(ids).toEqual(expected);
    const adj = s.edges.find((e) => e.id === 20032)!;
    expect(adj.edge).toEqual({ rel: 'adjacent_to', via_doorway: 201 });
    // The reservoir -> relief connection is never a WorldGraph edge.
    const reservoir = m.entities.find((e) => e.key === 'reservoir')!.id;
    const relief = m.entities.find((e) => e.key === 'relief-channel')!.id;
    expect(s.edges.some((e) => (e.from === reservoir && e.to === relief) || (e.from === relief && e.to === reservoir))).toBe(false);
  });

  it('story events become authored semantic_state nodes with synthetic time and four provenance fields', async () => {
    const m = manifest();
    const a = await readyAdapter();
    a.enqueue(storyEvents());
    a.flush(0);
    const s = snapshot(a);
    const states = s.nodes.filter((n) => n.kind === 'semantic_state');
    expect(states.map((n) => n.id).sort()).toEqual(m.derivedStates.map((d) => d.id).sort());
    const sensor = states.find((n) => n.id === 10002)!;
    expect(sensor.valid_from_unix_ms).toBe(syntheticMs(m, 5400));
    expect(sensor.valid_from_unix_ms).toBe(m.provenance.syntheticEpochMs + 90_000);
    expect(sensor.provenance).toEqual({
      evidence: [m.provenance.source, `${m.provenance.source}#event/SensorVerified:5400:relief-sensor`],
      model_version: m.provenance.modelVersion,
      calibration_version: CALIBRATION_VERSION,
      privacy_decision: PRIVACY_DECISION,
    });
  });

  it('getProvenance is called with the generated bigint argument type on a known stable ID', async () => {
    const m = manifest();
    const a = await readyAdapter();
    a.enqueue([ev('SensorVerified', 5400, 'relief-sensor')]);
    a.flush(0);
    const p = a.provenance(10002)!;
    expect(p).not.toBeNull();
    expect(p.statement).toBe('relief-channel clear in authored scenario');
    expect(p.model_version).toBe('floodline-authored-sim-v1');
    expect(p.calibration_version).toBe('fictional-scene-enu-v1');
    expect(p.privacy_decision).toBe('synthetic:no-personal-data');
    expect(p.evidence).toContain(m.provenance.source);
    expect(p.evidence).toEqual([m.provenance.source, `${m.provenance.source}#event/SensorVerified:5400:relief-sensor`]);
    // Non-semantic nodes carry no provenance fields: return null rather than invent them.
    expect(a.provenance(114)).toBeNull();
    expect(a.provenance(Number.NaN)).toBeNull();
    expect(a.provenance(99_999)).toBeNull();
    // Direct evidence of the binding contract: a plain number is rejected by the u64 parameter.
    const mod = (await realLoader()) as any;
    const bridge = mod.WorldgraphBridge.empty();
    expect(() => bridge.getProvenance(1)).toThrow();
    expect(bridge.getProvenance(1n)).toBeNull();
    bridge.free();
  });

  it('W01 replay idempotency: applying the same events twice yields the same digest', async () => {
    const a = await readyAdapter();
    a.enqueue(storyEvents());
    a.flush(0);
    const d1 = a.canonicalDigest();
    a.enqueue(storyEvents());
    a.flush(1000);
    a.enqueue(storyEvents());
    a.flush(2000);
    expect(d1).toMatch(/^[0-9a-f]{16}$/);
    expect(a.canonicalDigest()).toBe(d1);
  });

  it('rewind: a fresh adapter replaying the same event log reaches the same digest', async () => {
    const a = await readyAdapter();
    const b = await readyAdapter();
    a.enqueue(storyEvents());
    a.flush(0);
    // Different batching / timing of the same ordered log.
    const log = storyEvents();
    b.enqueue(log.slice(0, 2));
    b.flush(10);
    b.enqueue(log.slice(2));
    b.flush(500);
    expect(b.canonicalDigest()).toBe(a.canonicalDigest());
    const partial = await readyAdapter();
    partial.enqueue(log.slice(0, 2));
    partial.flush(0);
    expect(partial.canonicalDigest()).not.toBe(a.canonicalDigest());
    // Compared by hand against the headless Chromium smoke run (recorded in W03_STATUS.md).
    console.info(`[W03] digest full=${a.canonicalDigest()} twoEvents=${partial.canonicalDigest()}`);
  });

  it('projection round trip: export -> new WorldgraphBridge(snapshot) -> identical canonical digest', async () => {
    const a = await readyAdapter();
    a.enqueue(storyEvents());
    a.flush(0);
    const json = a.exportSnapshotJson()!;
    expect(a.importSnapshotDigest(json)).toBe(a.canonicalDigest());
  });

  it('malformed snapshot imports are rejected before or by WASM', async () => {
    const a = await readyAdapter();
    const good = JSON.parse(a.exportSnapshotJson()!);
    expect(() => a.importSnapshotDigest('{not json')).toThrow(/snapshot rejected/);
    expect(() => a.importSnapshotDigest(JSON.stringify({ ...good, schema_version: 9 }))).toThrow(/schema_version/);
    expect(() => a.importSnapshotDigest(JSON.stringify({ ...good, nodes: 'x' }))).toThrow(/arrays/);
    expect(() => a.importSnapshotDigest(JSON.stringify({ ...good, nodes: [{ kind: 'room', id: -1 }] }))).toThrow(/safe positive id/);
    // Passes the shape pre-check but is not a valid WorldNode: the real WASM decoder rejects it.
    const badNode = { ...good, nodes: [{ kind: 'room', id: 1, name: 'x' }], edges: [] };
    expect(() => a.importSnapshotDigest(JSON.stringify(badNode))).toThrow(/invalid RVF payload/);
    expect(a.status()).toBe('ready');
  });

  it(`cadence limiter applies at most ${MAX_SEMANTIC_UPDATES_PER_SECOND} batches per second`, async () => {
    const a = await readyAdapter();
    for (let t = 0; t < 1000; t += 5) {
      a.enqueue([ev('SensorVerified', 5400 + t, 'relief-sensor')]);
      a.flush(t);
    }
    expect(a.appliedBatches()).toBeLessThanOrEqual(MAX_SEMANTIC_UPDATES_PER_SECOND);
    expect(a.appliedBatches()).toBeGreaterThan(0);
    // Coalesced: the latest queued SensorVerified wins once the cadence allows another flush.
    a.flush(2000);
    expect(snapshot(a).nodes.find((n) => n.id === 10002)!.valid_from_unix_ms).toBe(syntheticMs(manifest(), 5400 + 995));
  });

  it('dispose frees the bridge and stops accepting work', async () => {
    const a = await readyAdapter();
    a.dispose();
    expect(a.status()).toBe('disposed');
    a.enqueue(storyEvents());
    a.flush(0);
    expect(a.canonicalDigest()).toBeNull();
    expect(a.provenance(10002)).toBeNull();
    expect(await a.init(manifest())).toBe('disposed');
  });
});
