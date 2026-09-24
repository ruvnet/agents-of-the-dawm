#!/usr/bin/env bash
# W6: runs swarm-runbook section 5 in order, capturing each command's stdout/stderr, exit code and
# wall time. Continues after a failure so every command gets a recorded result.
# Usage (from the repo root): bash reports/runbook-logs/run.sh
set -u
LOG=reports/runbook-logs
TSV=$LOG/exit-codes.tsv
printf 'step\texit\tseconds\tcommand\n' > "$TSV"
run() {
  local name=$1; shift
  local s=$(date +%s)
  timeout 2400 "$@" > "$LOG/$name.log" 2>&1
  local c=$?
  printf '%s\t%s\t%s\t%s\n' "$name" "$c" "$(( $(date +%s) - s ))" "$*" >> "$TSV"
}
run 01-git-status git status --short
run 02-git-rev-parse git rev-parse HEAD
run 03-git-diff-check git diff --check
run 04-npm-ci npm ci
run 05-typecheck npm run typecheck
run 06-test-sim npm run test:sim
run 07-test-render npm run test:render
run 08-test-world npm run test:world
run 09-test-ui npm run test:ui
run 10-test-audio npm run test:audio
run 11-test-e2e npm run test:e2e
run 12-audit-assets npm run audit:assets
run 13-build npm run build
run 14-bench-frame npm run bench:frame
# Additional evidence beyond section 5 (task card): full vitest and the remaining per-area scripts.
run 15-vitest-all npx vitest run
run 16-test-contracts npm run test:contracts
run 17-test-app npm run test:app
echo done >> "$TSV.done"
