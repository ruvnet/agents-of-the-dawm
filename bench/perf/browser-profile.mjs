#!/usr/bin/env node
/**
 * Sampling CPU profile of the running demo in headless Chromium (W7.PERF.01 evidence for what is
 * and is not worth optimizing). Requires `npx vite build`. Serves on 4174.
 *   node bench/perf/browser-profile.mjs --label after [--seconds 15] [--dist dist]
 * Writes bench/perf/results/profile-<label>.json: top self-time functions (by URL:line).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const label = opt('label', 'run');
const seconds = Number(opt('seconds', '15'));
const distDir = opt('dist', 'dist');
const BASE = 'http://127.0.0.1:4174';
const server = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort', '--outDir', distDir], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* retry */ }
  if (i > 150) throw new Error('server did not start');
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 720 });
await p.goto(`${BASE}/?demo=upper&speed=1`);
await p.waitForFunction(() => (window.__floodline?.sim()?.state().tick ?? 0) > 600 && window.__floodline.semanticStatus() === 'ready', null, { timeout: 120000 });
const cdp = await ctx.newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await new Promise((r) => setTimeout(r, seconds * 1000));
const { profile } = await cdp.send('Profiler.stop');
await browser.close();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
const idle = ['(idle)', '(program)', '(garbage collector)'].map((n) => [...self.entries()].filter(([k]) => k.startsWith(n)).reduce((a, [, v]) => a + v, 0));
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => ({ fn: k, pct: Math.round((1000 * v) / total) / 10, ms: Math.round(v / 100) / 10 }));
mkdirSync('bench/perf/results', { recursive: true });
writeFileSync(`bench/perf/results/profile-${label}.json`, `${JSON.stringify({ label, distDir, seconds, totalMs: total / 1000, idleMs: idle[0] / 1000, programMs: idle[1] / 1000, gcMs: idle[2] / 1000, top }, null, 2)}\n`);
for (const t of top.slice(0, 25)) console.log(`${String(t.pct).padStart(5)}%  ${t.fn}`);
process.exit(0);
