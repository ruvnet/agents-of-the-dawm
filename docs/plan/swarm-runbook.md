# Ruflo SPARC swarm runbook

Status: Proposed plan, not an execution log  
Companion decision: [ADR 0005](../adr/0005-ruflo-sparc-governance.md)

## 1. Preconditions and roles

This runbook starts only after the planning ADRs and first source commit establish a nonempty `main`, a frozen `src/contracts/**` boundary, an implementation branch, and a reviewed lockfile. At the time of writing the target repository was empty; none of the commands below were run, no benchmark exists, and there is no Site to deploy or restore. For actual execution, first inspect `AGENTS.md`, `git status`, branch protection, existing worktrees, package scripts, and Ruflo state. Preserve user changes and never reset or delete a worktree just to clear a conflict.

The coordinator owns the scope, contracts, dependency changes, shared configuration, CI, task acceptance, integration, and the gated private Sites candidate. Three workers own disjoint directories. Ruflo records the coordination; host subagents perform file edits and tests in separate worktrees. Do not assume that `agent spawn`, `swarm init`, or a successful `hooks route` executes any project task. Keep GitHub merge and public-audience authority subject to repository governance; give no production credentials to game code or execution workers.

## 2. Ruflo command preflight, for the future implementation

The workflow pins the exact `@claude-flow/cli@3.44.0` release (npm `latest` on 2026-09-24, same version as the reviewed Ruflo source snapshot `0a96fb8857dabd343d71d76c3ca703100a2923bc`) in `tools/ruflo/`, separate from the game's own `package.json`. Do not substitute `@latest` at run time; a newer release needs its own tested pin change. Review the resolved package and transitive dependencies before running install scripts. Commit `tools/ruflo/package.json` and its package lock, then use the installed local binary throughout one run.

```bash
# Run later, from the game repository root, after package and lock review.
(cd tools/ruflo && npm install --save-dev --save-exact --ignore-scripts @claude-flow/cli@3.44.0)
./tools/ruflo/node_modules/.bin/claude-flow --version
./tools/ruflo/node_modules/.bin/claude-flow swarm init --help
./tools/ruflo/node_modules/.bin/claude-flow hooks route --help
./tools/ruflo/node_modules/.bin/claude-flow swarm init --topology hierarchical --max-agents 4 --strategy specialized
./tools/ruflo/node_modules/.bin/claude-flow swarm status
./tools/ruflo/node_modules/.bin/claude-flow agent list --all
```

If the local binary, expected flags, or pinned release is absent, stop and update this runbook with verified syntax. The fallback `npx -y @claude-flow/cli@3.44.0 ...` is appropriate only after package execution is reviewed and a local locked binary is not available. Do not use the removed CLI `task orchestrate`; some older files on Ruflo `main` still show it. Do not use CLI agent records as a substitute for real execution workers unless their provider credentials and execution semantics have been checked.

At each phase boundary, the coordinator may call `hooks route --task "specification: ..."`, then substitute `pseudocode`, `architecture`, `refinement`, and `completion`. A route is advice about role choice. Save its output with the phase artifact. It never overrides ownership, budgets, or gate results.

```bash
./tools/ruflo/node_modules/.bin/claude-flow hooks route --task "architecture: browser gravity simulation, WebGPU fallback and WorldGraph adapter"
./tools/ruflo/node_modules/.bin/claude-flow swarm status
./tools/ruflo/node_modules/.bin/claude-flow agent list --all
```

## 3. Ownership and task cards

Freeze the contract types in `src/contracts/**` before parallel implementation. The following paths are proposed, so the first commit must establish them before the commands in section 5 can run. The coordinator grants one worker one set of paths and records start commit, branch, dependencies, acceptance test, and due gate. Only the coordinator edits `src/contracts/**`, `package.json`, lockfile, build and hosting configuration, and `.github/**`.

