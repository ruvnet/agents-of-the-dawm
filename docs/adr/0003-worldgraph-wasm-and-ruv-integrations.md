# ADR 0003: WorldGraph WASM and RuV integration boundaries

**Status:** Proposed, plan only  
**Date:** 2026-09-24  
**Decision owners:** Game architecture and browser runtime leads  
**Depends on:** The game's original creative direction, level manifest, and deterministic simulation ADRs

## Context and problem

The game needs an original, replayable district in which gravity changes the player's frame of reference. Its rescue depends on a pressure network with one **missing approved `reservoir → relief channel` connection**. The player finds the physical channel, verifies the fictional in-game presence sensor and capacity, restores that approval, and separately authorizes transfer. A semantic map should make rooms, passages, interactable objects, and authored events inspectable without making the rescue or browser combat depend on a sensor digital twin. WorldGraph has a real Rust to WebAssembly browser bridge, an ENU coordinate contract, and a tested example in RuLab. It models two dimensional room and zone footprints, doorways, wall segments, static anchors, people tracks, events, and provenance carrying semantic states. It does **not** supply collision, a three dimensional gravity surface, navigation mesh, an enemy, an articulated actor, a hydraulic pressure-route relation, or a deterministic combat simulation. [WorldGraph node and closed edge models](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [RuLab integration](https://github.com/ruvnet/worldgraph/blob/main/rulab/src/world/graph.ts) · [Story authority](../creative/vertical-slice-script.md)

The repository's published `worldgraphs` npm package is an **agent CLI**, not the browser graph runtime. The browser runtime is `worldgraph-wasm`, compiled from the WorldGraph source with `wasm-pack` and loaded as generated JavaScript plus `.wasm`. Source versions may differ from the published `worldgraphs` version. Pin a reviewed WorldGraph commit and build the module from that commit; do not resolve the runtime by installing `worldgraphs`. [Workspace packages](https://github.com/ruvnet/worldgraph/blob/main/Cargo.toml) · [npm package](https://github.com/ruvnet/worldgraph/blob/main/package.json) · [RuLab build steps](https://github.com/ruvnet/worldgraph/blob/main/rulab/README.md)

This ADR specifies an integration plan. It records no game implementation, benchmark result, or completed browser validation.

