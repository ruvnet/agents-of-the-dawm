#!/usr/bin/env node
// W6 frame benchmark (R01/R02 evidence harness). For each available backend path, runs the same
// seeded demo route at real-time speed 3 times in headless Chromium, records raw rAF intervals and
// reports p50/p95; separately measures cold-cache time to first controllable frame with and
// without 50 Mbps throttling (CDP Network.emulateNetworkConditions). Writes a source-bound receipt
// to reports/bench-frame.json. Every number is labelled as NON-reference-device data.
//
// Runs are sequential on purpose: SwiftShader rasterises on the CPU, so concurrent browser runs
// would share cores and contaminate each other's frame times. The receipt records host load.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const CFG = JSON.parse(readFileSync(join(ROOT, 'bench/frame/config.json'), 'utf8'));
const RECORDER = readFileSync(join(ROOT, 'bench/frame/recorder.js'), 'utf8');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, 'reports', 'bench-frame.json');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const quick = process.argv.includes('--quick'); // 1 run each, for smoke checks only

function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i] * 100) / 100;
}
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

function walk(d, out = []) {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}

async function serverUp() {
  try { const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
}

async function ensureServer() {
  const newest = (fs) => fs.reduce((m, f) => Math.max(m, statSync(f).mtimeMs), 0);
  const stale = !existsSync(join(ROOT, 'dist/index.html')) || newest(walk(join(ROOT, 'dist'))) < newest([...walk(join(ROOT, 'src')), join(ROOT, 'index.html')]);
  if (stale) execSync('npx vite build', { stdio: ['ignore', 'ignore', 'inherit'] });
  if (await serverUp()) return { proc: null, note: `reused server on ${BASE}${stale ? ' (dist rebuilt)' : ''}` };
  const proc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) throw new Error('vite preview did not start on 4173');
  return { proc, note: `started vite preview on ${BASE}` };
}

async function newContext(browser) {
  return browser.newContext({ viewport: { width: CFG.viewport.width, height: CFG.viewport.height }, deviceScaleFactor: CFG.viewport.deviceScaleFactor });
}

async function trackBytes(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const urls = new Map();
  const bytes = { total: 0, byUrl: {} };
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    const u = urls.get(e.requestId) ?? e.requestId;
    const path = u.startsWith(BASE) ? u.slice(BASE.length) : u;
    bytes.total += e.encodedDataLength;
    bytes.byUrl[path] = (bytes.byUrl[path] ?? 0) + e.encodedDataLength;
  });
  return { cdp, bytes };
}

async function frameRun(browser, backend, run) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.addInitScript((mode) => { window.__benchCfg = { glMode: mode }; }, backend.glMode);
  await page.addInitScript(RECORDER);
  const { bytes } = await trackBytes(page);
  const t0 = Date.now();
  await page.goto(`${BASE}/?demo=${CFG.route}&speed=${CFG.speed}`);
  await page.waitForFunction(() => window.__floodline?.ready === true && window.__floodline.sim() !== null, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__bench.recording = true; });
  await page.waitForFunction(() => window.__floodline.sim()?.state().tramCrossed === true, null, { timeout: CFG.maxRouteSeconds * 1000, polling: 500 });
  const r = await page.evaluate(() => {
    const b = window.__bench;
    b.recording = false;
    const h = window.__floodline;
    const s = h.sim().state();
    return { frames: b.frames, ticksPerFrame: b.ticksPerFrame, firstControllableMs: b.firstControllableMs, ctx: b.ctx, backend: h.backend(), semantic: h.semanticStatus(), errors: [...h.errors()], tick: s.tick, tram: s.tramCrossed, hash: h.sim().hash() };
  });
  await ctx.close();
  const game = r.ctx.filter((c) => c.onGameCanvas && !c.blocked && c.type === 'webgl2');
  const path = game.length ? game[game.length - 1].module : 'none';
  const frames = r.frames.map((x) => Math.round(x * 1000) / 1000);
  const ticks = r.ticksPerFrame;
  return {
    backend: backend.id, run, pathObserved: path, pathOk: path === backend.expectPath, appBackend: r.backend, semanticStatus: r.semantic,
    wallSeconds: Math.round((Date.now() - t0) / 100) / 10, frameCount: frames.length,
    frameMs: { p50: pct(frames, 50), p95: pct(frames, 95), p99: pct(frames, 99), mean: mean(frames), max: frames.length ? Math.max(...frames) : null },
    fpsFromP50: frames.length ? Math.round(1000 / pct(frames, 50) * 10) / 10 : null,
    ticksPerFrame: { mean: mean(ticks), p95: pct(ticks, 95), atCatchupCap: ticks.filter((t) => t >= 5).length },
    tramCrossedAtTick: r.tick, hashAtStop: r.hash, appErrors: r.errors, pageErrors,
    transferBytes: bytes.total, rawFrameIntervalsMs: frames,
    rendererStats: null,
  };
}

