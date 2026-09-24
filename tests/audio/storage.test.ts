import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { loadSector01 } from '../../src/contracts/fixtures';
import { SAVE_SCHEMA_VERSION } from '../../src/contracts';
import type { ActionName, SaveRecord, UiSettings } from '../../src/contracts';
import { createSimulation } from '../../src/sim';
import { DB_NAME, KEYS, STORE, createSaveStore, decodeSave, migrate, validateSaveRecord } from '../../src/storage';
import { FakeIdbBackend } from './fake-idb';

const manifest = loadSector01();
const ACTIONS: ActionName[] = ['forward', 'back', 'left', 'right', 'jump', 'pulse', 'spike', 'shift', 'interact', 'pause',
  'lookLeft', 'lookRight', 'lookUp', 'lookDown'];

const settings = (): UiSettings => ({
  version: 1,
  camera: { noRoll: true, reducedMotion: false, fovDeg: 70, motionBlur: false },
  quality: 'auto',
  renderer: 'auto',
  captions: true,
  textScale: 1,
  audio: { master: 0.8, speech: 1, effects: 0.8, music: 0.6, muted: false },
  assist: { aimAssist: false, halfDamage: false, extendedExposure: false },
  lookSensitivity: 1,
  invertY: false,
  bindings: { keyboard: Object.fromEntries(ACTIONS.map((a) => [a, [`Key${a}`]])) as Record<ActionName, string[]>, gamepad: {} },
  showTutorials: true,
  locale: 'en',
});

function record(tick = 0): SaveRecord {
  const sim = createSimulation(manifest, { seed: 1047 });
  const snap = sim.snapshot();
  return {
    schema: 1, manifestId: manifest.id, seed: 1047, savedAtTick: tick, checkpointKey: snap.state.checkpointKey,
    snapshot: snap, stateHash: sim.hash(), settings: settings(),
  };
}

const setup = (o: Parameters<typeof createSaveStore>[0] = {}) => {
  const idb = new FakeIdbBackend();
  const store = createSaveStore({ indexedDB: idb.asFactory(), manifestId: manifest.id, ...o });
  return { idb, store, raw: () => idb.raw(DB_NAME, STORE) };
};