| ID and owner | Inputs and assumptions | Outputs and exclusive paths | Validation to implement before acceptance |
| --- | --- | --- | --- |
| C0, coordinator | Approved requirements, story and references; contract shape can change before freeze | Versioned contract and acceptance fixtures in `src/contracts/**`, `docs/**`; source and test scripts in the shared package manifest | Typecheck the empty adapters, review requirement map, approve schema and one failure trace before workers branch. |
| W1, simulation worker | Frozen player action and world event contracts; fixed timestep and recorded seed | Gravity, collision, enemy behavior, checkpoints in `src/sim/**`; focused tests in `tests/sim/**` | `npm run test:sim`: seeded success/failure replay, orientation change, collision at wall/floor transition, restart from checkpoint, bounded input. |
| W2, renderer worker | Frozen frame events and scene interface; capability matrix named in Specification | Renderer, progressive asset loading, WebGPU and WebGL2 capability paths in `src/render/**`; focused tests in `tests/render/**` | `npm run test:render` and `npm run bench:frame`: device-loss behavior, renderer selection, captured p50/p95 frame time with device and preset receipt. |
| W3, graph/WASM worker | Frozen graph adapter contract and the verified source-level bridge methods in [ADR 0003](../adr/0003-worldgraph-wasm-and-ruv-integrations.md); pinned commit and actual browser build remain untested | Build/licensing spike and adapter in `src/world/**`, vetted WASM wrapper in `src/wasm/**`, focused tests in `tests/world/**` | `npm run test:world`: real bridge round trip, schema validation, missing module, offline manifest, malicious or malformed data, init-time receipt. No production dependency until verified. |
| C1, coordinator integration | W1/W2/W3 diffs and isolated test outputs; no overlapping modifications | Integrated branch, contract reconciliation, CI and build scripts | Review every diff and license record, run section 5 matrix and browser playthrough; reject undocumented interface changes. |
| W4, second wave UI and controls | Integrated interaction contracts and playable room | `src/ui/**`, `tests/ui/**` including keyboard, gamepad, touch, settings, captions and reduced-motion behaviors | `npm run test:ui`: restart/reconnect and accessibility checks on both renderer paths. Reassign one of W1/W2/W3 after first-wave integration; do not exceed three workers. |
| W5, second wave audio and narrative | Approved story script and event timings; no third-party asset without provenance | `src/audio/**`, `src/narrative/**`, `tests/audio/**` | `npm run test:audio`: mute/caption parity, event timing, autoplay-policy recovery; verify asset provenance. Reassign a worker after integration. |
| W6, independent validation worker | Fixed candidate commit and protected acceptance fixture version | `tests/e2e/**`, `bench/**`, evidence in `reports/**`; no edits to implementation | `npm run test:e2e`, `npm run bench:frame`, `npm run audit:assets`: reproduce completion, failure, fallback and performance on declared devices. |

Each actual task card must record: **ID, owner, objective, inputs, outputs, assumptions, exclusive file paths, dependency commit, exact test command, budget, handoff artifact, and blocking failures**. Example:

```text
ID: W1.GRAVITY.01
Owner: simulation worker in an isolated worktree
Inputs: C0 contract commit SHA; action event schema; seed 1047; a test room snapshot
Output: gravity transition and replay in src/sim/** and tests/sim/**
Assumption: transition uses one authoritative simulation clock
Acceptance: npm run test:sim succeeds and emits replay event/state summary
Failure: collision passes through wall, nondeterministic checkpoint, or contract edit
Handoff: candidate commit, test log, seed, unresolved failure list
```

Path ownership is a work assignment, not permission to change unrelated code. A worker needing a shared contract change sends a proposed diff to the coordinator, stops dependent implementation, and resumes from an updated frozen contract. Integrate W1, W2, and W3 only after their focused validations pass. Wave two starts from that reviewed integration commit.

## 4. SPARC phase sequence and stop conditions

1. **Specification:** Capture the 12 to 15 minute vertical slice, controls, target browsers, desktop/mobile reference devices, performance targets, file/asset budgets, original creative work, rights, offline behavior, and Sites release owner. Each requirement gets an acceptance ID. Stop if a required device or licensing constraint is unresolved.
2. **Pseudocode:** Trace startup, capability choice, graph load, gravity transition, encounter, death/checkpoint, final objective, and replay. Walk success and failure paths. Stop if a failed load or change in gravity can leave unhandled state.
3. **Architecture:** Freeze component contracts and file ownership; choose renderer, graphics fallback, deterministic simulation boundary, graph snapshot and WASM loading path. Record rejected options, trust boundaries, and rollback. Stop if a browser API or package export is only guessed.
4. **Refinement:** Work in source-bound increments: first a test room and fixed gravity transition, then renderer fallback, then graph integration, then combat, interface, audio and narrative. Run focused checks at every handoff and an integrated build after each merge. Stop a failing approach after two retries with no new evidence; create a smaller reproduction or switch to the recorded fallback.
5. **Completion:** Freeze a candidate commit, run the complete test and benchmark matrix, review security, licenses and assets, prepare the appropriate first-deployment or later-version recovery path, and review the requirements-to-evidence table. Then deploy and smoke-test the private Sites candidate under the Sites hosting workflow. Repository merge and any change to public audience follow separate governance. Stop if a protected test, visual path, or critical failure path is missing or altered to force a pass.