async function coldLoadRun(browser, cond, run) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__benchCfg = { glMode: 'observe' }; });
  await page.addInitScript(RECORDER);
  const { cdp, bytes } = await trackBytes(page);
  if (cond.network) await cdp.send('Network.emulateNetworkConditions', cond.network);
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__bench?.firstControllableMs !== null && window.__bench?.firstControllableMs !== undefined, null, { timeout: 120_000, polling: 50 });
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { firstControllableMs: window.__bench.firstControllableMs, readyText: window.__bench.readyText, domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null, loadEventMs: nav ? nav.loadEventEnd : null };
  });
  const bytesAtControllable = bytes.total;
  await page.waitForTimeout(1500); // let the post-control semantic/optional loads finish for the full byte count
  const all = bytes.total;
  const byUrl = { ...bytes.byUrl };
  await ctx.close();
  return { condition: cond.id, run, network: cond.network, cache: 'cold (fresh context, CDP cache disabled)', ...r, transferBytesAtControllable: bytesAtControllable, transferBytesAfter1500ms: all, bytesByPath: byUrl };
}

async function main() {
  const load0 = loadavg();
  const server = await ensureServer();
  const browser = await chromium.launch();
  const gpuPage = await (await newContext(browser)).newPage();
  await gpuPage.goto(`${BASE}/`);
  const env = await gpuPage.evaluate(async () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    let adapter = 'navigator.gpu absent';
    if (navigator.gpu) { try { adapter = (await navigator.gpu.requestAdapter()) ? 'adapter returned' : 'requestAdapter() returned null'; } catch (e) { adapter = String(e); } }
    return {
      userAgent: navigator.userAgent,
      glRenderer: gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null,
      glVendor: gl ? gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR) : null,
      webgpu: adapter, devicePixelRatio: window.devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
  await gpuPage.context().close();

  const runs = quick ? 1 : CFG.runsPerBackend;
  const frameRuns = [];
  for (const backend of CFG.backends) {
    for (let i = 1; i <= runs; i++) {
      process.stdout.write(`frame run ${backend.id} #${i} ... `);
      const r = await frameRun(browser, backend, i);
      frameRuns.push(r);
      console.log(`p50 ${r.frameMs.p50} ms, p95 ${r.frameMs.p95} ms, frames ${r.frameCount}, path ${r.pathObserved}${r.pathOk ? '' : ' (UNEXPECTED)'}`);
    }
  }
  const coldRuns = [];
  for (const cond of CFG.coldLoad.conditions) {
    for (let i = 1; i <= (quick ? 1 : CFG.coldLoad.runsPerCondition); i++) {
      process.stdout.write(`cold load ${cond.id} #${i} ... `);
      const r = await coldLoadRun(browser, cond, i);
      coldRuns.push(r);
      console.log(`first controllable ${Math.round(r.firstControllableMs)} ms, ${r.transferBytesAtControllable} bytes`);
    }
  }
  const browserVersion = browser.version();
  await browser.close();
  server.proc?.kill();

  const perBackend = CFG.backends.map((b) => {
    const rs = frameRuns.filter((r) => r.backend === b.id);
    const pooled = rs.flatMap((r) => r.rawFrameIntervalsMs);
    return {
      backend: b.id, description: b.description, runs: rs.length,
      perRun: rs.map((r) => ({ run: r.run, p50: r.frameMs.p50, p95: r.frameMs.p95, frames: r.frameCount, pathOk: r.pathOk })),
      pooledFrameMs: { p50: pct(pooled, 50), p95: pct(pooled, 95), frames: pooled.length },
      hashesAtStopIdentical: new Set(rs.map((r) => r.hashAtStop)).size === 1 ? 'n/a (stop tick differs per run; see determinism e2e)' : 'differs by stop tick (expected)',
      anyErrors: rs.some((r) => r.appErrors.length || r.pageErrors.length),
    };
  });
  const perCondition = CFG.coldLoad.conditions.map((c) => {
    const rs = coldRuns.filter((r) => r.condition === c.id);
    const t = rs.map((r) => r.firstControllableMs);
    return { condition: c.id, network: c.network, runs: rs.length, firstControllableMs: { values: t.map((x) => Math.round(x)), p50: pct(t, 50), max: t.length ? Math.round(Math.max(...t)) : null }, transferBytesAtControllable: rs.map((r) => r.transferBytesAtControllable) };
  });

  const wasm = join(ROOT, 'src/wasm/pkg/worldgraph_wasm_bg.wasm');
  const receipt = {
    label: CFG.label,
    schema: 'floodline-bench-frame/1',
    generatedAt: new Date().toISOString(),
    command: `npm run bench:frame${quick ? ' -- --quick' : ''}`,
    targets: 'ADR 0002 R02: desktop p95 <= 16.7 ms at default quality, mobile p95 <= 33.3 ms; R01: first controllable frame <= 20 s desktop / 30 s mobile at 50 Mbps cold. THESE TARGETS ARE NOT EVALUATED HERE: this host is not a named reference device.',
    source: {
      sha: sh('git rev-parse HEAD'),
      dirtyTrackedSrc: sh('git status --porcelain --untracked-files=no -- src index.html package.json package-lock.json vite.config.ts') || 'clean',
      lockfileSha256: sha256(readFileSync(join(ROOT, 'package-lock.json'))),
      wasmSha256: existsSync(wasm) ? sha256(readFileSync(wasm)) : null,
      wasmReceipt: 'src/wasm/pkg/RECEIPT.json',
    },
    host: {
      name: sh('hostname'), cpu: cpus()[0]?.model ?? null, cores: cpus().length, memGiB: Math.round(totalmem() / 2 ** 30),
      loadavgAtStart: load0.map((x) => Math.round(x * 100) / 100), loadavgAtEnd: loadavg().map((x) => Math.round(x * 100) / 100),
      note: 'shared workstation; other sessions were running. Runs are sequential because SwiftShader rasterises on the CPU and concurrent runs would contaminate frame times.',
    },
    browser: { engine: 'chromium (Playwright 1.55.0 bundled chromium-1187), headless', version: browserVersion, ...env },
    route: CFG.route, seed: CFG.seed, speed: CFG.speed, preset: CFG.preset, viewport: CFG.viewport,
    server: server.note,
    rendererStats: 'NOT REACHABLE: RendererAdapter.stats() is not exposed on window.__floodline and is not rendered in the UI (see reports/validation-requests.md). Frame intervals are rAF deltas measured in the page.',
    summary: { perBackend, coldLoad: perCondition },
    frameRuns,
    coldRuns,
  };
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`\n${CFG.label}`);
  for (const b of perBackend) console.log(`  ${b.backend}: pooled p50 ${b.pooledFrameMs.p50} ms, p95 ${b.pooledFrameMs.p95} ms over ${b.pooledFrameMs.frames} frames (${b.runs} runs)`);
  for (const c of perCondition) console.log(`  first controllable frame, cold, ${c.condition}: ${c.firstControllableMs.values.join(', ')} ms`);
  console.log(`  receipt: reports/bench-frame.json`);
  const bad = frameRuns.filter((r) => !r.pathOk || r.pageErrors.length || r.appErrors.length);
  if (bad.length) { console.error(`bench: ${bad.length} run(s) had an unexpected renderer path or errors`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
