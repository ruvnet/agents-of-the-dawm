import { createRequire } from 'node:module';
const PW_VERSION: string = createRequire(import.meta.url)('@playwright/test/package.json').version;
/// <reference types="node" />
/**
 * W6 validation helpers. Test-side only: nothing here edits or replaces app code. The observer
 * installed by `installObserver` wraps the committed Simulation's `step` to READ hashes at fixed
 * ticks; it never changes an input command or a return value.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Page, TestInfo } from '@playwright/test';
import { validateManifest, type GeometryManifest, type LevelManifest } from '../../src/contracts/manifest';

export const REPORT_DIR = join(process.cwd(), 'reports', 'e2e');
export const SHOT_DIR = join(REPORT_DIR, 'screens');
/** Every tick that is a multiple of this is hashed by the observer (plus key event ticks). */
export const HASH_EVERY = 250;

export function sourceReceipt(): Record<string, string | null> {
  const sh = (c: string): string | null => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch { return null; } };
  return {
    sourceSha: sh('git rev-parse HEAD'),
    worktreeDirty: sh('git status --porcelain --untracked-files=no -- src index.html package.json package-lock.json') ? 'yes (src/config changed)' : 'no',
    lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
  };
}

export function writeEvidence(name: string, data: unknown, info?: TestInfo): string {
  const file = join(REPORT_DIR, `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  const body = {
    test: info?.title ?? name,
    status: info ? (info.errors.length ? 'failed' : 'recorded') : 'recorded',
    recordedAt: new Date().toISOString(),
    environment: `Headless Chromium (Playwright ${PW_VERSION}) with SwiftShader WebGL2, no WebGPU adapter, on ruvultra`,
    ...sourceReceipt(),
    data,
  };
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  return file;
}

export function shotPath(name: string): string {
  mkdirSync(SHOT_DIR, { recursive: true });
  return join(SHOT_DIR, `${name}.png`);
}

/** Bundled manifest loaded the same way as src/contracts/fixtures (Node ESM cannot import the JSON without attributes). */
export function loadManifestNode(): LevelManifest {
  const core = JSON.parse(readFileSync('src/contracts/fixtures/sector-01.core.json', 'utf8')) as object;
  const geometry = JSON.parse(readFileSync('src/contracts/fixtures/sector-01.geometry.json', 'utf8')) as GeometryManifest;
  const r = validateManifest({ ...core, geometry });
  if (!r.ok) throw new Error(`manifest invalid: ${r.errors.join('; ')}`);
  return r.value;
}

export interface ObservedEvent { id: string; type: string; tick: number; key: string }
export interface Observation {
  hashes: Record<string, string>;
  events: ObservedEvent[];
  patched: number;
  stepErrors: string[];
}

/**
 * Must run before the app script. Watches for each new Simulation (new game, continue, replay) on
 * every animation frame and wraps its `step` to record `hash()` at every HASH_EVERY tick and on
 * key events. Registered before the app's first rAF, so it patches a new sim before its first tick.
 */
export async function installObserver(page: Page): Promise<void> {
  await page.addInitScript((every: number) => {
    const KEY = new Set(['CheckpointReached', 'GateOpened', 'TramCrossed', 'ShiftCommitted', 'ShiftRejected',
      'TransferRejected', 'TransferAuthorized', 'EdgeRestored', 'SensorVerified', 'PanelOpened', 'PlayerRespawned']);
    const obs = { hashes: {} as Record<string, string>, events: [] as { id: string; type: string; tick: number; key: string }[], patched: 0, stepErrors: [] as string[] };
    (window as unknown as { __w6obs: typeof obs }).__w6obs = obs;
    let last: unknown = null;
    const poll = (): void => {
      try {
        const h = (window as unknown as { __floodline?: { sim(): unknown } }).__floodline;
        const sim = h?.sim() as { step(c: unknown): { id: string; type: string; tick: number; key: string }[]; state(): { tick: number }; hash(): string } | null;
        if (sim && sim !== last) {
          last = sim;
          obs.patched += 1;
          const orig = sim.step.bind(sim);
          sim.step = (cmd: unknown) => {
            const ev = orig(cmd);
            try {
              const t = sim.state().tick;
              if (t % every === 0 || ev.some((e) => KEY.has(e.type))) obs.hashes[String(t)] = sim.hash();
              for (const e of ev) if (KEY.has(e.type)) obs.events.push({ id: e.id, type: e.type, tick: e.tick, key: e.key });
            } catch (err) { obs.stepErrors.push(String(err)); }
            return ev;
          };
        }
      } catch (err) { obs.stepErrors.push(String(err)); }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }, HASH_EVERY);
}

export interface ErrorLog { pageErrors: string[]; consoleErrors: string[]; consoleWarnings: string[] }

export function collectErrors(page: Page): ErrorLog {
  const log: ErrorLog = { pageErrors: [], consoleErrors: [], consoleWarnings: [] };
  page.on('pageerror', (e) => log.pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') log.consoleErrors.push(m.text());
    else if (m.type() === 'warning' && log.consoleWarnings.length < 20) log.consoleWarnings.push(m.text());
  });
  return log;
}

export async function waitReady(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __floodline?: { ready?: boolean } }).__floodline?.ready === true, null, { timeout });
}

export interface GameFacts {
  tick: number;
  hash: string;
  beat: string;
  branch: string;
  checkpointKey: string;
  tramCrossed: boolean;
  flags: Record<string, boolean>;
  player: { pos: number[]; up: string; anchorKey: string | null; health: number };
  backend: string;
  semanticStatus: string;
  appErrors: string[];
  captionCount: number;
  commandCount: number;
}

export async function facts(page: Page): Promise<GameFacts | null> {
  return page.evaluate(() => {
    type H = {
      sim(): { state(): Record<string, unknown> & { tick: number; beat: string; branch: string; checkpointKey: string; tramCrossed: boolean; flags: Record<string, boolean>; player: { pos: number[]; up: string; anchorKey: string | null; health: number } }; hash(): string } | null;
      backend(): string; semanticStatus(): string; errors(): readonly string[]; captions(): readonly string[]; commands(): readonly unknown[];
    };
    const h = (window as unknown as { __floodline?: H }).__floodline;
    const sim = h?.sim();
    if (!h || !sim) return null;
    const s = sim.state();
    return {
      tick: s.tick, hash: sim.hash(), beat: s.beat, branch: s.branch, checkpointKey: s.checkpointKey, tramCrossed: s.tramCrossed,
      flags: { ...s.flags }, player: { pos: [...s.player.pos], up: s.player.up, anchorKey: s.player.anchorKey, health: s.player.health },
      backend: h.backend(), semanticStatus: h.semanticStatus(), appErrors: [...h.errors()], captionCount: h.captions().length, commandCount: h.commands().length,
    };
  });
}

export async function observation(page: Page): Promise<Observation> {
  return page.evaluate(() => (window as unknown as { __w6obs: Observation }).__w6obs);
}

/** Wait until the demo autopilot has crossed the tram and the epilogue has had time to finish. */
export async function waitForTram(page: Page, timeout = 240_000): Promise<void> {
  await page.waitForFunction(() => {
    const h = (window as unknown as { __floodline?: { sim(): { state(): { tramCrossed: boolean } } | null } }).__floodline;
    return h?.sim()?.state().tramCrossed === true;
  }, null, { timeout, polling: 250 });
}

/** Wait until the committed sim tick reaches `tick`. */
export async function waitForTick(page: Page, tick: number, timeout = 240_000): Promise<void> {
  await page.waitForFunction((t) => {
    const h = (window as unknown as { __floodline?: { sim(): { state(): { tick: number } } | null } }).__floodline;
    return (h?.sim()?.state().tick ?? -1) >= t;
  }, tick, { timeout, polling: 250 });
}

// ------------------------------------------------------------------ IndexedDB (app store, read/write from the test)

export const IDB = { name: 'agents-of-the-dawm.floodline', store: 'kv' } as const;

export async function idbGet(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async ({ name, store, key }) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(undefined); return; }
      const g = db.transaction(store, 'readonly').objectStore(store).get(key);
      g.onsuccess = () => { db.close(); resolve(g.result); };
      g.onerror = () => { db.close(); reject(g.error); };
    };
  }), { ...IDB, key });
}

export async function idbPut(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(async ({ name, store, key, value }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { ...IDB, key, value });
}

/** Sample the committed simulation from Node: shared 'real input' driver helpers. */
export async function playerPos(page: Page): Promise<{ pos: number[]; up: string; anchorKey: string | null; tick: number }> {
  return page.evaluate(() => {
    const h = (window as unknown as { __floodline: { sim(): { state(): { tick: number; player: { pos: number[]; up: string; anchorKey: string | null } } } } }).__floodline;
    const s = h.sim().state();
    return { pos: [...s.player.pos], up: s.player.up, anchorKey: s.player.anchorKey, tick: s.tick };
  });
}

export async function eventTypesSince(page: Page, fromIndex: number): Promise<{ type: string; key: string; tick: number; payload: unknown }[]> {
  return page.evaluate((from) => {
    const h = (window as unknown as { __floodline: { sim(): { eventLog(): readonly { type: string; key: string; tick: number; payload: unknown }[] } } }).__floodline;
    return h.sim().eventLog().slice(from).map((e) => ({ type: e.type, key: e.key, tick: e.tick, payload: e.payload }));
  }, fromIndex);
}

export async function eventCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __floodline: { sim(): { eventLog(): readonly unknown[] } } }).__floodline.sim().eventLog().length);
}
