/**
 * W04 fault injection and pre-WASM validation. Failure paths use injected loaders/mocks on purpose;
 * the real-module evidence lives in worldgraph.real.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalHash } from '../../src/contracts';
import {
  authoredEvidence, buildStaticProjection, composeFinalGraphView, createWorldgraphAdapter, DEGRADED_LABEL,
  validateCommands, type TwinCommand,
} from '../../src/world';
import { manifest, pressureView, realLoader, storyEvents } from './helpers';

describe('pre-WASM validation', () => {
  it('rejects unsafe/out-of-range IDs, NaN coordinates, unknown kinds and hydraulic relations', () => {
    const base = buildStaticProjection(manifest()).commands;
    const room = base.find((c) => c.op === 'upsert_node' && c.node.kind === 'room')!;
    const anchor = base.find((c) => c.op === 'upsert_node' && c.node.kind === 'object_anchor')! as Extract<TwinCommand, { op: 'upsert_node' }>;
    expect(validateCommands(base)).toEqual([]);
    const bad = (c: unknown) => validateCommands([...base, c as TwinCommand]).join('\n');
    expect(bad({ op: 'upsert_node', node: { ...(room as any).node, id: 2 ** 60 } })).toMatch(/outside room range/);
    expect(bad({ op: 'upsert_node', node: { ...(room as any).node, id: 1 } })).toMatch(/duplicate node id 1/);
    expect(bad({ op: 'upsert_node', node: { ...anchor.node, id: 900, position: { east_m: Number.NaN, north_m: 0, up_m: 0 } } }))
      .toMatch(/non-finite|ENU coordinate/);
    expect(bad({ op: 'upsert_node', node: { kind: 'person_track', id: 901 } })).toMatch(/person_track not allowed/);
    expect(bad({ op: 'upsert_edge', id: 29_000, from: 1, to: 2, edge: { rel: 'pressure_route' } })).toMatch(/pressure_route not allowed/);
    expect(bad({ op: 'upsert_edge', id: 29_001, from: 1, to: 2, edge: { rel: 'supports', strength: 1 } })).toMatch(/supports not allowed/);
    expect(bad({ op: 'upsert_edge', id: 29_002, from: 1, to: 7777, edge: { rel: 'located_in', since_unix_ms: 0 } })).toMatch(/endpoint/);
  });

  it('invalid manifests never reach the WASM loader', async () => {
    const cases: [string, (m: any) => void][] = [
      ['unsafe id', (m) => { m.entities[0].id = 2 ** 60; }],
      ['NaN zone coordinate', (m) => { m.geometry.zones[0].box.min[0] = Number.NaN; }],
      ['unknown kind', (m) => { m.entities[0].kind = 'person_track'; }],
      ['hydraulic rel', (m) => { m.semanticEdges[0].rel = 'pressure_route'; }],
    ];
    for (const [name, mutate] of cases) {
      const m = structuredClone(manifest()) as any;
      mutate(m);
      const loader = vi.fn(realLoader);
      const a = createWorldgraphAdapter({ loader });
      expect(await a.init(m), name).toBe('unavailable');
      expect(a.unavailableReason(), name).toMatch(/manifest rejected/);
      expect(loader, name).not.toHaveBeenCalled();
    }
  });

  it('an adjacent_to edge without an authored doorway is rejected, not given a fabricated via_doorway', async () => {
    const m = structuredClone(manifest()) as any;
    m.entities = m.entities.filter((e: any) => e.key !== 'door-west-approach--inspection-wall');
    m.semanticEdges = m.semanticEdges.filter((e: any) => e.from !== 'door-west-approach--inspection-wall');
    const loader = vi.fn(realLoader);
    const a = createWorldgraphAdapter({ loader });
    expect(await a.init(m)).toBe('unavailable');
    expect(a.unavailableReason()).toMatch(/no authored doorway/);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('W04 fault injection and authored fallback', () => {
  it('loader throws -> unavailable with reason; final view keeps the full pressure view + authored evidence', async () => {
    const m = manifest();
    const a = createWorldgraphAdapter({ loader: async () => { throw new Error('wasm fetch 404'); } });
    expect(await a.init(m)).toBe('unavailable');
    expect(a.unavailableReason()).toMatch(/wasm fetch 404/);
    expect(a.canonicalDigest()).toBeNull();
    expect(a.provenance(10002)).toBeNull();
    expect(a.receipt()).toMatchObject({ module: 'none', sourceCommit: null, wasmSha256: null, status: 'unavailable' });
    const pv = pressureView(m);
    const before = canonicalHash(pv);
    const view = composeFinalGraphView(pv, a, m);
    expect(view.pressure).toEqual(pv);
    expect(canonicalHash(view.pressure)).toBe(before);
    expect(view.pressure.previews).toHaveLength(3);
    expect(view.semantic.status).toBe('unavailable');
    if (view.semantic.status !== 'unavailable') throw new Error('unreachable');
    const ev = view.semantic.authoredEvidence as ReturnType<typeof authoredEvidence> & { reason: string };
    expect(ev.origin).toBe('authored-manifest');
    expect(ev.degraded).toBe(true);
    expect(ev.label).toBe(DEGRADED_LABEL);
    expect(ev.reason).toMatch(/wasm fetch 404/);
    expect(ev.privacyDecision).toBe('synthetic:no-personal-data');
    expect(ev.states.find((s) => s.key === 'sensor-verified')).toMatchObject({ established: true, statement: 'relief-channel clear in authored scenario' });
    expect(ev.states.find((s) => s.key === 'edge-restored')!.established).toBe(false);
    expect(ev.states.find((s) => s.key === 'gate-opened')!.established).toBe(false);
    expect(ev.previewSources.every((p) => p.origin === 'authored-simulation')).toBe(true);
  });

  it('an invalid event enqueued while loading makes init end unavailable, never ready', async () => {
    const a = createWorldgraphAdapter({ loader: realLoader });
    const pending = a.init(manifest());
    a.enqueue([{ id: 'SensorVerified:-1:relief-sensor', tick: -1, type: 'SensorVerified', key: 'relief-sensor', payload: {} }]);
    expect(await pending).toBe('unavailable');
    expect(a.unavailableReason()).toMatch(/tick must be a non-negative/);
    expect(a.canonicalDigest()).toBeNull();
  });

  it('a module without the expected bindings is rejected', async () => {
    const a = createWorldgraphAdapter({ loader: async () => ({ default: async () => undefined }) });
    expect(await a.init(manifest())).toBe('unavailable');
    expect(a.unavailableReason()).toMatch(/invalid WorldGraph WASM module/);
  });

  it('a rejected update freezes the projection, keeps the last valid export and never claims ready', async () => {
    const real = (await realLoader()) as any;
    let failNext = false;
    class FlakyBridge {
      inner = real.WorldgraphBridge.empty();
      static empty() { return new FlakyBridge(); }
      applyMessageJson(json: string) { if (failNext) throw new Error('decode twin message: injected'); this.inner.applyMessageJson(json); }
      getAllNodes() { return this.inner.getAllNodes(); }
      getEdges() { return this.inner.getEdges(); }
      getProvenance(id: bigint) { return this.inner.getProvenance(id); }
      exportRvfJson() { return this.inner.exportRvfJson(); }
      nodeCount() { return this.inner.nodeCount(); }
      free() { this.inner.free(); }
    }
    const m = manifest();
    const a = createWorldgraphAdapter({ loader: async () => ({ default: async () => undefined, WorldgraphBridge: FlakyBridge }) });
    expect(await a.init(m)).toBe('ready');
    const lastGood = a.exportSnapshotJson();
    failNext = true;
    a.enqueue(storyEvents());
    a.flush(0);
    expect(a.status()).toBe('unavailable');
    expect(a.unavailableReason()).toMatch(/injected/);
    expect(a.exportSnapshotJson()).toBe(lastGood);
    expect(a.canonicalDigest()).toBeNull();
    const view = composeFinalGraphView(pressureView(m), a, m);
    expect(view.semantic.status).toBe('unavailable');
  });

  it('when ready, the final view attaches real WorldGraph provenance by stable ID', async () => {
    const m = manifest();
    const a = createWorldgraphAdapter({ loader: realLoader });
    expect(await a.init(m)).toBe('ready');
    a.enqueue(storyEvents().slice(0, 2));
    a.flush(0);
    const view = composeFinalGraphView(pressureView(m), a, m);
    expect(view.semantic.status).toBe('ready');
    if (view.semantic.status !== 'ready') throw new Error('unreachable');
    const detail = view.semantic.provenance as { origin: string; digest: string; states: { id: number }[] };
    expect(detail.origin).toBe('worldgraph-wasm');
    expect(detail.digest).toBe(a.canonicalDigest());
    expect(detail.states.map((s) => s.id)).toEqual([10001, 10002]);
  });

  it('a null adapter still yields the complete authored view', () => {
    const m = manifest();
    const view = composeFinalGraphView(pressureView(m), null, m);
    expect(view.semantic.status).toBe('unavailable');
    expect(view.pressure.previews.map((p) => p.destination).sort()).toEqual(['occupied-street', 'protected-pump', 'relief-channel']);
  });
});
