#!/usr/bin/env node
/**
 * Headless Chromium startup + frame-CPU bench (W7.PERF.01). Requires a fresh `npx vite build`.
 *
 *   node bench/perf/browser-bench.mjs --label before [--startup-runs 7] [--frame-runs 1] [--no-verify]
 *
 * Serves dist/ with `vite preview` on 127.0.0.1:4174 (4173 belongs to the validator), then:
 *  1. startup: N cold runs (fresh browser context = empty HTTP cache) of `/?autostart=1&perf`,
 *     reading the app's performance marks (fl:*) and the resource timing entries;
 *  2. frames: `/?demo=upper&speed=1&perf` to tramCrossed, reading the app frame-CPU ring buffers;
 *  3. verify: `/?demo=upper|lower&speed=8` must reach tramCrossed with zero __floodline.errors().
 * SwiftShader software GL: these numbers are NOT reference-device evidence for ADR 0002 R01/R02.
 */
import { spawn, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const label = opt('label', 'run');
const startupRuns = Number(opt('startup-runs', '7'));
const frameRuns = Number(opt('frame-runs', '1'));
const verify = !args.includes('--no-verify');
// Serve a prebuilt dist (e.g. the baseline build) instead of ./dist; its source SHA is passed in.
const distDir = opt('dist', 'dist');
const distSha = opt('dist-sha', null);
// ADR 0002 R01 network: emulated 50 Mbps down (plus 20 ms latency, our choice), cold cache.
const throttle = args.includes('--throttle');
const skipFrames = args.includes('--startup-only');
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
function stats(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { n: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), min: round(s[0]), p50: round(q(50)), p95: round(q(95)), p99: round(q(99)), max: round(s[s.length - 1]) };
}

