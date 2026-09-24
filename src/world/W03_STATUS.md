# W03 status — WorldGraph WASM integration spike (W3.WORLD.01)

**Result: PASS for the source-built module in Node and in one headless Chromium smoke run.**
It is not yet a production-game browser pass: `src/main.ts` does not import `src/world` (see
CONTRACT_PROPOSALS P4), and no desktop/mobile device or frame-budget measurement was done.

## Binary provenance (src/wasm/pkg/RECEIPT.json)

| Field | Value |
| --- | --- |
| Source | https://github.com/ruvnet/worldgraph @ `9b1c79c836cdacfb7b44f058c593157bac4c1dab` (SHA checked by the build script) |
| Crate | `worldgraph-wasm` 0.3.1, license `MIT OR Apache-2.0` |
| Build | `wasm-pack build --release --locked --target web --no-opt` (binaryen off, as upstream: no unpinned download) |
| Toolchain | rustc 1.98.1 (48a229cea 2026-09-01), wasm-pack 0.14.0, wasm-bindgen 0.2.127 (from Cargo.lock), `RUSTFLAGS=""` |
| `worldgraph_wasm_bg.wasm` | 943,135 bytes, sha256 `a6e37742f1d8f638a32f15b596fcd8e8ae0fb0a71b39ebed6dcbd1471d0e0762` (identical across two builds and after Vite bundling) |
| `worldgraph_wasm.js` | 25,229 bytes, sha256 `ea8b7ea8e22f767a93bbb367e351264a13f1aa1fce47cc3dd8650dccb09cda86` |

The generated pkg is committed, so the game builds without Rust. Rebuild: `npm run build:wasm`
(`WG_TEST=1` also runs upstream tests). Host note: this machine exports
`RUSTFLAGS=-C link-arg=-fuse-ld=mold`, which rust-lld rejects on wasm32; the script clears it.

## Upstream native tests (`cargo test --locked` at the pin)

`-p wifi-densepose-worldgraph -p wifi-densepose-geo -p worldgraph-stream -p worldgraph-wasm`:
**56 passed, 0 failed** (15 + 8 + 10 + 7 + 16 across test binaries).

## Generated binding signatures (src/wasm/pkg/worldgraph_wasm.d.ts)

```ts
constructor(rvf_json: string);
static empty(): WorldgraphBridge;
applyMessageJson(json: string): void;
getAllNodes(): any;
getEdges(): any;
getProvenance(id: bigint): any;   // Rust u64 direct parameter -> JS bigint
exportRvfJson(): string;
nodeCount(): number;
removeNode(id: bigint): boolean;
export default function __wbg_init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
```

`getProvenance(1)` with a plain number throws; the adapter calls `getProvenance(BigInt(id))` after a
safe-integer check. Returned IDs are plain numbers (JSON-compatible serializer).

## Wire model used (from upstream model.rs / protocol.rs, nothing invented)

- Messages: `{ "op": "upsert_node", "node": {...} }`, `{ "op": "upsert_edge", "id", "from", "to", "edge": {...} }`.
- Node tag `kind`: `room {id, area_id, name, bounds_enu, floor}`, `zone {id, parent_room, name, bounds_enu}`,
  `wall {id, a, b, rf_attenuation_db}`, `doorway {id, center, width_m}`,
  `object_anchor {id, position, anchor_kind: reflector|furniture|uwb_beacon, confidence}`,
  `semantic_state {id, statement, confidence, provenance {evidence[], model_version, calibration_version, privacy_decision}, valid_from_unix_ms}`.
- `bounds_enu` tag `shape`: `rectangle {min_e, min_n, max_e, max_n}` / `polygon {vertices}` / `circle`.
- Edge tag `rel`; projected subset: `located_in {since_unix_ms}`, `adjacent_to {via_doorway}`, `derived_from {evidence}`.
  No hydraulic/pressure relation is ever emitted (validated before WASM and asserted on the export).
- Snapshot: `{schema_version: 2, registration, next_id, next_edge_id, nodes[], edges: [{id, from, to, edge}]}`.

## Test evidence

`npm run test:world` — **21 passed** (2 files; initMs varies per run, 17–25 ms observed).
Geometry assertions are data-driven over `geometry.zones`, so they hold after W1 replaces the starter
geometry; the digests below are a snapshot for the starter geometry only. Real-module tests load the built `.wasm` bytes with the
wasm-bindgen initializer (`default({ module_or_path: bytes })`); no mocked bridge counts toward W03.
Mocks are used only for failure injection.

```
[W03] initMs=17.31 nodes=40 edges=40          (Node, cold module compile + projection)
[W03] placements {"authored":7,"unplaced":32,"room-zone":1}
[W03] digest full=35ac9b3e0b8685b3 twoEvents=4982e14568c7901c
```

Covered: pinned SHA + wasm sha256 match; district projection; ENU footprint (`north = -z`) exact fixture;
edge rel set and stable IDs; `adjacent_to.via_doorway` from the authored doorway; five story events ->
`semantic_state` with all four synthetic provenance fields and `valid_from = epoch + round(tick*1000/60)`;
`getProvenance` with `bigint`; W01 replay idempotency; rewind (fresh adapter, different batching, same
digest); round trip export -> `new WorldgraphBridge(snapshot)` -> identical digest; malformed snapshots
rejected (pre-check and real WASM decoder); cadence at most 10 batches/s with coalescing; unsafe IDs,
NaN coordinates, unknown kinds and `pressure_route` rejected with the loader never called; W04 loader
failure, invalid module and injected update failure -> `unavailable` + reason, last export kept, final
view keeps the full pressure view plus labelled authored evidence; an invalid event enqueued during
loading makes `init` end `unavailable` (never `ready`).

`npm run test:contracts` — 8 passed. `npx tsc --noEmit` — clean.

## Browser smoke (scratch harness, not committed)

A throwaway Vite page (under gitignored `node_modules/.floodline-w3/`) that calls `createSemanticAdapter()`
with the **default browser loader** was built and opened in Playwright headless Chromium
(HeadlessChrome/140.0.7339.16): `status: ready`, initMs 17.7, 42 nodes / 42 edges after two events,
`provenance(10002)` returned all four synthetic fields, and digest `4982e14568c7901c`, identical to the
Node run of the same trace. No console errors.

## Vite

- `npx vite build` (game) succeeds, but it emits no WASM asset because nothing under `index.html`
  imports `src/world` yet (P4).
- A scratch build with `src/world/index.ts` as the input emits `assets/worldgraph_wasm_bg-*.wasm`
  (943.13 kB, gzip 203.54 kB, same sha256) and a lazily loaded 9.98 kB JS chunk.

## Known gaps

1. Starter geometry leaves 32 of 40 entities `unplaced` (labelled; see P1). Rooms without a zone get an
   empty polygon footprint, not invented bounds.
2. One directed `adjacent_to` per room pair (P2).
3. Not measured: device frame budget (ADR: at most +1 ms desktop / +2 ms mobile p95), heap, mobile browsers.
4. Recovery on repeated failure (dispose, recreate from snapshot, replay) is not automated. The adapter
   freezes as `unavailable` for the run and keeps the last valid export.
5. `.wasm` is unoptimised (`--no-opt`). With `WORLDGRAPH_WASM_OPT=1` it would be smaller, but wasm-pack
   would download binaryen without a pin.
