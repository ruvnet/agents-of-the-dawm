/**
 * Minimal in-memory IndexedDB fake covering only what src/storage uses: open + upgrade, one
 * key-value object store, get/put/delete/clear, request and transaction callbacks.
 * Values are structured-cloned like the real thing. Not a general-purpose IDB implementation.
 */

type Handler = ((ev: unknown) => void) | null;

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

class FakeStore {
  constructor(private readonly data: Map<string, unknown>, private readonly tx: FakeTransaction) {}
  private req<T>(fn: () => T): FakeRequest<T> {
    const r = new FakeRequest<T>();
    this.tx.pending += 1;
    queueMicrotask(() => {
      try {
        if (this.tx.backend.failOps) throw new Error('QuotaExceededError');
        r.result = fn();
        r.onsuccess?.({ target: r });
      } catch (e) {
        r.error = e as Error;
        r.onerror?.({ target: r });
        this.tx.aborted = true;
      } finally {
        this.tx.settle();
      }
    });
    return r;
  }
  get(key: string) { return this.req(() => (this.data.has(key) ? structuredClone(this.data.get(key)) : undefined)); }
  put(value: unknown, key: string) {
    if (this.tx.mode !== 'readwrite') throw new Error('ReadOnlyError');
    const v = structuredClone(value);
    return this.req(() => { this.tx.writes.push(() => this.data.set(key, v)); return key; });
  }
  delete(key: string) { return this.req(() => { this.tx.writes.push(() => this.data.delete(key)); return undefined; }); }
  clear() { return this.req(() => { this.tx.writes.push(() => this.data.clear()); return undefined; }); }
}

class FakeTransaction {
  pending = 0;
  aborted = false;
  done = false;
  writes: (() => void)[] = [];
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: Error | null = null;
  constructor(readonly backend: FakeIdbBackend, readonly mode: string, private readonly data: Map<string, unknown>) {
    // An empty transaction still completes.
    queueMicrotask(() => { if (this.pending === 0) this.settle(); });
  }
  objectStore(_name: string) { return new FakeStore(this.data, this); }
  abort() { this.aborted = true; this.pending = 1; this.settle(); }
  /** Reads inside the tx see committed data only; writes apply atomically on completion. */
  settle() {
    this.pending = Math.max(0, this.pending - 1);
    queueMicrotask(() => {
      if (this.done || this.pending > 0) return;
      this.done = true;
      if (this.aborted) { this.error = new Error('AbortError'); this.onerror?.({}); this.onabort?.({}); return; }
      for (const w of this.writes) w();
      this.oncomplete?.({});
    });
  }
}

class FakeDb {
  readonly stores = new Map<string, Map<string, unknown>>();
  onversionchange: Handler = null;
  constructor(readonly backend: FakeIdbBackend, readonly version: number) {}
  get objectStoreNames() { return { contains: (n: string) => this.stores.has(n) }; }
  createObjectStore(name: string) { const m = new Map<string, unknown>(); this.stores.set(name, m); return {}; }
  transaction(names: string | string[], mode = 'readonly') {
    const name = Array.isArray(names) ? names[0]! : names;
    const data = this.stores.get(name);
    if (!data) throw new Error('NotFoundError');
    return new FakeTransaction(this.backend, mode, data);
  }
  close() {}
}

export class FakeIdbBackend {
  readonly dbs = new Map<string, FakeDb>();
  /** Simulate private mode: open() fails asynchronously. */
  failOpen = false;
  /** Simulate a quota/IO error on every request. */
  failOps = false;
  opens = 0;

  open(name: string, version = 1) {
    this.opens += 1;
    const req = new FakeRequest<FakeDb>();
    queueMicrotask(() => {
      if (this.failOpen) { req.error = new Error('InvalidStateError'); req.onerror?.({ target: req }); return; }
      let db = this.dbs.get(name);
      const oldVersion = db?.version ?? 0;
      if (!db || db.version < version) {
        const next = new FakeDb(this, version);
        if (db) for (const [k, v] of db.stores) next.stores.set(k, v);
        db = next;
        this.dbs.set(name, db);
        req.result = db;
        req.onupgradeneeded?.({ target: req, oldVersion, newVersion: version });
      }
      req.result = db;
      req.onsuccess?.({ target: req });
    });
    return req;
  }

  /** Test helper: raw access to a store's contents. */
  raw(dbName: string, store: string): Map<string, unknown> {
    const m = this.dbs.get(dbName)?.stores.get(store);
    if (!m) throw new Error(`no store ${dbName}/${store}`);
    return m;
  }

  asFactory(): IDBFactory { return this as unknown as IDBFactory; }
}