describe('save store', () => {
  it('round-trips a record and settings separately', async () => {
    const { store, raw } = setup();
    expect(store.available()).toBe(true);
    expect(await store.load()).toBeNull();
    const r = record(120);
    expect(await store.save(r)).toBe(true);
    expect(await store.load()).toEqual(r);
    expect(await store.loadSettings()).toBeNull();
    const s = { ...settings(), textScale: 2 as const };
    expect(await store.saveSettings(s)).toBe(true);
    expect(await store.loadSettings()).toEqual(s);
    expect(raw().has(KEYS.current) && raw().has(KEYS.settings)).toBe(true);
  });

  it('keeps the previous valid record as a backup before overwrite', async () => {
    const { store } = setup();
    await store.save(record(1));
    await store.save(record(2));
    expect((await store.load())!.savedAtTick).toBe(2);
    expect((await store.loadBackup())!.savedAtTick).toBe(1);
  });

  it('rejects a corrupt record, backs it up under a separate key, and returns null', async () => {
    const { store, raw } = setup();
    await store.save(record(5));
    const bad = { ...record(6), seed: Number.NaN };
    raw().set(KEYS.current, bad);
    expect(await store.load()).toBeNull();
    const q = raw().get(KEYS.quarantine) as { raw: unknown; reason: string; quarantinedFrom: string };
    expect(q.quarantinedFrom).toBe(KEYS.current);
    expect(q.reason).toMatch(/seed/);
    expect((q.raw as { savedAtTick: number }).savedAtTick).toBe(6);
    expect(raw().has(KEYS.current)).toBe(false);
    // A later save must not promote the corrupt record into the backup slot.
    await store.save(record(7));
    expect((await store.load())!.savedAtTick).toBe(7);
  });

  it('rejects unknown schemas, foreign manifests, non-finite snapshots and oversize records', async () => {
    const cases: [string, unknown][] = [
      ['future schema', { ...record(), schema: 99 }],
      ['foreign manifest', { ...record(), manifestId: 'sector-99' }],
      ['string', 'garbage'],
      ['non-finite snapshot', (() => { const r = record(); (r.snapshot as { state: { tick: number } }).state.tick = Infinity; return r; })()],
      ['wasm handle instead of snapshot', { ...record(), snapshot: { ptr: 1234 } }],
    ];
    for (const [name, value] of cases) {
      const { store, raw } = setup();
      await store.probe();
      raw().set(KEYS.current, value);
      expect(await store.load(), name).toBeNull();
      expect(raw().has(KEYS.quarantine), name).toBe(true);
    }
    const small = setup({ maxBytes: 256 });
    expect(await small.store.save(record())).toBe(false);
    expect(validateSaveRecord(record(), { maxBytes: 256 })).toMatchObject({ ok: false, reason: 'size cap exceeded' });
  });

  it('never writes an invalid record', async () => {
    const { store, raw } = setup();
    expect(await store.save({ ...record(), savedAtTick: -1 })).toBe(false);
    expect(await store.saveSettings({ ...settings(), audio: { ...settings().audio, master: 3 } })).toBe(false);
    await store.probe();
    expect(raw().size).toBe(0);
  });

  it('migrates a v0 record on load, keeping the original', async () => {
    const r = record(33);
    const v0 = { schema: 0, manifest: r.manifestId, seed: r.seed, tick: r.savedAtTick, checkpoint: r.checkpointKey,
      snapshot: r.snapshot, hash: r.stateHash, settings: r.settings };
    const { store, raw } = setup();
    await store.probe();
    raw().set(KEYS.current, v0);
    expect(await store.load()).toEqual(r);
    expect(raw().get(KEYS.current)).toEqual(r);
    expect(raw().get(KEYS.premigrate)).toEqual(v0);
    expect(SAVE_SCHEMA_VERSION).toBe(1);
  });

  it('migrations are bounded: missing steps, loops and non-advancing steps are rejected', () => {
    expect(migrate({ schema: -1 })).toMatchObject({ ok: false });
    expect(migrate({ schema: 0 }, {})).toMatchObject({ ok: false, reason: 'no migration from schema 0' });
    expect(migrate({ schema: 0 }, { 0: (x) => x })).toMatchObject({ ok: false, reason: 'migration 0 did not advance' });
    expect(migrate({ schema: 0 }, { 0: () => { throw new Error('boom'); } })).toMatchObject({ ok: false });
    expect(decodeSave({ schema: 2 })).toMatchObject({ ok: false });
  });

  it('corrupt settings are quarantined and read as null', async () => {
    const { store, raw } = setup();
    await store.probe();
    raw().set(KEYS.settings, { version: 1, audio: 'loud' });
    expect(await store.loadSettings()).toBeNull();
    expect(raw().has(KEYS.settingsQuarantine)).toBe(true);
  });

  it('reset clears saves, backups, quarantine and settings', async () => {
    const { store, raw } = setup();
    await store.save(record(1));
    await store.save(record(2));
    await store.saveSettings(settings());
    await store.reset();
    expect(raw().size).toBe(0);
    expect(await store.load()).toBeNull();
    expect(await store.loadSettings()).toBeNull();
  });

  it('is unavailable without indexedDB and when opening fails (private mode), never throwing', async () => {
    const none = createSaveStore({ indexedDB: null });
    expect(none.available()).toBe(false);
    expect(await none.load()).toBeNull();
    expect(await none.save(record())).toBe(false);
    await expect(none.reset()).resolves.toBeUndefined();
    expect(await none.saveSettings(settings())).toBe(false);
    expect(await none.loadSettings()).toBeNull();

    const g = globalThis as { indexedDB?: unknown };
    expect(g.indexedDB).toBeUndefined();
    expect(createSaveStore().available()).toBe(false);
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(createSaveStore().available()).toBe(false);
    } finally {
      delete g.indexedDB;
    }

    const idb = new FakeIdbBackend();
    idb.failOpen = true;
    const priv = createSaveStore({ indexedDB: idb.asFactory() });
    expect(await priv.probe()).toBe(false);
    expect(priv.available()).toBe(false);
    expect(await priv.save(record())).toBe(false);
    expect(idb.opens).toBe(1); // does not keep retrying

    const io = new FakeIdbBackend();
    const flaky = createSaveStore({ indexedDB: io.asFactory() });
    await flaky.probe();
    io.failOps = true;
    expect(await flaky.save(record())).toBe(false);
    expect(await flaky.load()).toBeNull();
  });

  it('storage code makes no network calls', () => {
    for (const f of readdirSync(new URL('../../src/storage/', import.meta.url))) {
      const src = readFileSync(new URL(`../../src/storage/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    }
  });
});
