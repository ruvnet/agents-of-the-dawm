/**
 * Pure save validation and bounded schema migration (ADR 0001 local saves, ADR 0004 replay/checkpoint).
 */
import { SAVE_SCHEMA_VERSION, type SaveRecord, type UiSettings } from '../contracts/ui';

export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
/** Oldest schema this build can still migrate from. Anything older or newer is rejected. */
export const MIN_SUPPORTED_SCHEMA = 0;
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
const MAX_KEY_LEN = 128;

export type Raw = Record<string, unknown>;
export type Migration = (raw: Raw) => Raw;
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_KEY_LEN): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * v0 -> v1. v0 is the pre-contract draft layout (`manifest`, `tick`, `checkpoint`, `hash`); v1 is the
 * frozen SaveRecord. Kept as the reference migration and the pattern for future schema bumps.
 */
export const DEFAULT_MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: (r) => ({
    schema: 1,
    manifestId: r.manifest,
    seed: r.seed,
    savedAtTick: r.tick,
    checkpointKey: r.checkpoint,
    snapshot: r.snapshot,
    stateHash: r.hash,
    settings: r.settings,
  }),
};

/** Walk a value: every number finite, bounded depth and node count, no functions or symbols. */
export function allFinite(v: unknown): boolean {
  let nodes = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (typeof x === 'number') return Number.isFinite(x);
    if (x === null || typeof x === 'string' || typeof x === 'boolean' || x === undefined) return true;
    if (typeof x !== 'object') return false;
    const vals = Array.isArray(x) ? x : Object.values(x as object);
    return vals.every((y) => walk(y, depth + 1));
  };
  return walk(v, 0);
}

export function byteSize(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? '').length;
  } catch {
    return Number.POSITIVE_INFINITY; // cyclic or unserialisable
  }
}

/** Structural check of UiSettings (shape and ranges the game depends on). */
export function validateSettings(v: unknown): Result<UiSettings> {
  if (!isObj(v)) return { ok: false, reason: 'settings: not an object' };
  if (v.version !== 1) return { ok: false, reason: 'settings: unknown version' };
  const a = v.audio;
  if (!isObj(a) || typeof a.muted !== 'boolean') return { ok: false, reason: 'settings: audio' };
  for (const k of ['master', 'speech', 'effects', 'music'] as const) {
    const n = a[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return { ok: false, reason: `settings: audio.${k}` };
  }
  if (!isObj(v.camera) || !isObj(v.assist) || !isObj(v.bindings) || !isObj(v.bindings.keyboard)) {
    return { ok: false, reason: 'settings: camera/assist/bindings' };
  }
  if (typeof v.captions !== 'boolean' || ![1, 1.5, 2].includes(v.textScale as number)) return { ok: false, reason: 'settings: captions/textScale' };
  if (typeof v.lookSensitivity !== 'number' || !Number.isFinite(v.lookSensitivity)) return { ok: false, reason: 'settings: lookSensitivity' };
  if (!allFinite(v)) return { ok: false, reason: 'settings: non-finite number' };
  return { ok: true, value: v as unknown as UiSettings };
}

export interface ValidateOptions {
  readonly manifestId?: string;
  readonly maxBytes?: number;
}

/** Validate a record already at SAVE_SCHEMA_VERSION. */
export function validateSaveRecord(v: unknown, o: ValidateOptions = {}): Result<SaveRecord> {
  if (!isObj(v)) return { ok: false, reason: 'not an object' };
  if (byteSize(v) > (o.maxBytes ?? DEFAULT_MAX_BYTES)) return { ok: false, reason: 'size cap exceeded' };
  if (v.schema !== SAVE_SCHEMA_VERSION) return { ok: false, reason: `schema ${String(v.schema)}` };
  if (!isStr(v.manifestId)) return { ok: false, reason: 'manifestId' };
  if (o.manifestId !== undefined && v.manifestId !== o.manifestId) return { ok: false, reason: `manifestId ${v.manifestId} != ${o.manifestId}` };
  if (!isInt(v.seed)) return { ok: false, reason: 'seed' };
  if (!isInt(v.savedAtTick) || v.savedAtTick < 0) return { ok: false, reason: 'savedAtTick' };
  if (!isStr(v.checkpointKey)) return { ok: false, reason: 'checkpointKey' };
  if (!isStr(v.stateHash)) return { ok: false, reason: 'stateHash' };
  const snap = v.snapshot;
  if (!isObj(snap) || snap.version !== 1 || !isObj(snap.state) || snap.state.version !== 1) return { ok: false, reason: 'snapshot' };
  if (!allFinite(snap)) return { ok: false, reason: 'snapshot: non-finite number' };
  const s = validateSettings(v.settings);
  if (!s.ok) return s;
  return { ok: true, value: v as unknown as SaveRecord };
}

/**
 * Migrate to SAVE_SCHEMA_VERSION in at most (target - MIN_SUPPORTED_SCHEMA) steps. Future or
 * unknown schemas, a missing step, or a step that does not advance the version are rejected.
 */
export function migrate(
  v: unknown, migrations: Readonly<Record<number, Migration>> = DEFAULT_MIGRATIONS, target = SAVE_SCHEMA_VERSION,
): Result<Raw> & { steps?: number } {
  if (!isObj(v)) return { ok: false, reason: 'not an object' };
  let cur: Raw = v;
  let steps = 0;
  const maxSteps = target - MIN_SUPPORTED_SCHEMA;
  while (cur.schema !== target) {
    const from = cur.schema;
    if (!isInt(from) || from < MIN_SUPPORTED_SCHEMA || from > target) return { ok: false, reason: `unsupported schema ${String(from)}` };
    const step = migrations[from];
    if (!step || steps >= maxSteps) return { ok: false, reason: `no migration from schema ${from}` };
    try {
      cur = step(structuredClone(cur));
    } catch (e) {
      return { ok: false, reason: `migration ${from} failed: ${(e as Error).message}` };
    }
    if (!isObj(cur) || !isInt(cur.schema) || cur.schema <= from) return { ok: false, reason: `migration ${from} did not advance` };
    steps += 1;
  }
  return { ok: true, value: cur, steps };
}

/** Migrate then validate. */
export function decodeSave(
  v: unknown, o: ValidateOptions & { migrations?: Readonly<Record<number, Migration>> } = {},
): Result<SaveRecord> & { migrated?: boolean } {
  if (byteSize(v) > (o.maxBytes ?? DEFAULT_MAX_BYTES)) return { ok: false, reason: 'size cap exceeded' };
  const m = migrate(v, o.migrations);
  if (!m.ok) return m;
  const r = validateSaveRecord(m.value, o);
  return r.ok ? { ...r, migrated: (m.steps ?? 0) > 0 } : r;
}
