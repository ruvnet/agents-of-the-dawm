/**
 * WorldGraph WASM semantic projection adapter (ADR 0003). Never authoritative: the simulation owns
 * gameplay and the pressure graph. Any failure freezes the projection as 'unavailable' with a reason,
 * keeps the last valid export for diagnosis, and never fabricates a query result (W04).
 */
import {
  MAX_SEMANTIC_UPDATES_PER_SECOND, validateManifest,
  type CreateSemanticAdapter, type LevelManifest, type SemanticAdapter, type SemanticProvenanceView,
  type SemanticReceipt, type SemanticStatus, type WorldEvent,
} from '../contracts';
import {
  asWorldgraphModule, checkSnapshotJson, loadWorldgraphWasm, WASM_RECEIPT,
  type RustWorldgraphBridge, type WorldgraphWasmModule,
} from '../wasm';
import { validateCommands, type TwinCommand } from './commands';
import { digestOfSnapshot } from './digest';
import { checkEvent, commandsForEvent, isSemanticEvent } from './events';
import { buildStaticProjection, type Placement } from './projection';

export interface WorldAdapterOptions {
  /** Returns the generated wasm-bindgen module (browser default: dynamic import of src/wasm/pkg). */
  loader?: () => Promise<unknown>;
  /** Monotonic clock for initMs measurement only (never used as evidence time). */
  clock?: () => number;
}

export interface WorldgraphAdapter extends SemanticAdapter {
  /** Per-entity placement provenance of the static projection. */
  placements(): Readonly<Record<string, Placement>>;
  /** Number of flushes that applied a batch to WASM (cadence evidence). */
  appliedBatches(): number;
  /** Validate and import a snapshot into a NEW bridge from the loaded module; returns its digest. */
  importSnapshotDigest(json: string): string;
}

const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Pending = Map<WorldEvent['type'], WorldEvent>;

