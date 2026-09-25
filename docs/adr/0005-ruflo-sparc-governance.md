# ADR 0005: SPARC gates and Ruflo swarm governance

Status: Proposed, planning only  
Date: 2026-09-24  
Decision owner: Project maintainer  
Scope: The future browser game and its Sites release process

## Context

`ruvnet/agents-of-the-dawm` was empty when this plan was written. There is no existing `AGENTS.md`, package lock, game implementation, CI, deployed Site, Ruflo state, or benchmark to preserve. This ADR defines the acceptance and ownership model before code is added. It is not evidence that Ruflo, the game, WorldGraph, or any WASM module has run.

The goal is an original, playable browser game with gravity changes, environmental combat, and a coherent short narrative. It draws on broad genre ideas while using independently created characters, places, art, sound, dialogue, and marketing. The implementation may evaluate techniques from the MIT-licensed [Tidewater repository](https://github.com/dgreenheck/tidewater), but copied code or assets require a separate provenance record and license review. The earlier playability targets, including desktop and mobile capability and a WebGL2 fallback, are requirements to test, not measured achievements.

[Ruflo's agent guide](https://github.com/ruvnet/ruflo/blob/main/AGENTS.md) describes Ruflo as a coordination ledger and the coding host as executor. Its [SPARC skill](https://github.com/ruvnet/ruflo/blob/main/.agents/skills/sparc-methodology/SKILL.md) names Specification, Pseudocode, Architecture, Refinement, and Completion. Some Ruflo documentation on `main` still illustrates `task orchestrate`; the validated workflow used for this plan marks that CLI command removed. Do not build a release process around it.

## Decision

1. Use SPARC as five review gates. Each phase leaves a versioned artifact with an owner, reviewer, date, and evidence. Routing suggestions can help select a worker but cannot change scope, grant access, or waive a gate.
2. Use a hierarchical Ruflo swarm with at most three execution workers and one coordinator. Ruflo keeps coordination state; platform workers in isolated Git worktrees produce code, tests, and evidence. One writer owns each file path at a time. The coordinator owns shared contracts and integration.
3. Pin `@claude-flow/cli@3.44.0` (the npm `latest` tag on 2026-09-24, matching the reviewed [Ruflo source `0a96fb8857dabd343d71d76c3ca703100a2923bc`](https://github.com/ruvnet/ruflo/blob/0a96fb8857dabd343d71d76c3ca703100a2923bc/v3/@claude-flow/cli/package.json)) exactly in the committed `tools/ruflo` package lock, kept separate from the game's lockfile, and prefer that local binary. The earlier plan named `3.25.6`; the maintainer chose the latest release, and the upgrade was made as its own change after rerunning the runbook preflight (`--version`, `swarm init`, `hooks route`) against 3.44.0. Recheck the pin for compatibility and security before any further upgrade; each upgrade needs its own tested change.
4. After the planned completion gates pass, deploy a private Sites candidate under the Sites hosting workflow and retain its version ID. Private candidate deployment is part of the authorized delivery path. Merge follows repository governance; changing the Site's audience to public requires a separate product and rights decision. A successful agent response, Ruflo task status, green unit tests, or an automated optimization score alone cannot waive those gates.

## Phase gates

| Phase | Versioned output | Gate and evidence |
| --- | --- | --- |
| Specification | Scope, player journey, input matrix, IP and accessibility constraints, non-goals, numbered requirements and tests | Every in-scope requirement maps to an observable test or a recorded exception. No performance number is represented as measured before a baseline exists. |
| Pseudocode | Input, gravity, movement, combat, checkpoint, save, and failure state transitions | Walk a successful room completion and a failed gravity transition through the same rules. Inputs remain bounded; death/retry does not corrupt a checkpoint; no render loop owns authoritative simulation state. |
| Architecture | Component contracts, source ownership, data flow, trust boundaries, build and host plan, decision alternatives | Freeze `src/contracts/**` before concurrent implementation. Record why the renderer, simulation, graph adapter, and WASM choices beat viable alternatives and how to reverse each choice. |
| Refinement | Small reviewed increments with per-worker diffs and tests | No overlapping writers; focused tests pass after each integration. Optimize only against a source-bound baseline on the same browser, device, quality setting, level, and seeded route. |
| Completion | Requirement-to-evidence matrix, build manifest, tests, browser traces, security and license review, version-appropriate recovery procedure | All critical success and failure paths pass; every exception has an owner. First private deployment has no prior version to restore; later deployments rehearse restoring the previous verified version. A human maintainer approves any public release after viewing the runnable candidate. |

## Invariants and trust boundaries

- The simulation advances on a fixed timestep with recorded input events and an explicit seed. Replay checks compare stable state and outcomes with documented numeric tolerances; identical pixel output or cross-platform floating point identity is not promised.
- Gravity changes have a finite transition state, defined collision and camera rules, and a reset path. A renderer failure cannot silently change the physics result. A failed WebGPU initialization moves to the tested WebGL2 path, or presents a recoverable capability message.
- The WorldGraph integration follows the source-level bridge contract in [ADR 0003](./0003-worldgraph-wasm-and-ruv-integrations.md). An implementation spike must pin its source commit and confirm the generated browser exports, schema version, binary provenance, and startup cost. The game can load a bundled, versioned world manifest when the WASM module is unavailable. Source documentation alone is not evidence of a working game build.
- Workers may read only the sources required for their task and write only their assigned paths. No secrets or privileged GitHub, Sites, or production tokens are passed to game code or worker task cards. Third-party assets and WASM binaries require recorded origin, version, license, and integrity information.
- An automated agent may propose changes and present evidence. It cannot rewrite protected acceptance fixtures, relax performance thresholds, approve its own security review, merge itself, or change a private Site's audience to public. The coordinator reviews diffs against the frozen contracts and can deploy the gated private candidate.
- A source-bound receipt records commit or immutable dirty-worktree snapshot, package lock hash, browser and GPU, test device, WebGPU or WebGL2 mode, graphics preset, seed, world snapshot and WASM version, benchmark scripts, and raw measurements. A `HEAD` value alone does not identify a dirty worktree.

## Alternatives considered

| Alternative | Delivery and operational tradeoff | Decision |
| --- | --- | --- |
| One generalist works serially | Lowest coordination cost, but slow feedback across graphics, physics, and graph integration | Keep as fallback if contracts remain unstable or independent work dries up. |
| Let Ruflo agent records execute and merge work | Appears faster but confuses ledger entries with actual implementation and gives weak provenance | Rejected. Use platform execution workers and a reviewing coordinator. |
| Larger mesh swarm | More nominal concurrency, more shared-file conflicts and integration overhead for one vertical slice | Rejected for initial delivery. Reassess after stable interfaces and observed throughput. |
| Three specialized workers plus coordinator | Some coordination and worktree cost, but parallel discovery and implementation with clear integration owner | Selected, capped at four concurrent roles. |

## Acceptance and failure policy

The proposed first playable slice is one complete district with a beginning, objective, failure/retry route, and ending. Target first controllable frame is at most 20 seconds desktop and 30 seconds mobile with a cold cache and emulated 50 Mbps; target p95 frame time is at most 16.7 ms on the agreed desktop reference and 33.3 ms on the agreed mobile reference, matching [ADR 0002](./0002-browser-rendering-and-performance.md). These are provisional gates until the device matrix, measurement script, and quality preset are frozen during Specification. Also test startup without WebGPU, loss/recovery of graphics context, unplugged controller, unavailable graph data, and repeated reload from a checkpoint. No claim of passing these gates is made here.

| Outcome | Required evidence | Evidence owner and decision |
| --- | --- | --- |
| O01: Owned changes | Task card names a worker, exact owned paths, input commit, and handoff; isolated worktree diff contains no writes outside those paths or concurrent writer overlap. | Coordinator compares every worker diff and ownership ledger before integration; rejects overlapping or unexplained edits. |
| O02: SPARC gates | Versioned Specification requirement map, Pseudocode success and failure traces, Architecture contracts and rejected options, Refinement increment tests, Completion requirement-to-evidence matrix. Every requirement has a passing test or explicit exception with owner. | Coordinator records phase decisions; independent reviewer checks Completion against protected acceptance fixtures. |
| O03: Reproducible evidence | Clean source commit or immutable dirty snapshot, lock and binary hashes, seeded replay, raw browser and frame traces, device/backend/preset manifest, exact test commands and exit codes; independent WebGPU and WebGL2 runs. | Independent validation worker produces receipts; coordinator reviews them and blocks promotion on missing or nonreproducible critical evidence. |
| O04: Private delivery and rollback | Successful private Site smoke test, candidate Site version ID and source commit; first deployment records and verifies withdrawal or safe holding-build replacement; later deployments include previous verified version/source ID and a restore rehearsal. | Coordinator deploys the gated private candidate under Sites hosting; maintainer controls repository merge and any change to public audience under repository governance. |

A failed phase gate blocks dependent tasks. After two retries without new evidence, pause that path, record the failure, and switch to a smaller reproduction or reversible design. A known critical input, security, save corruption, or browser fallback failure blocks private deployment. If the first private candidate fails, disable or undeploy it when supported; otherwise replace it with a prepared safe private holding build and revert its source change. On later releases, restore the previously verified Site version and source commit. Preserve the failing trace for diagnosis. A new baseline or threshold change requires a separate reviewed decision rather than retroactive reinterpretation.

## Consequences

The first implementation wave spends time on contracts, replay and metrics before visual polish. This should lower integration rework and keep frame-rate claims honest. The principal risk is that WorldGraph or a candidate WASM package lacks suitable browser exports or has prohibitive startup cost; the adapter and bundled snapshot make that risk testable before the main game depends on it. A second risk is that the validated CLI pin differs from current Ruflo development. The version and command preflight in the [swarm runbook](../plan/swarm-runbook.md) addresses that before runtime setup.

## References

- [Ruflo agent guide and execution boundary](https://github.com/ruvnet/ruflo/blob/main/AGENTS.md)
- [Ruflo SPARC skill](https://github.com/ruvnet/ruflo/blob/main/.agents/skills/sparc-methodology/SKILL.md)
- [Ruflo swarm plugin and worktree guidance](https://github.com/ruvnet/ruflo/blob/main/plugins/ruflo-swarm/README.md)
- [Ruflo CLI source package, reviewed snapshot `0a96fb8`](https://github.com/ruvnet/ruflo/blob/0a96fb8857dabd343d71d76c3ca703100a2923bc/v3/@claude-flow/cli/package.json)
