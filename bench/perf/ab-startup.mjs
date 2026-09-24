#!/usr/bin/env node
/**
 * Interleaved A/B startup runs (W7.PERF.01). The workstation is shared (load average varied
 * 5 -> 29 during the sequential runs), so before/after startup runs alternate one cold run at a
 * time to share the same background load. Each run is one browser-bench.mjs --startup-only pass.
 *   node bench/perf/ab-startup.mjs --before <distDir> --before-sha <sha> --rounds 10 [--throttle] --out <file>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const before = opt('before');
const beforeSha = opt('before-sha');
const afterDist = opt('after', 'dist');
const rounds = Number(opt('rounds', '10'));
const throttle = args.includes('--throttle');
const out = opt('out', 'bench/perf/results/ab-startup.json');
const runs = { before: [], after: [] };
const loads = [];
for (let r = 0; r < rounds; r++) {
  const order = r % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
  for (const which of order) {
    const label = `ab-tmp-${which}`;
    const extra = which === 'before' ? ['--dist', before, '--dist-sha', beforeSha] : ['--dist', afterDist];
    execFileSync('node', ['bench/perf/browser-bench.mjs', '--label', label, '--startup-only', '--startup-runs', '1', ...(throttle ? ['--throttle'] : []), ...extra], { stdio: 'ignore' });
    const file = `bench/perf/results/browser-${label}.json`;
    const d = JSON.parse(readFileSync(file, 'utf8'));
    rmSync(file);
    const s = d.startup[0];
    runs[which].push({ round: r, sourceSha: d.env.sourceSha, marks: s.marks, criticalBytes: s.criticalBytes, backend: s.backend, errors: s.errors });
  }
  loads.push(loadavg()[0]);
  process.stdout.write(`round ${r} load ${loadavg()[0].toFixed(1)}\n`);
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = {};
for (const k of ['fl:boot', 'fl:renderer-init-start', 'fl:renderer-init-done', 'fl:controllable', 'fl:first-tick']) {
  const b = runs.before.map((x) => x.marks[k]);
  const a = runs.after.map((x) => x.marks[k]);
  // Paired difference per round (after - before), robust to drift in background load.
  const diffs = a.map((v, i) => v - b[i]);
  summary[k] = { beforeMedian: med(b), afterMedian: med(a), beforeMin: Math.min(...b), afterMin: Math.min(...a), pairedDiffMedian: med(diffs) };
}
writeFileSync(out, `${JSON.stringify({ before, afterDist, throttle: throttle ? { downloadMbps: 50, uploadMbps: 10, latencyMs: 20 } : null, rounds, loadavg1m: loads, summary, runs }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 1));