The proposed performance targets are p95 frame time at most 16.7 ms desktop and 33.3 ms mobile, plus first controllable frame within 20 seconds desktop and 30 seconds mobile at an emulated 50 Mbps with cold cache, per [ADR 0002](../adr/0002-browser-rendering-and-performance.md). Define exact device, route, throttling, quality level and sample window in Specification. Measure both WebGPU and WebGL2; do not average away the slower fallback or imply Tidewater performance measured on other hardware.

## 5. Planned verification and reproduction

Once the first implementation commit has defined these package scripts, run this sequence on the candidate source. The commands are contracts for future scripts, not executable checks today. CI must fail if a script is missing rather than silently skip it.

```bash
git status --short
git rev-parse HEAD
git diff --check
npm ci
npm run typecheck
npm run test:sim
npm run test:render
npm run test:world
npm run test:ui
npm run test:audio
npm run test:e2e
npm run audit:assets
npm run build
npm run bench:frame
```

Capture stdout and exit codes; a task status saying `complete` is not a test result. For frame benchmarks record at least 3 runs on each named target device and graphics backend, the same seeded route and preset, loading state, battery/power mode, browser and OS versions, GPU, source SHA, lockfile hash, graph snapshot version, WASM binary hash, asset bytes, raw frame times, p50/p95, and test failures. Compare a new candidate with a baseline at the same settings. For load time include cache condition and throttle configuration. For replay compare a seed's key events, checkpoint and final state with documented tolerance. Do a real player walk through on desktop and touch, including a room reset and browser refresh.

Minimum acceptance matrix: gameplay success and failure; gravity rotation at collision boundary; checkpoint corruption recovery; no WebGPU adapter; WebGL2 renderer; missing WorldGraph/WASM; graphics context loss; continued play after network loss once the needed assets are loaded; keyboard, gamepad and touch; audio muted; reduced motion; asset/license manifest. An offline reload test becomes a gate only after a separately approved precache or service-worker design with its own acceptance tests. Each row records test ID, baseline, candidate, result, raw trace, reviewer and exception owner. The coordinator rejects a worker's self-reported pass without independently readable evidence.

## 6. Integration and rollback

An implementation worker's branch produces a candidate PR, never a direct publish or automatic merge. The coordinator compares the diff to owned paths and acceptance fixtures, reviews supply chain changes, runs the integrated matrix, resolves contract conflicts, then publishes a private Sites candidate after the gates pass. Merge follows repository governance, and changing Site visibility to public requires a separate product and rights decision. No confidential service or live player data is required by the local game; a bundled world snapshot must remain usable without an external credential.

For a failed integration, revert the candidate commit or decline its PR, restore the prior contract and rerun the last green test matrix. For the **first private deployment**, no previous Site version exists. Before deploying, prepare a safe private holding build and verify the hosting withdrawal capability. If the candidate fails, disable or undeploy it if Sites supports that action; otherwise revert its source change and deploy the holding build. Record which action actually worked; do not claim to have rehearsed a nonexistent prior-version restore. For **later deployments**, retain the previous verified Site version ID, source commit and asset manifest, rehearse restoring that version, then promote the candidate. On a failure restore the previous version, revert the bad source change, retain the failing trace, and retest before another deployment.

## Sources

- [Ruflo AGENTS.md: ledger versus executor and source receipts](https://github.com/ruvnet/ruflo/blob/main/AGENTS.md)
- [Ruflo SPARC phases and route examples](https://github.com/ruvnet/ruflo/blob/main/.agents/skills/sparc-methodology/SKILL.md)
- [Ruflo swarm plugin: worktrees and roles](https://github.com/ruvnet/ruflo/blob/main/plugins/ruflo-swarm/README.md)
- [Ruflo CLI source package version, reviewed snapshot `0a96fb8`](https://github.com/ruvnet/ruflo/blob/0a96fb8857dabd343d71d76c3ca703100a2923bc/v3/@claude-flow/cli/package.json)
