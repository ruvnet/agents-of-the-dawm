# Requirement to evidence matrix (Completion gate, W6 independent validation)

- Candidate: `ed8048c` (`feat/floodline-slice`).
- Validated at: `w6-validate` `f7b5574` plus the final W6 commit. W6 changed no implementation code; `git diff ed8048c -- src index.html package*.json *.config.ts tsconfig.json` is empty.
- Environment for every browser result: headless Chromium 140.0.7339.16 (Playwright 1.55.0) with SwiftShader WebGL2 (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`). There is **no WebGPU adapter** (`requestAdapter()` returns null). The host is ruvultra, a shared machine that is **not a reference device**.
- Commands: `npm run test:e2e`, `npm run audit:assets`, `npm run bench:frame`, `npx vitest run` and the per-area `npm run test:*` scripts. Exit codes are in `reports/runbook-run.md`.
- Per-test facts: `reports/e2e/*.json`. Screenshots: `reports/e2e/screens/`. Playwright JSON: `reports/e2e-results.json` (gitignored and regenerated on every run).

Status key: **PASS** = the evidence meets the requirement as written. **PARTIAL** = part of it is proven and the rest is unmeasured or failing. **FAIL** = the evidence shows the requirement is not met. **NOT MEASURED** = no admissible evidence exists yet. **NOT DONE** = the work does not exist. **EXCEPTION** = would need a signed exception with a named owner.

## Summary

| Status | Count | IDs |
| --- | --- | --- |
| PASS | 11 | P02, P03, P05, R05, W01, W04, G01, G02, G04, G05, G06 |
| PARTIAL | 10 | P01, P04, R03, R04, W02, W03, G03, O01, O02, O03 |
| FAIL | 0 | None. R05 and the G01 real-input gap were fixed in f6ef94e and re-verified at 55cafc1 (see Resolution). |
| NOT MEASURED | 3 | R01, R02, O04 |
| NOT DONE | 1 | P06 (public-release item) |
| EXCEPTION | 0 | None granted. The FAIL and PARTIAL rows list the owner who would need one. |

That covers all 25 IDs: P01–P06, R01–R05, W01–W04, G01–G06 and O01–O04.

## Resolution (coordinator re-run at 55cafc1, all runbook gates exit 0, e2e 26/26)

Both failures below were fixed in `f6ef94e`: VR4 (fresh canvas on recovery), VR5 (`clearFatal`) and VR6 (a shift pressed outside an anchor reaches the sim and is rejected). The same unchanged tests now pass: `renderer-failure.spec.ts` "renderer recovers" (backend returns to webgl2 and ticks keep advancing after `loseContext`) and `real-input.spec.ts` (a real F press outside an anchor emits `ShiftRejected` with state intact). A real-GPU device loss is still untested; this is SwiftShader evidence only. The text below is the original W6 finding, kept for the record.

## Failures (reproducible, original W6 finding at ed8048c)

1. **R05: rendering does not recover after WebGL context loss.** Test: `tests/e2e/renderer-failure.spec.ts` › "R05 context loss: renderer recovers…". Evidence: `reports/e2e/r05-context-loss-recovery.json`.
   - **Repro:** open `/?demo=upper&speed=2`. After tick 300, run `document.querySelector('canvas#game').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`.
   - **What happens:** `errors()` records `device lost: Unknown reason`. `initRenderer('webgl2')` then reuses the *same lost canvas*, because `src/app/game.ts` replaces the canvas only when it once held WebGPU. That gives `webgpu-webgl2 failed: Cannot read properties of null (reading '0')` and `webgl2-classic failed: … (reading 'precision')`. `backend()` stays `'none'` and the fatal dialog appears.
   - Clicking **Retry** while the context is still lost fails the same way.
   - After `restoreContext()`, Retry brings `backend()` back to `'webgl2'`, but the **fatal dialog stays on screen** with the old error (VR5).
   - The simulation keeps ticking throughout, and the screen is never blank without explanation. The separate test "…simulation keeps running, screen never blank" passes.
   - Owners: C1 (`src/app/game.ts`) and W4 (`src/ui/ui.ts`). See VR4 and VR5 in `reports/validation-requests.md`.
2. **Real-input shift outside an anchor emits no `ShiftRejected`.** Test: `tests/e2e/real-input.spec.ts` › "Real input: F outside any anchor…". Evidence: `reports/e2e/real-input-failed-shift.json`.
   - **Repro:** press Play, then press F at spawn.
   - **What happens:** `src/ui/input/core.ts` sets `shiftAnchorId` to `state.player.anchorKey` (null outside an anchor), so no request reaches the simulation. No `ShiftRejected` is emitted and no feedback is shown. The state is intact: `up`, anchors, flags, health and charge are unchanged.
   - The simulation itself does reject such a request. Test "Sim boundary: …" passes, evidence `reports/e2e/sim-failed-shift.json`.
   - This contradicts the task card's assertion and the ADR 0004 failure trace, where the engine rejects the request. ADR 0004 invariant 1 (state intact) holds.
   - Owners: W4 or W1, decision VR6.

## Matrix

| ID | Requirement (short) | Status | Evidence | Exception or next owner |
| --- | --- | --- | --- | --- |
| P01 | 12–15 min completable district | **PARTIAL** | `demo-routes.spec.ts`: both routes reach `gateOpen`, `playerAuthorized`, `channelEdgeRestored` and `tramCrossed` with 0 app, page or console errors (`reports/e2e/demo-upper.json`, `demo-lower.json`). Unit: `tests/sim/playthrough.test.ts`. **Not assessed:** "unfamiliar player finishes without developer intervention", and the 12–15 minute pacing. A bot at 8× speed cannot judge pacing; at 1× the scripted route takes ~61 s of play because the bot skips all dialogue pauses. **A human playtest is required.** | Coordinator: schedule a human playtest. |
| P02 | Rights provenance, zero unknown | **PASS** | `npm run audit:assets` exited 0, `reports/asset-register.json`. The only binary asset is the WorldGraph wasm (sha256 `a6e37742…0762`, MIT OR Apache-2.0, `ruvnet/worldgraph@9b1c79c`, compiled unmodified, per RECEIPT). It is identical in `src/` and `dist/`. Inline or procedural content (logo SVG, WebAudio, geometry, system fonts) is declared. Runtime dependency `three@0.186.1` is MIT. There are 0 absolute URLs in first-party runtime source. | A human rights review is still needed before a public release (ADR 0001). |
| P03 | Map repair drives rescue | **PASS** | Unit: `tests/sim/authorization.test.ts` (G04 fuzz, 2000+ sequences). Browser: `control-screen.spec.ts` G04 test, where the gate opened only after scan, three previews, restore and a relief authorize (`reports/e2e/g04-control-screen.json`, screenshot `control-screen-open.png`). Both demo routes: `GateOpened` exactly once. | — |
| P04 | Accessible alternate input | **PARTIAL** | Passing tests in `accessibility.spec.ts`:<br>• reduced motion from `prefers-reduced-motion` (`.fl-reduced-motion`, setting checked)<br>• captions toggle (0 captions rendered while off, dialogue still logged; restored when on)<br>• 200 % text scale (font 16 → 32 px, no clipping at 1280×720)<br>• keyboard-only walk with a visible 3 px amber focus ring at every stop and focus trapped in settings<br>• touch 390×844 (touch layer visible, 6 buttons, virtual stick moved the player 4.7 m)<br>Real keyboard WASD+F: `real-input.spec.ts`. Remap, gamepad and aim assist: unit tests only (`tests/ui/input.test.ts`, `settings.test.ts`). **Not tested in a browser:** gamepad, remap round trip. Failure 2 (no feedback for F outside an anchor) is a feedback gap. | W4: browser gamepad check (needs a virtual pad), VR6. |
| P05 | Local privacy | **PASS** | `privacy.spec.ts`: during a full demo there were 6 requests, all `GET` from the same origin: `/`, `/assets/index-*.js`, `/assets/index-*.css`, `/assets/three.webgpu-*.js`, `/assets/worldgraph_wasm-*.js` and `/assets/worldgraph_wasm_bg-*.wasm`. There were no other origins, beacons, pings, websockets or `sendBeacon` calls; 1,403,872 bytes in total. Evidence: `reports/e2e/p05-privacy.json`. | — |
| P06 | fr-CA public release | **NOT DONE** | There is no fr-CA locale (`UiSettings.locale: 'en'` only) and no human translation review. This is a public-release item, outside the private slice. | Coordinator or creative lead, before any public release. |
| R01 | First controllable frame ≤ 20 s desktop / 30 s mobile, 50 Mbps cold | **NOT MEASURED** | There are no reference devices. SwiftShader localhost data only (`reports/bench-frame.json`): cold unthrottled 180–187 ms; cold at 50 Mbps with 20 ms latency (CDP) 299–305 ms; 456,520 bytes transferred before control. The wasm is fetched only after Play. **Not admissible for R01.** | Performance reviewer: run on named devices. |
| R02 | p95 ≤ 16.7 ms desktop / 33.3 ms mobile | **NOT MEASURED** | SwiftShader only, 3 runs per path, upper route, seed 1047, quality auto→medium, 1280×720. WebGPURenderer(WebGL2): pooled p50 33.3 ms, p95 50.0 ms (5,070 frames). Classic WebGLRenderer: p50 16.7 ms, p95 33.4 ms (8,578 frames). Host load average was 18–25 during the runs. `renderer.stats()` was not reachable (VR2). This run was a ~61 s route, not the ADR's 5 min replay. Headless Chromium paces rAF to a 60 Hz BeginFrame, so every interval is a multiple of 16.67 ms. The figures therefore count vsync periods per frame, not render cost; `renderer.stats().cpuFrameMs` (VR2) is needed for render cost. **Not admissible for R02**, but the 2× gap between paths deserves a look on real hardware. | Performance reviewer and W2. |
| R03 | WebGPU and forced WebGL2 give identical hashes | **PARTIAL** | `determinism.spec.ts`: final hash `eb7b397c34004556` at tick 4000 is identical for WebGPURenderer(WebGL2) in the auto and setting=webgl2 variants, for classic WebGLRenderer, and for the headless Node reference. All ~30 sampled ticks match (`reports/e2e/r03-cross-backend.json`). The path is identified by the getContext call stack (VR1). Classic is reached only through a test stub (VR3). **WebGPU was not testable on this host.** | Independent reviewer: one WebGPU run on real hardware (O03). |
| R04 | Quality change doesn't alter ticks or ending | **PARTIAL** | Quality presets low and high (set in the start-screen UI) give the same hashes as the reference (`determinism.spec.ts` R04 variants). The adaptive governor runs in every variant. Unit: `tests/render/quality.test.ts`. A **forced shift in the middle of a run** was not exercised: the only runtime control is the UI, which needs a pause, and in demo mode the autopilot is sampled while paused. | W6 follow-up once a hook exists (VR2 or VR1). |
| R05 | No indefinite blank screen or unrecoverable error | **PASS** (headless; fixed f6ef94e) | Pass: no WebGPU adapter leads to WebGL2 and controllable readiness (`r05-no-webgpu.json`); no graphics context leads to an actionable fatal screen with Retry and Use WebGL2 buttons (`r05-fatal-no-context.json`); after context loss the error is recorded, play continues and the screen is never blank; a missing optional wasm is handled (W04). **Fail:** rendering does not recover after context loss (Failure 1). | C1 and W4 (VR4, VR5). An exception would need the coordinator's signature. |
| W01 | Game edge only; round trip and rewind keep IDs | **PASS** | `tests/world/worldgraph.real.test.ts` with the real wasm in Node: replay idempotency, rewind digest, export→import round trip, edge relation whitelist. `tests/contracts` rejects hydraulic relations. Browser: `EdgeRestored` only after evidence (`g04-control-screen.json`). The browser-side canonical digest is not observable (VR8). | — |
| W02 | Explicit authored/synthetic provenance | **PARTIAL** | Unit: semantic_state nodes carry four provenance fields (`worldgraph.real.test.ts`), and a control VM test covers them. Browser: the control screen says "Fictional in-world sensor: authored/synthetic game evidence, not real sensing" and "no live sensing" (`w04-wasm-unavailable.json`). **Not done:** human language and content review. | Creative lead. |
| W03 | Real source-built WorldGraph wasm in browser | **PARTIAL** | The real wasm is fetched and `semanticStatus()==='ready'` in every browser demo (`demo-*.json`, P05 log). Binary sha256 matches RECEIPT (audit, and `worldgraph.real.test.ts` in Node, including the `getProvenance(bigint)` call). **Not done:** the `getProvenance` call in a browser, the in-browser init-time receipt (VR8), and the ≤1 ms / 2 ms p95 budget on reference devices. | W3 or C1 (VR8); performance reviewer. |
| W04 | Explicit wasm failure; authored UI; rescue completes | **PASS** | `control-screen.spec.ts` with `**/*.wasm` aborted: status `unavailable`. The control section has class `is-unavailable` and shows "Semantic detail unavailable — authored evidence". All three routes show kPa, occupancy and reason. An unsafe authorize is rejected; the safe authorize gives `GateOpened` once and the tram crosses (`w04-wasm-unavailable.json`, screenshot `control-screen-wasm-unavailable.png`). The demo with wasm blocked also completes (`w04-demo-wasm-blocked.json`). Unit: `tests/world/fallback.test.ts`. | — |
| G01 | Anchor transitions collision safe | **PASS** (VR6 fixed f6ef94e) | Unit: `tests/sim/gravity.test.ts` covers every anchor, both directions, blocked landings and out-of-volume requests, all PASS. Browser: the real WASD+F shift commits (`real-input-shift.json`: `ShiftCommitted`, up `+y`→`-z`). A request that reaches the sim outside an anchor is rejected with state intact. Failure 2 (real input never makes the request) is a spec mismatch on the failure trace. | W4/W1 (VR6). |
| G02 | Seeded replay identical across FPS and backends | **PASS** | Unit: 30/60/120 FPS drivers (`tests/sim/determinism.test.ts`, `tests/app/app.test.ts`). Browser: the demo hashes equal the headless Node reference at every sampled tick for both routes (`demo-*.json`, `hashComparison.mismatches = []`), across both WebGL2 renderer paths and quality presets (R03/R04). Save→Continue restores the exact `stateHash` (`save-continue.json`). | WebGPU leg as in R03. |
| G03 | Keyboard, gamepad and touch give equivalent traces | **PARTIAL** | Unit: `tests/ui/input.test.ts` "keyboard == gamepad == touch". Browser: keyboard (real-input) and touch stick (390×844) move the player. Gamepad was not tested in a browser. | W4. |
| G04 | gateOpen impossible without all predicates or with duplicates | **PASS** | Unit fuzz (`authorization.test.ts`). UI boundary: `control({kind:'authorize'})` for the occupied street or the protected pump is rejected both before and after the evidence is complete. Relief before scan is rejected. Relief authorized twice gives one `GateOpened` (`g04-control-screen.json`). | — |
| G05 | WorldGraph load failure still completable and truthful | **PASS** | Same evidence as W04. | — |
| G06 | Reduced motion and assists leave story and authorization unchanged | **PASS** | Unit: "identical flags, routes and story events with every assist enabled" (`encounters.test.ts`). Browser: the `prefers-reduced-motion` demo matches the default-motion reference hashes at all 30 sampled ticks (`p04-reduced-motion.json`). | — |
| O01 | Owned changes, no unexplained writes | **PARTIAL** | See "O01 history check" below. Every worker feature commit stays inside its ledger paths. The coordinator made integration edits inside worker paths, and all commits share one git identity. | Coordinator: record the integration-fix edits in the ledger. |
| O02 | SPARC gates, requirement→evidence matrix | **PARTIAL** | This matrix is the Completion artifact. Architecture and contracts: ADRs and `src/contracts/**`. Contract proposals: `src/*/CONTRACT_PROPOSALS.md`. Independent reviewer sign-off and phase decision records were not observed. | Coordinator and independent reviewer. |
| O03 | Reproducible evidence with receipts | **PARTIAL** | Source SHA, lockfile sha256 (`f121566e…6d49`), wasm sha256, browser, GPU string, seed, preset, raw frame intervals and exit codes are all recorded (`bench-frame.json`, `reports/e2e/*.json`, `runbook-run.md`). There is **no independent WebGPU run and no named reference devices.** | Performance reviewer. |
| O04 | Private delivery and rollback | **NOT MEASURED** | No Sites deployment exists on this branch. It is outside W6's write scope. | Coordinator. |

## O01 history check

Command: `git log --format='%h %p | %an | %s' --name-only ffdf270..ed8048c`, compared with `reports/ownership-ledger.md`.

**Worker feature commits stay inside their ledger paths:**

| Commit | Worker | Paths touched |
| --- | --- | --- |
| `0acb7bb` | W1 | `src/sim/**`, `tests/sim/**`, and the documented geometry fixture exception |
| `8c94c66` | W2 | `src/render/**`, `tests/render/**` |
| `b738b6a` | W3 | `src/world/**`, `src/wasm/**`, `tests/world/**`, `scripts/build-worldgraph-wasm.sh` |
| `be57983`, `cce13d5` | W5 | `src/audio/**`, `src/narrative/**`, `src/storage/**`, `tests/audio/**` |
| `e8f50a8` | W4 | `src/ui/**`, `tests/ui/**` |

The merges `32ab75c`, `dd6bc90`, `f244ac1`, `969e9a2` and `06c9774` introduce no other paths.

**Fix commits on worker branches before merge:** `b3b0e1b` (sim), `0272743` (render), `423772c` (world) and `79e39a1` (ui). Each stays inside its worker's paths. Their authorship cannot be told apart, because **every commit uses the same git identity (`ruv <ruv@ruv.net>`)**. The ledger therefore cannot be checked against authorship; only against paths.

**Coordinator integration edits inside worker-owned paths** (these are not in the ledger):

| Commit | Worker path touched | Change |
| --- | --- | --- |
| `aba9ffe` (contracts v1.1) | W1 `src/sim/story.ts` | +1 line: `gateOpen` in `pressureView` |
| `aba9ffe` | W3 `src/world/fallback.ts` | 1 line |
| `aba9ffe` | W3 `tests/world/fallback.test.ts`, `tests/world/helpers.ts` | +1 line each |
| `131a7eb` | W2 `tests/render/fixtures.ts`, new `tests/render/starter-geometry.json` | test fixture pin |
| `ed8048c` | W4 `src/ui/ui.ts` | +10/−1: `markStarted` for demo/autostart |

`816e3be` (the C0 scaffold) also created `src/ui/styles.css` (later W4-owned) and the placeholder `scripts/audit-assets.mjs` and `scripts/bench-frame.mjs` (W6-owned). These are scaffold-only.

## Human playtest note

The 12–15 minute pacing target (ADR 0001 P01, `docs/creative/vertical-slice-script.md`) and "an unfamiliar player completes without developer intervention" are **not assessed by a bot**. The demo autopilot completes both routes in 3,800–4,000 ticks (~61–67 s of simulated play at 1×) because it skips exploration and dialogue pauses. It proves completability and determinism, not pacing or legibility. A human playtest on desktop and touch is required, including a room reset and a browser refresh (runbook section 5).

## Additional findings (not requirement failures)

- `npm audit`: 2 high dev-dependency findings (`playwright <1.55.1`, GHSA-7mvr-c777-76hp). Fixing them needs a coordinator pin change.
- `window.__floodline.control()` is silently a no-op in `?demo` mode (VR7).
- Under heavy host load, a real-time key hold can overshoot small interaction radii (seen in the harness). This does not affect the product at human input rates, but tests must re-check position.
