/**
 * Optional, read-only performance probe (W7.PERF.01). Startup milestones are one-shot
 * `performance.mark`s (always on, a handful per session). Per-frame CPU timing is recorded only
 * when the probe is enabled (`?perf` in the URL or `AppDeps.perfProbe`); when disabled every
 * recording call is a no-op branch and nothing is allocated. It never touches simulation state.
 */

export const PERF_MARKS = [
  'fl:boot', 'fl:renderer-init-start', 'fl:renderer-init-done', 'fl:controllable', 'fl:start', 'fl:first-tick', 'fl:semantic-ready',
] as const;
export type PerfMark = (typeof PERF_MARKS)[number];

/** Per-frame series (ms), all captured inside the app frame function. */
export const PERF_SERIES = ['frame', 'ticks', 'render', 'graph', 'ui', 'scale', 'nticks'] as const;
export type PerfSeries = (typeof PERF_SERIES)[number];

export interface PerfSnapshot {
  readonly enabled: boolean;
  /** startTime (ms since navigation start) of each milestone reached so far. */
  readonly marks: Readonly<Partial<Record<PerfMark, number>>>;
  /** Total frames recorded since enable (the ring keeps the last `capacity`). */
  readonly frames: number;
  readonly capacity: number;
  /** Oldest-first copies of the ring contents. */
  readonly series: Readonly<Partial<Record<PerfSeries, number[]>>>;
}

export interface PerfProbe {
  readonly enabled: boolean;
  mark(name: PerfMark): void;
  record(sample: Readonly<Record<PerfSeries, number>>): void;
  snapshot(): PerfSnapshot;
}

const perf = (): Performance | null => (typeof performance !== 'undefined' ? performance : null);

export function createPerfProbe(enabled: boolean, capacity = 8192): PerfProbe {
  const seen = new Set<PerfMark>();
  const rings = enabled ? PERF_SERIES.map(() => new Float64Array(capacity)) : [];
  let n = 0;
  return {
    enabled,
    mark(name) {
      if (seen.has(name)) return;
      seen.add(name);
      try { perf()?.mark(name); } catch { /* marks are evidence only */ }
    },
    record(sample) {
      if (!enabled) return;
      const i = n % capacity;
      for (let k = 0; k < PERF_SERIES.length; k++) rings[k]![i] = sample[PERF_SERIES[k]!];
      n += 1;
    },
    snapshot() {
      const marks: Partial<Record<PerfMark, number>> = {};
      const p = perf();
      for (const name of seen) {
        const e = p?.getEntriesByName(name, 'mark')[0];
        if (e) marks[name] = e.startTime;
      }
      const series: Partial<Record<PerfSeries, number[]>> = {};
      if (enabled) {
        const len = Math.min(n, capacity);
        const start = n > capacity ? n % capacity : 0;
        PERF_SERIES.forEach((name, k) => {
          const out: number[] = new Array(len);
          for (let j = 0; j < len; j++) out[j] = rings[k]![(start + j) % capacity]!;
          series[name] = out;
        });
      }
      return { enabled, marks, frames: n, capacity, series };
    },
  };
}

export function perfProbeRequested(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
  } catch {
    return false;
  }
}
