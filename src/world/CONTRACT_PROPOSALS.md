# W3 contract proposals (src/contracts is frozen; these are requests, not changes)

## P1 — authored semantic placement for non-room entities (manifest.ts `EntityDef`)

WorldGraph requires a position for `object_anchor` (`position`), `doorway` (`center`, `width_m`) and
`wall` (`a`, `b`). `EntityDef` carries none. The adapter currently resolves placement deterministically
from geometry keyed by entity key (interactables/anchors `entityKey`, decor/dynamics/machines `key`,
colliders for walls, zone overlap for doorways) and otherwise labels the entity `unplaced`
(degenerate footprint / ENU origin; object anchors get `confidence: 0`). With the starter geometry,
32 of 40 entities are `unplaced`.

Proposal (additive, optional, backwards compatible):

```ts
interface EntityDef {
  // ...existing fields
  /** Scene-space semantic point (object_anchor position, doorway centre). */
  readonly pos?: Vec3;
  /** Scene-space wall segment endpoints. */
  readonly segment?: readonly [Vec3, Vec3];
  /** Doorway opening width in metres. */
  readonly widthM?: number;
}
```

Alternatively W1 can close most of the gap without a contract change by authoring a `zones[]` entry
for every room and `entityKey` links on interactables/anchors/decor.

## P2 — reverse `adjacent_to` edges

WorldGraph documents room adjacency as an undirected pair stored as two directed edges. The manifest
reserves one edge ID per room pair, so the adapter projects one directed edge (`from → to`, with
`via_doorway` resolved from the authored `door-<from>--<to>` doorway key). Proposal: reserve a second
ID per pair in `ID_RANGES.edges` (e.g. `id + 100`) if bidirectional traversal queries are needed. The
adapter will not invent edge IDs.

## P3 — `gateOpen` in the final pressure view

`PressureView` has no gate flag, so the authored fallback reports the `gate-opened` state as
`established: null` (not reported). Adding `gateOpen: boolean` to `PressureView` would let the
fallback show it from the simulation.

## P4 — production bundle wiring (not a contract change)

`src/main.ts` does not import `src/world`, so `npx vite build` of the game does not yet emit the WASM
asset. Whoever owns `src/main.ts` / the UI should import `createSemanticAdapter` (lazily, after first
interaction per ADR 0003) and pass `composeFinalGraphView(...)` to the control screen.
