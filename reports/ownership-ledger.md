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
| W5 | audio/narrative worker | `src/audio/**`, `src/narrative/**`, `tests/audio/**` | 2 |
| W6 | validation worker | `tests/e2e/**`, `bench/**`, `scripts/audit-assets.mjs`, `scripts/bench-frame.mjs`, `reports/**` (except this ledger) | 3 |

Concurrent execution workers never exceed three.
