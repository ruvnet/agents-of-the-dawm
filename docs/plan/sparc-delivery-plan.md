# SPARC delivery plan for Agents of the Dawm: Floodline

Status: Proposed plan only  
Date: 2026-09-24  
Owner: Project coordinator

The repository was empty before this planning proposal. No game, engine, Sites deployment, or Ruflo swarm is claimed as implemented. Future execution follows the [SPARC methodology](https://github.com/ruvnet/ruflo) with the phase gates below, [ADRs](../adr/), [script](../creative/vertical-slice-script.md), and [swarm runbook](swarm-runbook.md).

## Objective, inputs, outputs, assumptions

Objective: prove an original, browser native gravity rescue loop that reaches a complete ending and can be hosted privately with Sites before any public release. The proof should demonstrate player value through meaningful traversal, readable action, and a causally clear WorldGraph repair, rather than through screenshot fidelity alone.

Inputs are the approved script and visual direction, Tidewater source as an MIT licensed technical reference, verified WorldGraph WASM source, the named browser/device test matrix, original/licensed assets with provenance, and a pinned Ruflo runtime for coordination. Outputs are a playable static Site, source and lockfile, deterministic replays, asset register, performance report, accessibility checks, and rollback instructions. All performance budgets below are hypotheses until measured.

Source reviewed for this proposal: Tidewater `1438b1abfcaee3267092b75573014f4d9b4a983c`, WorldGraph `9b1c79c836cdacfb7b44f058c593157bac4c1dab`, RuVector `5356a84e2f784a33fa497da2e73440d469eb5542`, and Ruflo `0a96fb8857dabd343d71d76c3ca703100a2923bc`. These are evidence snapshots, not committed game dependencies; choose and lock implementation versions after the browser spike and license review.

Assumptions: one district and one local player; no real sensor input, login, hosted inference, multiplayer, payment, or procedural generation; the game is functional offline after assets are cached only if later explicitly tested; the public GitHub repository is not itself a rights cleared product release.

## Specification gate

Freeze ADR 0001 through 0005 and a named desktop/mobile browser matrix before implementation. Every in scope requirement has an ID and a test or an explicit non goal. Establish an asset register before any media import. Define who can change an acceptance test, with the coordinator owning the test definitions and an independent reviewer approving edits to critical predicates.

| ID | Requirement | Evidence to collect |
| --- | --- | --- |
| P01 to P06 | Original scope, provenance, rescue, input, privacy, first public release localization | ADR 0001 release checks, rights register, and fr-CA playthrough |
| R01 to R05 | Cold load, frame pacing, fallback, quality, recovery | ADR 0002 browser traces |
| W01 to W04 | Graph roundtrip, authored provenance, optional WASM, failure | ADR 0003 contract checks |
| G01 to G06 | Gravity, deterministic replay, input, authorization, fallback, assist | ADR 0004 simulations and playthrough |
| O01 to O04 | Owned changes, gates, evidence, rollback | ADR 0005 and runbook |

Gate: no requirement without an evidence path or an explicit exclusion.

## Pseudocode gate

Freeze the `InputCommand`, `SimState`, `WorldEvent`, `RenderFrame`, and graph adapter contracts. Walk the successful and failed traces in ADR 0004. Verify tick ordering, idempotent events, shift rejection, checkpoint restore, graph load failure, duplicate authorization, and device loss. Keep the authored manifest authoritative for game safety; graph projections cannot silently invent evidence. Freeze a seeded replay fixture before combat balancing.

Gate: at least one full success trace and one recoverable failure trace preserve all invariants with explicit state transitions.

## Architecture gate

Select the renderer from a measured dual backend spike, and decide whether the experimental Three WebGPU renderer passes the WebGL2 parity gate. Keep simulation, render, graph, input, audio, storage, and Sites packaging behind explicit interfaces. Build WorldGraph WASM from a pinned source commit; retain an asset/software bill of materials. Treat RuVector WASM as an optional measured experiment, not a save or enemy AI dependency. Record reasons for rejecting a Tidewater wholesale fork and a WebGPU only launch. Review security boundaries: synthetic game fixtures, local saves, no external telemetry by default, and no arbitrary remote content in shader or asset paths.

Gate: architecture decision cites browser evidence and has a recovery path for a renderer or WASM failure.

## Refinement plan and estimates

These are rough engineering hours for a focused AI assisted team, excluding high fidelity original character production and voice recording. Reestimate from evidence at each gate.

| Increment | Inputs | Output | Planned validation | Estimate |
| --- | --- | --- | --- | --- |
| 0. Runtime spike | ADRs, named devices, source pins | Private one room Sites preview, fallback renderer, first load trace | WebGPU absent and WebGL2 browser reaches player control | 12 to 20 h |
| 1. Gravity slice | Frozen simulation contracts, simple meshes | Wall/floor anchor, camera, safe collision, checkpoint | G01, G02, shift failure playthrough | 24 to 40 h |
| 2. Story and combat | Script, original assets, graph schema | Seven beats, branches, keeper, graph authorization, sound and captions | S03, W01, G04, completeable route | 40 to 70 h |
| 3. Delivery | Feature complete slice, performance logs | Quality ladder, alternate input, rights register, private Site release | Full requirements trace, R01 to R05, G03 to G06 | 16 to 30 h |

Total engineering estimate: **92 to 160 hours** for the private English slice, excluding bespoke voice and character production. Budget an additional **8 to 16 hours plus human translation review** for fr-CA interface and subtitles before the first public release. Character animation and the experimental renderer may raise the slice estimate. The coordinator should not trade away a tested ending or fallback to add visual effects.

Each increment ends with a reviewed diff, reproducible commands, fixture/seed, named device results, source SHA, lockfile hash, and rollback point. Keep one writer per owned file. A failure stops promotion and returns to the relevant SPARC gate instead of being rephrased as a pass.

## Completion gate

Run simulation unit/property tests, build, dependency and asset provenance checks, browser input and fallback tests, cold load and frame traces, reduced motion/caption checks, and a complete seeded playthrough. An independent reviewer reproduces one WebGPU and one WebGL2 run from clean caches. Review actual transfer bytes and frame p50/p95 against named devices. Include an explicit exception with owner and mitigation for any failed target rather than silently lowering the target.

Publish a private Sites version only after the complete slice passes. Retain the previous source SHA and Site version for rollback. A public release needs a separate product and rights decision.

## Decision, next action, risk, acceptance

Decision: build a compact original rescue slice with a deterministic simulation, source built WorldGraph semantic adapter, and browser renderer fallback. Next action: approve or amend these proposed ADRs, then run Increment 0 with a pinned runtime. Principal risk: gravity camera/collision plus renderer parity may exceed the estimate; contain it with the one room spike before original art production. Acceptance: an unfamiliar player completes both branch choices and the final safe authorization on a WebGPU and WebGL2 browser with measured, repeatable evidence.