async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    if (Date.now() - t0 > ms) throw new Error(`server did not come up: ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const server = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--outDir', distDir], { stdio: 'ignore' });
const stopServer = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopServer);

const env = {
  label,
  date: new Date().toISOString(),
  sourceSha: distSha ?? execSync('git rev-parse HEAD').toString().trim(),
  distDir,
  network: throttle ? { downloadMbps: 50, uploadMbps: 10, latencyMs: 20 } : 'unthrottled localhost',
  dirty: execSync('git status --porcelain -- src vite.config.ts').toString().trim().length > 0,
  lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  cpu: cpus()[0]?.model,
  node: process.version,
  loadavgAtStart: loadavg().map((x) => round(x, 2)),
};

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
env.browser = `chromium ${browser.version()}`;
const out = { env, startup: [], frames: [], verify: [] };

async function page(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 720 });
  const consoleErrors = [];
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  if (throttle) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 20, downloadThroughput: (50e6 / 8), uploadThroughput: (10e6 / 8),
    });
  }
  return { p, consoleErrors };
}

try {
  await waitHttp(`${BASE}/`);

  // ---- 1. startup (cold cache per run)
  for (let i = 0; i < startupRuns; i++) {
    const ctx = await browser.newContext();
    const { p, consoleErrors } = await page(ctx);
    await p.goto(`${BASE}/?autostart=1&perf`);
    await p.waitForFunction(() => window.__floodline?.perf().marks['fl:first-tick'] !== undefined, null, { timeout: 120000 });
    const r = await p.evaluate(() => {
      const h = window.__floodline;
      const nav = performance.getEntriesByType('navigation')[0];
      const res = performance.getEntriesByType('resource').map((e) => ({
        name: e.name.replace(location.origin, ''), start: e.startTime, end: e.responseEnd, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize,
      }));
      let gl = null;
      try {
        const c = document.createElement('canvas').getContext('webgl2');
        const d = c?.getExtension('WEBGL_debug_renderer_info');
        gl = d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c?.getParameter(c.RENDERER) ?? null;
      } catch { /* ignore */ }
      return {
        marks: h.perf().marks, backend: h.backend(), errors: [...h.errors()], gl, webgpu: 'gpu' in navigator,
        nav: { responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, transferSize: nav.transferSize },
        resources: res,
      };
    });
    const ctl = r.marks['fl:controllable'];
    const crit = r.resources.filter((x) => x.end <= ctl);
    r.criticalBytes = crit.reduce((a, x) => a + x.transferSize, 0) + r.nav.transferSize;
    r.totalBytes = r.resources.reduce((a, x) => a + x.transferSize, 0) + r.nav.transferSize;
    r.consoleErrors = consoleErrors;
    out.startup.push(r);
    console.log(`startup ${i}: controllable=${round(ctl, 1)}ms firstTick=${round(r.marks['fl:first-tick'], 1)}ms backend=${r.backend} critBytes=${r.criticalBytes}`);
    await ctx.close();
  }

  // ---- 2. frame CPU over a full upper playthrough at speed 1
  for (let i = 0; i < (skipFrames ? 0 : frameRuns); i++) {
    const ctx = await browser.newContext();
    const { p, consoleErrors } = await page(ctx);
    const t0 = Date.now();
    await p.goto(`${BASE}/?demo=upper&speed=1&perf`);
    await p.waitForFunction(() => window.__floodline?.sim()?.state().tramCrossed === true, null, { timeout: 240000, polling: 500 });
    const snap = await p.evaluate(() => ({ perf: window.__floodline.perf(), errors: [...window.__floodline.errors()], tick: window.__floodline.sim().state().tick, semantic: window.__floodline.semanticStatus() }));
    const s = snap.perf.series;
    const scales = s.scale;
    const hist = {};
    for (const x of scales) hist[x] = (hist[x] ?? 0) + 1;
    const modal = Number(Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0]);
    const at = (name, pred) => s[name].filter((_, j) => pred(j));
    const summary = {
      wallMs: Date.now() - t0, frames: snap.perf.frames, capacity: snap.perf.capacity, ticks: snap.tick, semantic: snap.semantic,
      errors: snap.errors, consoleErrors, internalScaleHistogram: hist, modalScale: modal,
      all: Object.fromEntries(['frame', 'ticks', 'render', 'graph', 'ui'].map((k) => [k, stats(s[k])])),
      atModalScale: Object.fromEntries(['frame', 'ticks', 'render', 'graph', 'ui'].map((k) => [k, stats(at(k, (j) => scales[j] === modal))])),
      perTickMs: stats(at('ticks', (j) => s.nticks[j] > 0).map((v, j, arr) => v)), // frames that ran >=1 tick
      raw: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.map((x) => round(x, 4))])),
    };
    out.frames.push(summary);
    console.log(`frames ${i}: n=${summary.frames} frame p50=${summary.all.frame.p50} p95=${summary.all.frame.p95} graph p50=${summary.all.graph.p50} render p50=${summary.all.render.p50} ui p50=${summary.all.ui.p50} ticks p50=${summary.all.ticks.p50}`);
    await ctx.close();
  }

  // ---- 3. both demo routes still complete, zero errors
  if (verify && !skipFrames) {
    for (const route of ['upper', 'lower']) {
      const ctx = await browser.newContext();
      const { p, consoleErrors } = await page(ctx);
      await p.goto(`${BASE}/?demo=${route}&speed=8`);
      await p.waitForFunction(() => window.__floodline?.sim()?.state().tramCrossed === true, null, { timeout: 240000, polling: 250 });
      const v = await p.evaluate(() => ({ tramCrossed: window.__floodline.sim().state().tramCrossed, tick: window.__floodline.sim().state().tick, errors: [...window.__floodline.errors()], hash: window.__floodline.sim().hash(), backend: window.__floodline.backend() }));
      out.verify.push({ route, ...v, consoleErrors });
      console.log(`verify ${route}: tramCrossed=${v.tramCrossed} tick=${v.tick} errors=${v.errors.length} backend=${v.backend}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  stopServer();
}

env.loadavgAtEnd = loadavg().map((x) => round(x, 2));
const ms = (k) => stats(out.startup.map((r) => r.marks[k]).filter((x) => x !== undefined));
out.startupSummary = {
  boot: ms('fl:boot'), rendererInitStart: ms('fl:renderer-init-start'), rendererInitDone: ms('fl:renderer-init-done'),
  controllable: ms('fl:controllable'), firstTick: ms('fl:first-tick'),
  criticalBytes: stats(out.startup.map((r) => r.criticalBytes)), totalBytes: stats(out.startup.map((r) => r.totalBytes)),
};
mkdirSync('bench/perf/results', { recursive: true });
writeFileSync(`bench/perf/results/browser-${label}.json`, `${JSON.stringify(out)}\n`);
console.log(JSON.stringify(out.startupSummary));
process.exit(0);
