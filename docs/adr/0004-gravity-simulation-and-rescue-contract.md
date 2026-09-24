# ADR 0004: Deterministic gravity simulation and rescue contract

Status: Proposed  
Date: 2026-09-24  
Owners: Simulation lead and narrative systems lead  
Related: [ADR 0003](0003-worldgraph-wasm-and-ruv-integrations.md), [script](../creative/vertical-slice-script.md)

## Context and decision

Tidewater's [player controller](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/player/Player.js) is primarily first person and its [collision and walking code](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/world/Colliders.js) assumes vertical Y gravity. It cannot be turned into arbitrary surface traversal by changing a gravity sign. Build a new deterministic game simulation with authored anchor volumes, local up vectors, swept collision, third person camera, and a fixed tick. WorldGraph records the district's authored topology and evidence at story cadence. It does not decide contacts, movement, hit boxes, or damage.

At most one gravity anchor controls the player at a time. Each anchor advertises two allowed target orientations with visible glyphs and a safe landing volume. Shifts are authored transitions; the player cannot rotate gravity anywhere. The mechanical focus is traversal, positioning, and civic repair rather than a weapon copied from either reference. The player has a close range Pulse and a charge consuming Spike that pins a disabled machine or actuates a marked mechanism. Combat rules are deterministic and explainable; no model inference drives enemy decisions.

## Proposed contracts

`InputCommand` contains `tick`, `move2`, `look2`, `jump`, `pulse`, `spike`, `shiftAnchorId`, `interact`, and `pause`, independent of keyboard, gamepad, or touch. `SimState` contains seed, tick, player transform/velocity/local up/health/charge, anchor state, machine states, puzzle states, checkpoint, branch, `channelLocated`, `channelSensorVerified`, `channelEdgeRestored`, `playerAuthorized`, `capacitySafe`, and `gateOpen`. The approved hydraulic route is a game-specific graph edge in `SimState`, because WorldGraph's closed edge schema has no pressure route relation. A provenance carrying WorldGraph state projects the route change for inspection. `WorldEvent` carries stable ID, tick, type, and payload. `RenderFrame` interpolates two committed states and contains no authority to mutate simulation. The exact TypeScript types are frozen by the coordinator before workers edit dependent modules.

Run the simulation at 60 ticks per second with a bounded catchup count and deterministic seeded randomness. Render interpolation may vary with FPS. Record a replay as initial versioned state plus input commands and seed; compute a canonical state hash every checkpoint. Local IndexedDB persistence stores the versioned replay/checkpoint, never a raw WorldGraph WASM handle. WorldGraph graph IDs are stable authored IDs, not array indexes.

## State transition sketch

```text
tick(command):
  validate tick order and input bounds
  if paused: record no game action and return
  if shift requested:
    require player inside enabled anchor volume
    require destination is one of that anchor's authored surfaces
    sweep proposed player body and camera path against static/dynamic colliders
    on invalid result emit ShiftRejected and retain committed orientation
    otherwise commit local up, landing pose, camera transition and ShiftCommitted
  integrate input, gravity and kinematic contacts at the fixed tick
  resolve enemy telegraphs, Pulse/Spike, damage and puzzle interactions
  if physical channel marker inspected: set channelLocated once
  if in-world authored sensor checked and safe: set channelSensorVerified once
  if approved game pressure graph connection restored: set channelEdgeRestored once
  if player requests pressure transfer:
    require channelLocated and channelSensorVerified and channelEdgeRestored
    require capacitySafe from a preview of all three destinations
    require explicit interact on the verified relief channel
    then set playerAuthorized and gateOpen; emit GateOpened exactly once
  snapshot checkpoint when its predicate first becomes true
  publish discrete events to semantic graph adapter outside the physics step
```

The graphics layer can rotate the world for a no roll camera option. The physics up vector and landing collision remain the same regardless of visual camera treatment.

## Invariants and failure behavior

1. A failed or interrupted shift leaves the prior valid position, orientation, collision state, and resource totals intact. It never teleports through a wall.
2. One input command advances at most one simulation tick and cannot produce a second reward after replay or restart. Events are keyed by stable ID and tick.
3. All routes reconverge before the keeper. Upper route grants one overdrive cell; lower route slows surges. Neither route can remove required graph evidence.
4. The keeper never permanently blocks the tram. Zero health restores the current boss phase with full health and charges; a fall in the arena returns the player to a safe point with bounded damage.
5. `gateOpen` implies `channelLocated && channelSensorVerified && channelEdgeRestored && playerAuthorized && capacitySafe`. `capacitySafe` includes `pumpWithinTolerance && streetUnoccupiedByFlow` for the selected relief route. Only the player action changes `playerAuthorized`.
6. Difficulty and assist options may alter timing, aim forgiveness, damage, camera roll, and motion blur; they never bypass the graph and authorization predicate.
7. A missing WorldGraph WASM module or optional RuVector module cannot make a checkpoint unwinnable. The versioned authored manifest and deterministic simulation retain the same safety predicate; graph UI reports degraded semantic detail rather than inventing evidence.

## Walked traces

Successful trace: Tala enters a marked anchor, shifts to the inspection wall, reaches the service deck, disables two machines, exposes the physical relief channel, completes either route, defeats the keeper, verifies the fictional district's authored presence sensor, restores the missing approved game pressure route, previews three destinations, and explicitly authorizes the empty channel. The capacity predicate succeeds, `GateOpened` appears once, and four tram occupants escape.

Failure trace: a shift is requested outside the anchor or into an occupied landing. The engine rejects it and preserves the last safe state. Later a transfer request targets an occupied street or arrives before the sensor check. The UI displays its reason and `gateOpen` remains false. After the player restores the edge and selects the verified empty channel, the same save can complete without resetting the level.

## Acceptance plan

| ID | Test and evidence |
| --- | --- |
| G01 | Unit property test all authored anchor transitions for collision safety and valid local up |
| G02 | Seeded replay yields identical checkpoint hashes across 30, 60, and 120 render FPS and across rendering backends |
| G03 | Browser gamepad, keyboard, and touch commands produce equivalent normalized action traces |
| G04 | Authorization property test proves `gateOpen` cannot become true under any missing predicate or duplicate input |
| G05 | Simulated WorldGraph load failure still permits a truthful, completeable authored route |
| G06 | Reduced motion/no roll/assist settings leave story and authorization flags unchanged |

## Alternatives and consequences

Free rotation everywhere would multiply collision, camera, and level authoring risk without improving the first rescue. Anchor bounded gravity is chosen for legibility and testability. A general physics library may handle contacts if its local gravity and character controller meet G01 and G02; its name and version are selected in the spike, not assumed by this ADR. The rollback for a faulty anchor is a data flag reverting it to the last verified two surface configuration; saved games migrate to the nearest safe checkpoint.