**Reviewed source snapshots on 2026-09-24:** [WorldGraph `9b1c79c836cdacfb7b44f058c593157bac4c1dab`](https://github.com/ruvnet/worldgraph/tree/9b1c79c836cdacfb7b44f058c593157bac4c1dab) and [RuVector `5356a84e2f784a33fa497da2e73440d469eb5542`](https://github.com/ruvnet/RuVector/tree/5356a84e2f784a33fa497da2e73440d469eb5542). These identify the evidence reviewed for this proposal. The implementation still must choose and lock its actual dependency commits, rerun API and security checks against them, and record any differences; links to `main` below describe the reviewed file paths but are mutable.

## Decision

Use **the game simulation as the sole authority** for movement, collision, gravity transitions, damage, AI state, progression, pressure route approval, authorization, and replay. Store the physical pipe and its initially absent **approved** edge in a versioned, deterministic **game pressure graph**. Use **WorldGraph WASM as a bounded semantic projection** of the authored district and selected simulation events. Author a versioned level manifest containing gameplay geometry, pressure nodes/routes, safety capacities, and semantic identifiers. Build or import a WorldGraph snapshot for semantic queries, inspectable relationships, and provenance. Keep those representations separate and check their shared IDs and coordinate transforms.

| Concern | Authority | WorldGraph projection |
| --- | --- | --- |
| Floor, wall, and ceiling collision; movement; gravity vector | Fixed step game simulation and collision assets | None. Room and wall nodes supply coarse semantic topology only. |
| Room, passage, and object identity | Versioned authored level manifest | `room`, `zone`, `doorway`, `wall`, and `object_anchor` nodes with stable IDs. |
| Door, gravity switch, encounter, and puzzle events | Append only deterministic event log | Bounded `event` nodes or authored `semantic_state` projections at semantic update cadence. |
| Enemy behavior and combat | Deterministic game state machine | Optional event summaries; never model an enemy as a sensed `person_track`. |
| Physical pipe, missing approved route, transfer previews, occupancy and capacity predicates | Authored deterministic game pressure graph plus simulation | An authored `semantic_state` with synthetic provenance can describe evidence and route-restoration events. No `pressure_route` WorldGraph edge exists. |
| Final control screen | Composed view of authoritative pressure graph and optional semantic projection | Provenance detail when ready; labeled manifest-backed authored evidence when WASM is unavailable. |
| Time travel, replay, and save | Simulation snapshot plus event log in browser storage | Regenerated graph projection; optional exported WorldGraph JSON for inspection. |
| Rendering and effects | Game renderer | Optional provenance or map overlay. No graph call in a shader or every rendered frame. |

The first playable slice must not require live sensing, a remote graph service, an embedding model, or a network connection after assets load. The presence sensor is a **fictional device in the authored game world**; its clear or occupied state is produced by a versioned game fixture and game simulation, not a real RF device or a validated occupancy model. WorldGraph's projection of those states must be identified as authored or synthetic; generated level states must not masquerade as observations of physical people or sensors. The final graph UI may show the fictional sensor and pressure routes as game evidence, but neither it nor release materials may claim real world sensing validation. [WorldGraph provenance schema](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [RuLab's authored graph projection](https://github.com/ruvnet/worldgraph/blob/main/rulab/src/world/graph.ts)

## Traceable requirements

These IDs match the WorldGraph portion of the [SPARC specification map](../plan/sparc-delivery-plan.md).

| ID | Requirement | Evidence |
| --- | --- | --- |
| **W01** | The authored pressure graph starts with a physical pipe and no approved `reservoir → relief channel` edge. Only verified game evidence and a deliberate restore action add that edge. WorldGraph projection and final combined UI agree with the simulation; round trip and rewind preserve stable IDs. | Fixture, success/failure traces, graph round trip, canonical game and semantic hashes. |
| **W02** | Every projected sensor/evidence/route state has explicit authored or synthetic provenance; no fictional presence result is passed off as real sensing. | Typed schema check, provenance inspector, language/content review. |
| **W03** | The target semantic architecture uses real source-built WorldGraph WASM in the browser. Its integration spike is mandatory; RuVector WASM remains an optional measured feature, never gameplay authority or persistence. If the WorldGraph spike fails, W03 is recorded as failed and any release without it needs the explicit exception below. | Browser module smoke test and generated-binding check, or documented failed gate and approved release exception; optional search comparison; direct IndexedDB restart test. |
| **W04** | WASM, imports, and optional modules fail explicitly. The final pressure UI still presents the three authored route previews and evidence from the validated manifest, and the safe rescue remains completable. | Fault injection plus complete fallback playthrough and intact save. |

## Architecture and interface contracts

### Runtime boundary

1. The loader imports the generated `worldgraph_wasm.js` and awaits its initializer before constructing a bridge. `WorldgraphBridge.empty()` starts a graph at the default registration; `new WorldgraphBridge(snapshotJson)` imports a WorldGraph snapshot. RuLab provides a source level loading pattern with explicit `loading`, `ready`, `unavailable`, and `disposed` states. Use a version pinned copy or a similarly thin adapter. [WASM bridge](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/bridge.rs) · [RuLab loader](https://github.com/ruvnet/worldgraph/blob/main/rulab/src/world/graph.ts)
2. The adapter receives **validated, ordered** semantic commands derived from the authoritative game event log. It uses `applyMessageJson` for the existing `TwinMessage` wire operations such as `{ "op": "upsert_node", "node": { ... } }` and `{ "op": "upsert_edge", "id": 1001, "from": 1, "to": 2, "edge": { ... } }`. The serialized node tag is `kind` and the edge tag is `rel`; never use an invented `type` tag or a new graph API. Add/remove operations must be idempotent under replay. [Bridge methods](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/bridge.rs) · [Message handling](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/core.rs) · [Existing upserts](https://github.com/ruvnet/worldgraph/blob/main/rulab/src/world/graph.ts)
3. The inspector can call `getAllNodes`, `getEdges`, `getProvenance(id)`, and `exportRvfJson()`. **Check the actual generated binding signature** for `getProvenance` before calling it: its Rust parameter is `u64`, and wasm-bindgen may expose that direct argument as JavaScript `bigint`, even though JSON-compatible returned IDs are plain numbers. A browser test must call it with a known ID using the generated TypeScript declaration's argument type; convert a validated safe numeric ID to `BigInt(id)` if that declaration requires it. Never assume the JSON serializer also governs direct scalar arguments. The latter export method returns the graph's **JSON snapshot string**; its name does not mean the game has produced a signed `.rvf` binary or a validated capture. The snapshot is not the authoritative gameplay save. WorldGraph's snapshot includes its schema version. [Bridge methods](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/bridge.rs) · [WorldGraph persistence](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/graph.rs)
4. Limit graph sync to semantic events and a bounded lower frequency, with a configurable maximum of 10 updates per second in the first performance spike. Coalesce repeated transforms by stable node ID. Fixed simulation ticks remain independent of WASM initialization, graph sync, rendering, and storage callbacks. Worker placement is an implementation experiment, not an assumed supported feature of this bridge.

### Pressure graph and final display contract

WorldGraph's `WorldEdge` is a closed enum: `observes`, `located_in`, `adjacent_to`, `supports`, `contradicts`, `derived_from`, and `privacy_limited_by`. None represents hydraulic connectivity, route approval, or capacity. **Never** encode `reservoir → relief channel` as a WorldGraph `pressure_route`, `adjacent_to`, or `supports` edge. The approved connection is an edge in the game pressure graph, where it can have domain-specific capacity and authorization rules. Use a provenance carrying `semantic_state` to report the authored verification and subsequent restoration. If a WorldGraph relationship is useful, use a schema-valid `derived_from` edge to its authored evidence/anchor and `located_in` only for spatial containment; do not infer pressure flow from either relation. [Exact edge variants](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [Script pressure-network view](../creative/vertical-slice-script.md)

```ts
interface PressureRoute {
  id: string;                 // stable game ID, e.g. 'reservoir-to-relief'
  from: string;
  to: string;
  physicalPipePresent: boolean;
  approved: boolean;          // false in the initial game fixture
  safeCapacity: boolean;      // calculated from bounded authored scenario data
}

type Destination = 'occupied-street' | 'protected-pump' | 'relief-channel';
interface RoutePreview {
  destination: Destination;
  occupied: boolean;
  projectedLoad: number;      // finite, nonnegative, scenario fixture
  safeThreshold: number;      // finite, nonnegative, same unit
  unit: 'kPa';                // fixed in the first slice; shown with both values
  safe: boolean;              // deterministic preflight, never UI-authored
  reason: string;             // stable localized reason from authored copy
  evidenceSource: {
    origin: 'authored-simulation';
    fixtureId: string;        // versioned fictional scenario, not live sensing
    eventId?: string;         // verified game event, where applicable
  };
}

interface FinalGraphView {
  pressure: Readonly<{
    routes: readonly PressureRoute[];
    previews: readonly RoutePreview[];  // exactly one for each destination
    selectedDestination: Destination | null;
    channelLocated: boolean;
    channelSensorVerified: boolean;
    channelEdgeRestored: boolean;
    playerAuthorized: boolean;
    capacityChecks: Readonly<{
      pumpWithinTolerance: boolean;
      streetUnoccupiedByFlow: boolean;
      reliefWithinTolerance: boolean;
    }>;
    capacitySafe: boolean;    // all required checks true for selected relief
  }>;
  semantic: { status: 'ready'; provenance: unknown } |
            { status: 'unavailable'; authoredEvidence: unknown };
}
```

The view composes the pressure graph and optional WorldGraph provenance by stable IDs. The validator requires **exactly three** unique previews with finite values, consistent units, a reason, and an authored/synthetic evidence source. Both numbers and the unit appear in the control screen, with text and shape as well as color. `safe` is derived from the game simulation, not accepted from an imported UI record. `gateOpen` implies `channelLocated && channelSensorVerified && channelEdgeRestored && playerAuthorized && capacitySafe`; `capacitySafe` for the selected relief route includes `pumpWithinTolerance && streetUnoccupiedByFlow && reliefWithinTolerance`. The occupied street and overloaded pump must show reasons and be rejected by deterministic preflight. The relief channel's approval edge can be restored only after its physical marker was inspected, its fictional sensor reports no people, and authored capacity is safe; a **separate** explicit input authorizes transfer. When WASM fails, the validated manifest and simulation still provide the final graph view, all preview values and reasons, route edit, and safe completion. Show an explicit semantic-detail-unavailable state and the authored evidence source, never a fabricated successful WorldGraph query. [Simulation and safety contract](0004-gravity-simulation-and-rescue-contract.md) · [Script](../creative/vertical-slice-script.md)

### Coordinate and identity invariants

WorldGraph stores metres in local East, North, Up: `{ east_m, north_m, up_m }`. The existing WorldGraph rendering bridge maps this to right handed Y up scene coordinates as:

```ts
const graphToScene = ({ east_m, north_m, up_m }: EnuPoint) =>
  [east_m, up_m, -north_m] as const; // scene x, y, z

const sceneToGraph = ([x, y, z]: readonly [number, number, number]) =>
  ({ east_m: x, north_m: -z, up_m: y });
```

Apply the same linear mapping to position offsets, velocities, directions, and surface normals. A gravity shift changes the player's simulated gravity vector and orientation **inside the fixed scene coordinate system**; it does not change the WorldGraph ENU registration. Test the inverse and handedness with exact fixtures. [ENU mapping and tests](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/enu.rs)

Assign a stable numeric ID to each authored semantic entity and relationship; persist the mapping in the level manifest and never derive it from draw order, array position, a WASM handle, or an allocator's next-ID value. `WorldId` and `WorldEdgeId` are Rust `u64`, while the bridge's **JSON-compatible return serializer** intentionally emits JavaScript numbers. Restrict browser assigned IDs to safe integers from 1 through `Number.MAX_SAFE_INTEGER`, reject duplicates, reserve disjoint ranges for static nodes, derived states, and edges, and preserve these IDs through rewind and reload. Direct `u64` method parameters are a separate generated-binding contract as noted above. [WorldGraph IDs](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [WASM serializer and direct provenance parameter](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/src/bridge.rs)

`room` and `zone` contain a two dimensional `bounds_enu` shape, not the full collision hull. `wall` is a coarse segment. Gravity walkable surfaces, occlusion, destructible geometry, and enemy cover therefore belong to the game manifest and collision assets. A graph node can reference an authored semantic object by ID but must not be interpreted as proof of a collision surface. [Node model](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs)

### Authored provenance

A `semantic_state` node needs `statement`, `confidence`, `valid_from_unix_ms`, and `provenance` with **all four** `evidence`, `model_version`, `calibration_version`, and `privacy_decision` fields. For authored fixtures, use source handles such as `ruv://agents-of-the-dawm/level/sector-01/manifest-v1`; mark `model_version` as an authored simulation schema, `calibration_version` as `fictional-scene-enu-v1`, and `privacy_decision` as `synthetic:no-personal-data`. The fictional in-game sensor may produce a statement such as `relief-channel clear in authored scenario`; the statement must not be presented as a physical sensor measurement. Record the approved-edge restoration as another semantic state **after** the game graph commits its real gameplay edge. Choose a deterministic synthetic epoch and label it as such. Do not use the real wall clock as evidence of simulated events. RuLab already applies a synthetic replay epoch and explicit authored provenance. [Schema](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [RuLab graph adapter](https://github.com/ruvnet/worldgraph/blob/main/rulab/src/world/graph.ts)

Treat authored graph input, imported saves, and local browser files as untrusted. Validate version, shape, byte count, finite coordinates, allowed node kinds, ID ranges, and maximum counts before sending JSON to WASM. Reject unknown versions and ambiguous imports. Never fetch arbitrary URLs named by a graph asset reference; the renderer owns an allowlist and content integrity policy. WorldGraph's `AssetRef` explicitly leaves network and integrity enforcement to the consuming renderer. [Asset reference](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/model.rs) · [RuLab import bounds](https://github.com/ruvnet/worldgraph/blob/main/rulab/README.md)

## Related RuV modules

| Module | Planned use | Constraint and gate |
| --- | --- | --- |
| `worldgraph-wasm` | Target and required spike for the **full semantic feature**; the authoritative game graph and rescue remain complete through manifest fallback. | Build from a pinned WorldGraph source commit with `wasm-pack`; load the actual binary in a browser, inspect generated `getProvenance` types, and exercise semantic round trip. A failed spike is a failed W03 gate, not a pass; public release without this module requires a documented exception and explicit signoff. Rust crate license is MIT OR Apache-2.0. [Crate](https://github.com/ruvnet/worldgraph/blob/main/worldgraph-wasm/Cargo.toml) · [license](https://github.com/ruvnet/worldgraph/blob/main/README.md) |
| `@ruvector/wasm` | Optional local similarity search for large inspectable lore or many authored encounter records, outside the action loop. | The current source implementation of `saveToIndexedDB` only logs and resolves; `loadFromIndexedDB` rejects as unimplemented. Its TypeScript wrapper also hardcodes cosine/HNSW at initialization, ignoring those supplied options. Do not depend on its persistence or advertised metric switching; require a built package smoke test and a justified latency/bundle advantage over a simple JS search. MIT license. [Rust implementation](https://github.com/ruvnet/RuVector/blob/main/crates/ruvector-wasm/src/lib.rs) · [TS wrapper](https://github.com/ruvnet/RuVector/blob/main/npm/wasm/src/index.ts) · [license](https://github.com/ruvnet/RuVector/blob/main/LICENSE) |
| `@ruvector/typesafe` | Optional later experiment for bounded offscreen text classification of authored player choices. | Version 0.1.0 documentation says default hash embedding is an uncalibrated test double; native binaries are not published and a WASM fallback is described. It is unsuitable as a promised adaptive enemy brain without a domain data set, calibration, browser packaging check, and frozen holdout. [Package status and API](https://github.com/ruvnet/RuVector/blob/main/npm/packages/typesafe/README.md) |
| `worldgraphs` CLI and Ruflo | Build time planning, agent tasks, review, and evidence gates only. | The npm CLI is not the WorldGraph WASM runtime. No agent process or model call is required inside the player's combat loop. [Package manifest](https://github.com/ruvnet/worldgraph/blob/main/package.json) |
| RuField | Out of scope for the playable slice. | Its README distinguishes deterministic synthetic simulation from unlabeled CSI file replay, and says other modalities remain synthetic. Do not advertise real world sensing in this authored game. [RuField README](https://github.com/ruvnet/rufield/blob/main/README.md) |

Keep the optional search and classifier behind explicit feature flags. Browser gameplay must remain complete when these modules are absent. Save and reload the authoritative simulation state through a game owned, versioned IndexedDB schema with bounded migrations and export/import validation. A successful RuVector search result must never override deterministic combat rules or grant network capabilities.

## Alternatives considered

1. **Put all gameplay in WorldGraph.** Rejected because its typed graph has no three dimensional collision, gravity walkable surface, enemy, or combat contract. Extending those types before proving gameplay increases schedule and schema risk.
2. **Use only a TypeScript level manifest.** A viable scope reduction if WASM fails the integration or frame budget gates. It preserves the complete game but gives up the Rust typed topology, provenance queries, and shared semantic model.
3. **Call a hosted WorldGraph service for every event.** Rejected for the first single player slice: latency, availability, spend, and governance complexity offer no measured gameplay value. The browser bridge already permits local execution.
4. **Make RuVector WASM persistence the save system.** Rejected because the current advertised persistence methods are stubs, as described above. Native IndexedDB remains the save authority.

## Failure handling and rollback

- If the WorldGraph module fails to load or rejects a command, freeze and mark the semantic projection `unavailable`, retain the last valid graph export for diagnosis, and keep the deterministic simulation running from the validated level manifest. Disable **WorldGraph-derived provenance details**, keep the full final pressure map and decision UI backed by the manifest and simulation, and identify the degraded semantic state. Do not silently claim graph execution.
- On repeated update failure, dispose the bridge; recreate it from a validated snapshot and replay the bounded semantic event log. Compare the canonical, ID-sorted semantic node/edge projection described below. If it or any graph invariant differs, turn the semantic feature off for that run. The game save and encounter completion never depend on the result.
- If WorldGraph makes frame pacing regress or enlarges the cold path beyond its budget, load it after first interaction or disable it behind a versioned feature flag. Retain a prior known good binary and manifest so a deployment can be reverted without migrating player saves.
- If RuVector WASM lacks a working published build, grows the shipped bundle disproportionately, or offers no measured advantage, remove the optional integration. Do not block release or substitute a hosted vector API without a separate privacy and cost decision.
- Save import failures must leave the current save untouched. Backup the previous valid state before schema migration and test restoration from both versions.
- A WorldGraph failure cannot be recorded as W03 passing. A candidate public release without it requires a named coordinator and independent reviewer to sign a versioned exception stating root cause, affected semantic/provenance UI, complete W01/W02/W04 fallback evidence, open remediation issue, source/Site rollback points, and the reason for accepting the limitation. Keep the exception visible in release evidence. Public release still needs its separate product and rights decision.

## Planned verification and acceptance

| Gate | Procedure and required result |
| --- | --- |
| Source and dependency | Pin exact reviewed repository commits and package versions; record licenses, bundled artifacts, and the source hash in CI evidence. No download of mutable `main` in the production build. |
| Wire and coordinates | Native `cargo test` for WorldGraph plus TypeScript contract tests over real `kind`, `bounds_enu`, `rel`, and ENU mappings. Reject unsafe IDs, invalid positions, unrecognized kinds, and missing provenance. Inspect the generated WASM TypeScript signature for direct `u64` arguments and call `getProvenance` successfully with a known stable ID in a real browser. |
| Actual browser WASM | Build with the pinned Rust target and `wasm-pack`; open the production game in desktop and mobile browsers with the **real** generated `.wasm`. Loading a mocked bridge does not pass W03. If the module fails, record W03 failure and test the documented manifest fallback; a public candidate needs the explicit release exception. |
| W01 graph and round trip | Start with a physical reservoir to relief pipe but no approved game graph edge. Verify sensor and capacity, restore **only** the game edge, export and reconstruct WorldGraph authored semantic states, replay, and rewind. Parse `exportRvfJson()` and compare a canonical projection of schema version plus semantic nodes sorted by `WorldId` and snapshot `WorldEdgeRecord` entries sorted by their stable edge IDs. Retain relevant kind, relationship, provenance, and game state fields; normalize numeric representation and exclude allocator counters, insertion order, and transient runtime metadata. `getEdges()` supplies endpoint/edge triples without the stable edge record ID, so use the exported snapshot for this digest. Use explicit stable IDs, or constrain and verify any allocator so it cannot affect projected IDs. The canonical semantic digest and independent gameplay state hash must agree for equivalent states, regardless of graph load timing. No WorldGraph edge uses a fabricated hydraulic relation. [Edge record schema](https://github.com/ruvnet/worldgraph/blob/main/wifi-densepose-worldgraph/src/graph.rs) |
| W02 provenance | Inspect the fictional sensor and restored-route semantic states: evidence points to the authored manifest and synthetic game event log; no UI, metadata, or release claim calls them measured physical occupancy. |
| W03 real module and optionality | Actual browser WASM smoke test and bounded performance spike pass. If optional RuVector search is included, fixed-vector search works in the bundle and a browser restart proves IndexedDB game saves independently. |
| W04 independence and recovery | Simulate missing WASM, malformed semantic update, a rejected imported snapshot, and unavailable optional RuVector module. The final UI still shows reservoir, protected pump, tram, occupied street, relief channel, all three route previews with occupancy, projected load, threshold, `kPa`, safe flag, reason, synthetic evidence source, the separate capacity checks, fictional sensor result, and a clear authored-source/degraded-semantic label. Unsafe routes stay rejected, explicit safe authorization opens the gate once, and existing saves survive. |
| Performance | On declared physical desktop and mobile devices, compare the same deterministic encounter with WorldGraph on and off. Set an initial candidate budget of at most **1 ms added desktop p95 frame time** and **2 ms added mobile p95 frame time** for a bounded scene of 100 nodes and 120 edges; measure initialization, heap, bundle bytes, and cold interaction separately. A software rendered CI pass is correctness evidence, not device FPS evidence. If the budget fails, defer graph initialization or disable runtime sync before shipping. [RuLab measurement caveat](https://github.com/ruvnet/worldgraph/blob/main/rulab/README.md) |
| Optional search | If tried, smoke test `@ruvector/wasm` insert and search with fixed vectors in the actual browser bundle, compare against a simple JS index, and verify saves independently with a browser restart. Never count its current `saveToIndexedDB` success response as durable persistence. |

**Exit criterion:** A reviewer can complete the encounter with and without WorldGraph WASM, restore the single missing approved edge **only** in the deterministic game pressure graph, inspect its synthetic WorldGraph semantic projection when available, see the same complete decision map and authored evidence when unavailable, and rewind and reload to identical authoritative simulation hashes. When available, the canonical ID-sorted semantic projection digest must also repeat. If the real WASM integration fails, W03 remains failed; a private fallback validation may proceed, while a candidate public release additionally needs the signed exception, complete fallback evidence, and separate product and rights decision. Never promote a mock or undocumented API as an implemented integration.
