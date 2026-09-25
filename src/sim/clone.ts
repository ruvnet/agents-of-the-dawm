/**
 * Fast deep copy for plain simulation data (W7.PERF.01). SimState is JSON-shaped (plain objects,
 * arrays, numbers, strings, booleans, null), and a full `structuredClone` of it per tick was ~80%
 * of the tick cost. This walks the same data with no serialisation step. Every array and plain
 * object at every depth is a fresh copy, so a previously committed state is never shared with,
 * or mutated through, the next one. Anything that is not a plain object or array (Map, Set, Date,
 * typed array, class instance) falls back to `structuredClone` for that value, so the result is
 * never less isolated than before.
 */
export function clonePlain<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const n = value.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = clonePlain(value[i]);
    return out as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return structuredClone(value);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = proto === null ? Object.create(null) : {};
  for (const k of Object.keys(src)) out[k] = clonePlain(src[k]);
  return out as T;
}
