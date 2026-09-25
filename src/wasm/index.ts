/**
 * Typed wrapper around the generated `worldgraph-wasm` bindings in ./pkg (ADR 0003 runtime boundary).
 *
 * The generated pkg is excluded from `tsc` (see tsconfig); this file states the exact surface we use,
 * copied from the generated `worldgraph_wasm.d.ts` at source commit RECEIPT.sourceCommit:
 *
 *   constructor(rvf_json: string)
 *   static empty(): WorldgraphBridge
 *   applyMessageJson(json: string): void
 *   getAllNodes(): any
 *   getEdges(): any
 *   getProvenance(id: bigint): any        <- direct u64 parameter is a JS bigint
 *   exportRvfJson(): string
 *   nodeCount(): number
 *   free(): void
 *
 * Runtime shape checks narrow the untyped module before use; nothing here substitutes a JS graph.
 */
import receiptJson from './pkg/RECEIPT.json';

export interface RustWorldgraphBridge {
  nodeCount(): number;
  applyMessageJson(json: string): void;
  getAllNodes(): unknown;
  getEdges(): unknown;
  getProvenance(id: bigint): unknown;
  exportRvfJson(): string;
  free?(): void;
}

export interface WorldgraphBridgeCtor {
  new (rvfJson: string): RustWorldgraphBridge;
  empty(): RustWorldgraphBridge;
}

export interface WorldgraphWasmModule {
  /** wasm-bindgen `--target web` initializer; a no-op once the module is instantiated. */
  default(input?: unknown): Promise<unknown>;
  WorldgraphBridge: WorldgraphBridgeCtor;
}

export interface WasmBuildReceipt {
  readonly module: 'worldgraph-wasm';
  readonly sourceCommit: string;
  readonly wasmSha256: string;
  readonly wasmBytes: number;
  readonly jsSha256: string;
  readonly crateVersion: string;
  readonly crateLicense: string;
  readonly rustc: string;
  readonly wasmPack: string;
  readonly wasmBindgen: string;
  readonly upstreamCargoTest: string;
}

export const WASM_RECEIPT: WasmBuildReceipt = receiptJson as WasmBuildReceipt;

/** WorldGraph snapshot schema this build reads/writes (wifi-densepose-worldgraph SCHEMA_VERSION). */
export const WORLDGRAPH_SCHEMA_VERSION = 2;
/** Upper bound for an imported snapshot string (untrusted input, ADR 0003). */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** Narrow an untyped dynamic import to the surface above, or throw. */
export function asWorldgraphModule(mod: unknown): WorldgraphWasmModule {
  const m = mod as Partial<WorldgraphWasmModule> | null;
  if (!m || typeof m.default !== 'function' || typeof m.WorldgraphBridge !== 'function' ||
      typeof m.WorldgraphBridge.empty !== 'function') {
    throw new Error('invalid WorldGraph WASM module: missing default initializer or WorldgraphBridge');
  }
  const proto = m.WorldgraphBridge.prototype as Record<string, unknown>;
  for (const method of ['applyMessageJson', 'getAllNodes', 'getEdges', 'getProvenance', 'exportRvfJson', 'nodeCount']) {
    if (typeof proto[method] !== 'function') throw new Error(`invalid WorldGraph WASM module: missing ${method}`);
  }
  return m as WorldgraphWasmModule;
}

/** Browser loader: the generated JS resolves its .wasm via `new URL(..., import.meta.url)` (Vite emits it). */
export const loadWorldgraphWasm = async (): Promise<WorldgraphWasmModule> => {
  const mod: unknown = await import('./pkg/worldgraph_wasm.js');
  return asWorldgraphModule(mod);
};

/**
 * Validate an untrusted WorldGraph snapshot string before handing it to WASM:
 * byte cap, JSON shape, supported schema version, node/edge array bounds, safe integer IDs.
 * Returns an error string, or null when acceptable.
 */
export function checkSnapshotJson(json: unknown, limits = { maxNodes: 2000, maxEdges: 4000 }): string | null {
  if (typeof json !== 'string') return 'snapshot must be a string';
  if (new TextEncoder().encode(json).length > MAX_SNAPSHOT_BYTES) return `snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`;
  let v: unknown;
  try { v = JSON.parse(json); } catch (e) { return `snapshot is not JSON: ${(e as Error).message}`; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'snapshot must be an object';
  const s = v as Record<string, unknown>;
  if (s.schema_version !== WORLDGRAPH_SCHEMA_VERSION) return `unsupported snapshot schema_version ${String(s.schema_version)}`;
  if (!Array.isArray(s.nodes) || !Array.isArray(s.edges)) return 'snapshot nodes/edges must be arrays';
  if (s.nodes.length > limits.maxNodes || s.edges.length > limits.maxEdges) return 'snapshot exceeds node/edge limits';
  for (const n of s.nodes as unknown[]) {
    const node = n as Record<string, unknown> | null;
    if (!node || typeof node.kind !== 'string' || !Number.isSafeInteger(node.id) || (node.id as number) < 1) {
      return 'snapshot node missing kind or safe positive id';
    }
  }
  for (const e of s.edges as unknown[]) {
    const r = e as Record<string, unknown> | null;
    if (!r || !Number.isSafeInteger(r.id) || !Number.isSafeInteger(r.from) || !Number.isSafeInteger(r.to) ||
        typeof (r.edge as Record<string, unknown> | undefined)?.rel !== 'string') {
      return 'snapshot edge record malformed';
    }
  }
  return null;
}