export function createWorldgraphAdapter(options: WorldAdapterOptions = {}): WorldgraphAdapter {
  const loader = options.loader ?? loadWorldgraphWasm;
  const clock = options.clock ?? perfNow;
  const minIntervalMs = 1000 / MAX_SEMANTIC_UPDATES_PER_SECOND;

  let status: SemanticStatus = 'loading';
  let reason: string | null = null;
  let mod: WorldgraphWasmModule | null = null;
  let bridge: RustWorldgraphBridge | null = null;
  let manifest: LevelManifest | null = null;
  let idByKey: ReadonlyMap<string, number> = new Map();
  let knownNodeIds = new Set<number>();
  let placements: Readonly<Record<string, Placement>> = {};
  let lastExport: string | null = null;
  let initMs: number | null = null;
  let generation = 0;
  let lastFlushMs = -Infinity;
  let batches = 0;
  const pending: Pending = new Map();
  const applied = new Map<string, string>();

  const fail = (why: string): SemanticStatus => {
    if (status === 'disposed') return status;
    ++generation; // an in-flight init must not later flip a failed projection to 'ready'
    status = 'unavailable';
    reason = why;
    pending.clear();
    try { bridge?.free?.(); } catch { /* already freed */ }
    bridge = null;
    return status;
  };

  const commandKey = (c: TwinCommand): string => (c.op === 'upsert_node' ? `n:${c.node.id}` : `e:${c.id}`);

  /** Apply commands in order, skipping byte-identical re-applies (idempotent replay). */
  const applyAll = (b: RustWorldgraphBridge, commands: readonly TwinCommand[]): void => {
    for (const c of commands) {
      const key = commandKey(c);
      const json = JSON.stringify(c);
      if (applied.get(key) === json) continue;
      b.applyMessageJson(json);
      applied.set(key, json);
    }
  };

  const snapshotCounts = (): { nodes: number; edges: number } => {
    if (!lastExport) return { nodes: 0, edges: 0 };
    try {
      const s = JSON.parse(lastExport) as { nodes?: unknown[]; edges?: unknown[] };
      return { nodes: s.nodes?.length ?? 0, edges: s.edges?.length ?? 0 };
    } catch { return { nodes: 0, edges: 0 }; }
  };

  const adapter: WorldgraphAdapter = {
    status: () => status,
    unavailableReason: () => (status === 'unavailable' ? reason : null),

    async init(input: LevelManifest): Promise<SemanticStatus> {
      if (status === 'disposed') return status;
      const gen = ++generation;
      const t0 = clock();
      status = 'loading';
      reason = null;
      const checked = validateManifest(input);
      if (!checked.ok) return fail(`manifest rejected: ${checked.errors.slice(0, 5).join('; ')}`);
      let commands: readonly TwinCommand[];
      try {
        const projection = buildStaticProjection(checked.value);
        commands = projection.commands;
        idByKey = projection.idByKey;
        placements = projection.placements;
      } catch (e) { return fail(`projection rejected: ${msg(e)}`); }
      const errors = validateCommands(commands);
      if (errors.length) return fail(`projection commands rejected before WASM: ${errors.slice(0, 5).join('; ')}`);
      try {
        const loaded = asWorldgraphModule(await loader());
        await loaded.default();
        if (gen !== generation) return status; // disposed or re-initialised meanwhile
        const fresh = loaded.WorldgraphBridge.empty();
        applied.clear();
        applyAll(fresh, commands);
        lastExport = fresh.exportRvfJson();
        mod = loaded;
        bridge = fresh;
      } catch (e) {
        if (gen !== generation) return status;
        return fail(`WorldGraph WASM unavailable: ${msg(e)}`);
      }
      manifest = checked.value;
      knownNodeIds = new Set(commands.flatMap((c) => (c.op === 'upsert_node' ? [c.node.id] : [])));
      initMs = clock() - t0;
      status = 'ready';
      return status;
    },

    enqueue(events: readonly WorldEvent[]): void {
      if (status !== 'ready' && status !== 'loading') return;
      for (const e of events) {
        if (!e || !isSemanticEvent(e)) continue;
        const bad = checkEvent(e);
        if (bad) { fail(`semantic event rejected: ${bad}`); return; }
        // Coalesce by story event type (one reserved derived state each); ordered log => last wins.
        pending.set(e.type, e);
      }
    },

    flush(nowMs: number): void {
      if (status !== 'ready' || !bridge || !manifest || pending.size === 0) return;
      if (!Number.isFinite(nowMs) || nowMs - lastFlushMs < minIntervalMs) return;
      lastFlushMs = nowMs;
      const batch: TwinCommand[] = [];
      try {
        for (const e of pending.values()) batch.push(...commandsForEvent(manifest, e, idByKey));
      } catch (err) { fail(`semantic event rejected: ${msg(err)}`); return; }
      pending.clear();
      // Nodes before edges so derived_from endpoints exist; order within each group is stable by id.
      const nodes = batch.filter((c) => c.op === 'upsert_node');
      const edges = batch.filter((c) => c.op === 'upsert_edge');
      const ordered = [...nodes, ...edges];
      const errors = validateCommands(ordered, knownNodeIds);
      if (errors.length) { fail(`semantic update rejected before WASM: ${errors.slice(0, 3).join('; ')}`); return; }
      try {
        applyAll(bridge, ordered);
        lastExport = bridge.exportRvfJson();
        for (const c of nodes) if (c.op === 'upsert_node') knownNodeIds.add(c.node.id);
        batches++;
      } catch (e) { fail(`WorldGraph WASM update failed: ${msg(e)}`); }
    },

    provenance(id: number): SemanticProvenanceView | null {
      if (status !== 'ready' || !bridge || !Number.isSafeInteger(id) || id < 1) return null;
      let card: unknown;
      // Generated binding: getProvenance(id: bigint) — Rust u64 direct parameter.
      try { card = bridge.getProvenance(BigInt(id)); } catch (e) { fail(`getProvenance failed: ${msg(e)}`); return null; }
      const c = card as { kind?: unknown; fields?: { key: string; value: string }[]; evidence?: unknown } | null;
      if (!c || c.kind !== 'semantic_state' || !Array.isArray(c.fields) || !Array.isArray(c.evidence)) return null;
      const field = (k: string): string | undefined => c.fields!.find((f) => f.key === k)?.value;
      const model = field('model_version');
      const calibration = field('calibration_version');
      const privacy = field('privacy_decision');
      if (!model || !calibration || !privacy) return null;
      return {
        // The card lists provenance.evidence then derived_from handles; the event handle appears in both.
        id, statement: field('statement') ?? null, evidence: [...new Set((c.evidence as unknown[]).map(String))],
        model_version: model, calibration_version: calibration, privacy_decision: privacy,
      };
    },

    canonicalDigest(): string | null {
      if (status !== 'ready' || !bridge) return null;
      try { return digestOfSnapshot(bridge.exportRvfJson()); } catch (e) { fail(`export failed: ${msg(e)}`); return null; }
    },

    exportSnapshotJson(): string | null {
      if (status === 'ready' && bridge) {
        try { lastExport = bridge.exportRvfJson(); } catch (e) { fail(`export failed: ${msg(e)}`); }
      }
      return lastExport;
    },

    importSnapshotDigest(json: string): string {
      if (!mod) throw new Error('WorldGraph WASM module not loaded');
      const bad = checkSnapshotJson(json);
      if (bad) throw new Error(`snapshot rejected: ${bad}`);
      const other = new mod.WorldgraphBridge(json);
      try { return digestOfSnapshot(other.exportRvfJson()); } finally { other.free?.(); }
    },

    receipt(): SemanticReceipt {
      const counts = snapshotCounts();
      const loaded = mod !== null;
      return {
        module: loaded ? 'worldgraph-wasm' : 'none',
        sourceCommit: loaded ? WASM_RECEIPT.sourceCommit : null,
        wasmSha256: loaded ? WASM_RECEIPT.wasmSha256 : null,
        initMs: status === 'ready' || loaded ? initMs : null,
        nodeCount: counts.nodes,
        edgeCount: counts.edges,
        status,
        reason: status === 'unavailable' ? reason : null,
      };
    },

    placements: () => placements,
    appliedBatches: () => batches,

    dispose(): void {
      ++generation;
      try { bridge?.free?.(); } catch { /* already freed */ }
      bridge = null;
      pending.clear();
      applied.clear();
      status = 'disposed';
    },
  };
  return adapter;
}

export const createSemanticAdapter: CreateSemanticAdapter = (options) => createWorldgraphAdapter(options);
