# Runbook section 5 run

## Coordinator re-run at 55cafc1 (current candidate)

This re-run covers the merged waves 1 to 3, the fixes in f6ef94e, and the bench chunk-detection fix committed with this report. The e2e suite and the bench run under Playwright 1.55.1 with chromium-1193 (SwiftShader, no WebGPU adapter). Per-command logs are `reports/runbook-logs/<command>.log`, and the exit codes are in `reports/runbook-logs/exit-codes.tsv`. The earlier W6 logs in that directory, from the first candidate, are kept.

| Command | Exit |
| --- | --- |
| `git diff --check HEAD~1` | 0 |
| `npm ci` | 0 |
| `npm run typecheck` | 0 |
| `npm run test:contracts` | 0 |
| `npm run test:sim` | 0 |
| `npm run test:render` | 0 |
| `npm run test:world` | 0 |
| `npm run test:ui` | 0 |
| `npm run test:audio` | 0 |
| `npm run test:app` | 0 |
| `npm run test:e2e` | 0 |
| `npm run audit:assets` | 0 |
| `npm run build` | 0 |
| `npm run bench:frame` | 0 |

Results: e2e 26/26 passed. Unit tests pass across contracts, sim, render, world, ui, audio and app. Asset audit: 0 unknown entries and 0 external runtime URLs. The frame bench is SwiftShader only and is not reference-device evidence.

## Original W6 run at ed8048c


- Runner: `bash reports/runbook-logs/run.sh`. It runs each command with a 2400 s timeout, continues after a failure, and saves each step's stdout and stderr to `reports/runbook-logs/<step>.log`. The machine-readable results are in `reports/runbook-logs/exit-codes.tsv`.
- Source: `f7b5574` on branch `w6-validate`. That is candidate `ed8048c` (`feat/floodline-slice`) plus W6 test, bench and report files only. `git diff --stat ed8048c f7b5574 -- src index.html package.json package-lock.json` is empty.
- Host: ruvultra, a shared workstation with 32 threads (AMD Ryzen 9 9950X) and 123 GiB RAM. Other sessions were running, and the load average was 18 to 31 during the run. Browser: headless Chromium 140.0.7339.16 (Playwright 1.55.0, chromium-1187) using SwiftShader WebGL2. It has no WebGPU adapter.
- Date: 2026-09-24.

| # | Command | Exit | Wall s | Result |
| --- | --- | --- | --- | --- |
| 1 | `git status --short` | 0 | 0 | Only `?? reports/runbook-logs/exit-codes.tsv`, which the runner creates. No tracked changes. |
| 2 | `git rev-parse HEAD` | 0 | 0 | `f7b55743842696d3a86ab3f8f2a8bf17cdce9757` |
| 3 | `git diff --check` | 0 | 0 | No output |
| 4 | `npm ci` | 0 | 1 | 56 packages added. `npm audit` reports **2 high** findings: `playwright <1.55.1`, GHSA-7mvr-c777-76hp, browser download without TLS verification. This is dev-only; the fix needs a coordinator pin change to `@playwright/test`. |
| 5 | `npm run typecheck` | 0 | 0 | Clean. This includes `tests/e2e/**` and `bench/**`. |
| 6 | `npm run test:sim` | 0 | 3 | 55 of 55 passed |
| 7 | `npm run test:render` | 0 | 0 | 55 of 55 passed |
| 8 | `npm run test:world` | 0 | 1 | 21 of 21 passed (real WorldGraph WASM module in Node) |
| 9 | `npm run test:ui` | 0 | 0 | 61 of 61 passed |
| 10 | `npm run test:audio` | 0 | 1 | 58 of 58 passed |
| 11 | `npm run test:e2e` | **1** | 238 | 23 passed, **3 failed**: R05 renderer recovery, real-input `ShiftRejected`, and W04 control screen. The W04 failure was a harness defect, explained below. |
| 11b | `npm run test:e2e` (rerun after the harness fix) | **1** | ~110 | 24 passed, **2 failed**: R05 renderer recovery and real-input `ShiftRejected`. Log: `11b-test-e2e-rerun.log`. |
| 11c | `npm run test:e2e` (stability rerun) | **1** | ~120 | 24 passed, **2 failed**, the same two tests. Log: `11c-test-e2e-rerun2.log`. |
| 12 | `npm run audit:assets` | 0 | 0 | PASS. The only binary asset is the WorldGraph wasm: sha256 `a6e37742…0762`, MIT OR Apache-2.0, present in both `src/` and `dist/`. There are 0 unknown files and 0 external runtime URLs in first-party source. |
| 13 | `npm run build` | 0 | 0 | tsc and vite build passed. `dist/`: index JS 946 kB (256 kB gzip), three.webgpu chunk 705 kB (198 kB gzip), wasm 943 kB (204 kB gzip). |
| 14 | `npm run bench:frame` | 0 | 379 | 6 frame runs and 6 cold-load runs; receipt in `reports/bench-frame.json`. These are **not reference-device numbers**. |
| extra | `npx vitest run` | 0 | 2 | 262 of 262 passed (all unit suites) |
| extra | `npm run test:contracts` | 0 | 1 | 9 of 9 passed |
| extra | `npm run test:app` | 0 | 0 | 3 of 3 passed |

Wall seconds are whole seconds from `date +%s`, so steps under 1 s show as 0.

## Step 11: the harness defect I fixed and the failures I did not fix

- In the first run, the W04 control-screen test stalled at `page.screenshot` until the 180 s test timeout expired. The teardown snapshot showed the control panel had never opened. Under full Playwright parallelism on a loaded host, a 120 ms key hold had overshot the control-screen radius. Pressing E out of range does nothing, and the old fallback `control({kind:'open-panel'})` was rejected as out of reach.
  - I changed the harness: it now walks in short taps, re-checks the position, retries E up to 6 times, and **asserts** that the panel opened.
  - Screenshots in that spec are now best-effort, with a 20 s timeout.
  - No product assertion was relaxed. The rerun passed, and the stability rerun passed again.
- The two remaining failures are product findings, not harness defects. I left them failing on purpose; see `reports/evidence-matrix.md`, "Failures".

## Commands not in section 5 that were also run
- `npm audit`: 2 high findings (see step 4).
- O01 history check: `git log --format='%h %p | %an | %s' --name-only ffdf270..ed8048c` and `git show --stat aba9ffe 131a7eb ed8048c`.
