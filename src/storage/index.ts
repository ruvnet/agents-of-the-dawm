/**
 * Local save store on native IndexedDB (ADR 0001: local only, reset option, no server, no analytics;
 * ADR 0004: stores replay/checkpoint data, never a WASM handle).
 *
 * Layout: one database, one key-value object store.
 *   save.current     latest valid SaveRecord
 *   save.backup      the previous valid record, kept on every overwrite
 *   save.quarantine  a rejected (corrupt, foreign or unknown-schema) record, kept for inspection
 *   save.premigrate  the original of the last record that was migrated on load
 *   settings         UiSettings, stored separately from progress
 *   settings.quarantine  rejected settings
 * No network access of any kind happens here.
 */
import { type SaveRecord, type SaveStore, type UiSettings } from '../contracts/ui';
import { DEFAULT_MAX_BYTES, decodeSave, validateSettings, type Migration } from './validate';

export * from './validate';

export const DB_NAME = 'agents-of-the-dawm.floodline';
/** IndexedDB structural version (object stores). Independent of SAVE_SCHEMA_VERSION. */
export const DB_VERSION = 1;
export const STORE = 'kv';
export const KEYS = {
  current: 'save.current',
  backup: 'save.backup',
  quarantine: 'save.quarantine',
  premigrate: 'save.premigrate',
  settings: 'settings',
  settingsQuarantine: 'settings.quarantine',
} as const;

export interface SaveStoreOptions {
  /** IDB factory; tests inject a fake. `null` forces the unavailable path. Default: globalThis.indexedDB. */
  readonly indexedDB?: IDBFactory | null;
  readonly dbName?: string;
  /** Expected manifest id; records for another level are rejected (and quarantined). */
  readonly manifestId?: string;
  readonly maxBytes?: number;
  readonly migrations?: Readonly<Record<number, Migration>>;
}

export interface FloodlineSaveStore extends SaveStore {
  /** The previous valid record, for a "restore previous save" action. */
  loadBackup(): Promise<SaveRecord | null>;
  /**
   * Open the database now. `available()` is synchronous, so a private-mode open failure only shows up
   * after the first async call; awaiting probe() at boot makes `available()` accurate immediately.
   */
  probe(): Promise<boolean>;
}

function resolveFactory(opts: SaveStoreOptions): IDBFactory | null {
  if (opts.indexedDB !== undefined) return opts.indexedDB;
  try {
    const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    return f ?? null;
  } catch {
    return null; // SecurityError in some sandboxed/private contexts
  }
}

export function createSaveStore(opts: SaveStoreOptions = {}): FloodlineSaveStore {
  const factory = resolveFactory(opts);
  const dbName = opts.dbName ?? DB_NAME;
  const decodeOpts = { manifestId: opts.manifestId, maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES, migrations: opts.migrations };
  let usable = factory !== null;
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function openDb(): Promise<IDBDatabase | null> {
    if (!usable || !factory) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      const fail = () => { usable = false; dbPromise = null; resolve(null); };
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(dbName, DB_VERSION);
      } catch {
        fail();
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = fail;
      req.onblocked = () => { dbPromise = null; resolve(null); };
    });
    return dbPromise;
  }

  /** Run `body` in one transaction; resolves `fallback` on any failure or abort. */
  async function run<T>(mode: IDBTransactionMode, fallback: T, body: (s: IDBObjectStore, set: (v: T) => void) => void): Promise<T> {
    const db = await openDb();
    if (!db) return fallback;
    return new Promise<T>((resolve) => {
      let result = fallback;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, mode);
      } catch {
        resolve(fallback);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(fallback);
      tx.onabort = () => resolve(fallback);
      try {
        body(tx.objectStore(STORE), (v) => { result = v; });
      } catch {
        try { tx.abort(); } catch { /* already finished */ }
        resolve(fallback);
      }
    });
  }

  function onGet(s: IDBObjectStore, key: string, fn: (value: unknown) => void): void {
    const r = s.get(key);
    r.onsuccess = () => fn(r.result);
  }

  function quarantine(s: IDBObjectStore, key: string, from: string, raw: unknown, reason: string): void {
    s.put({ quarantinedFrom: from, reason, raw }, key);
    s.delete(from);
  }

  return {
    available: () => usable,
    probe: async () => (await openDb()) !== null,

    load: () => run<SaveRecord | null>('readwrite', null, (s, set) => {
      onGet(s, KEYS.current, (raw) => {
        if (raw === undefined) return;
        const d = decodeSave(raw, decodeOpts);
        if (d.ok) {
          set(d.value);
          if (d.migrated) {
            s.put(raw, KEYS.premigrate);
            s.put(d.value, KEYS.current);
          }
        } else {
          quarantine(s, KEYS.quarantine, KEYS.current, raw, d.reason);
        }
      });
    }),

    loadBackup: () => run<SaveRecord | null>('readonly', null, (s, set) => {
      onGet(s, KEYS.backup, (raw) => {
        const d = raw === undefined ? null : decodeSave(raw, decodeOpts);
        if (d?.ok) set(d.value);
      });
    }),

    async save(record: SaveRecord): Promise<boolean> {
      const d = decodeSave(record, decodeOpts);
      if (!d.ok || d.migrated) return false; // only current-schema, valid records are written
      return run<boolean>('readwrite', false, (s, set) => {
        onGet(s, KEYS.current, (prev) => {
          if (prev !== undefined && decodeSave(prev, decodeOpts).ok) s.put(prev, KEYS.backup);
          s.put(record, KEYS.current);
          set(true);
        });
      });
    },

    async reset(): Promise<void> {
      await run<boolean>('readwrite', false, (s, set) => { s.clear(); set(true); });
    },

    loadSettings: () => run<UiSettings | null>('readwrite', null, (s, set) => {
      onGet(s, KEYS.settings, (raw) => {
        if (raw === undefined) return;
        const v = validateSettings(raw);
        if (v.ok) set(v.value);
        else quarantine(s, KEYS.settingsQuarantine, KEYS.settings, raw, v.reason);
      });
    }),

    async saveSettings(settings: UiSettings): Promise<boolean> {
      if (!validateSettings(settings).ok) return false;
      return run<boolean>('readwrite', false, (s, set) => { s.put(settings, KEYS.settings); set(true); });
    },
  };
}
