# Ownership ledger (ADR 0005 O01)

Contract freeze commit: recorded in each task card as the dependency SHA.

| Card | Owner | Exclusive write paths | Wave |
| --- | --- | --- | --- |
| C0 | coordinator | `src/contracts/**` (except geometry file below), `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `.github/**`, `tools/**`, `reports/ownership-ledger.md` | 0 |
| W1 | simulation worker | `src/sim/**`, `tests/sim/**`, `src/contracts/fixtures/sector-01.geometry.json` (documented exception: level geometry is simulation-tuned data) | 1 |
| W2 | renderer worker | `src/render/**`, `tests/render/**` | 1 |
| W3 | graph/WASM worker | `src/world/**`, `src/wasm/**`, `tests/world/**`, `scripts/build-worldgraph-wasm.sh` | 1 |
| C1 | coordinator | `src/main.ts`, `src/app/**`, integration fixes | 1→2 |
| W4 | UI/controls worker | `src/ui/**`, `tests/ui/**` | 2 |
| W5 | audio/narrative/save worker | `src/audio/**`, `src/narrative/**`, `src/storage/**`, `tests/audio/**` | 2 |
| W6 | validation worker | `tests/e2e/**`, `bench/**`, `scripts/audit-assets.mjs`, `scripts/bench-frame.mjs`, `reports/**` (except this ledger) | 3 |

Concurrent execution workers never exceed three.

## Coordinator integration edits in worker-owned paths (C1)

Each was made after the owning worker had handed off, so there were never two writers on a file at once. All commits share one git identity, so authorship is traced by commit rather than by author.

| Commit | Path(s) | Reason |
| --- | --- | --- |
| 131a7eb | `tests/render/fixtures.ts`, `tests/render/starter-geometry.json` | Pinned the synthetic render fixture to the frozen starter geometry after W1's district landed |
| aba9ffe | `src/sim/story.ts`, `src/world/fallback.ts`, `tests/world/*` | Contract v1.1 `PressureView.gateOpen` from W3 P3 |
| ed8048c | `src/ui/ui.ts` | `markStarted` for app-initiated starts; ending takes priority and the control screen steps aside after `gateOpen` (display only) |
| (this change) | `src/ui/ui.ts`, `src/ui/input/accumulator.ts`, `tests/ui/input.test.ts` | VR5 `clearFatal`; VR6 shift outside an anchor reaches the sim as a rejectable request |

Wave 3 cards: W7 (optimization) owns `src/sim/**` for performance only, plus `src/app/**`, `vite.config.ts` and `bench/perf/**`. W6 (validation) owns `tests/e2e/**`, `bench/frame/**`, the audit and bench scripts, and `reports/**`.
