import { describe, expect, it } from 'vitest';
import { QualityGovernor, TIER_PRESETS } from '../../src/render/quality';

const cfg = { windowSize: 5, cooldownMs: 1000, targetMs: 10, degradeRatio: 1.2, improveRatio: 0.6, minScale: 0.5, maxScale: 1, scaleStep: 0.1 };

/** Feed `n` samples of `ms`, advancing time by `dt` each frame. Returns the decisions and final time. */
function feed(g: QualityGovernor, ms: number, n: number, t0: number, dt = 16) {
  const out = [];
  let t = t0;
  for (let i = 0; i < n; i++) { t += dt; out.push(g.sample(ms, t)); }
  return { out, t };
}

describe('QualityGovernor', () => {
  it('waits for a full window before deciding', () => {
    const g = new QualityGovernor(cfg);
    const { out } = feed(g, 50, 4, 0);
    expect(out.every((d) => d.reason === 'warming' && !d.changed)).toBe(true);
  });

  it('lowers optional effects before internal scale', () => {
    const g = new QualityGovernor(cfg);
    let t = 0;
    const reasons: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = feed(g, 50, 5, t);
      t = r.t + 1000; // step past cooldown
      for (const d of r.out) if (d.changed) reasons.push(d.reason);
    }
    expect(reasons.slice(0, 2)).toEqual(['degrade-effects', 'degrade-effects']);
    expect(reasons[2]).toBe('degrade-scale');
    expect(g.state().effectsLevel).toBe(0);
  });

  it('never leaves [minScale, maxScale]', () => {
    const g = new QualityGovernor(cfg);
    let t = 0;
    for (let i = 0; i < 60; i++) t = feed(g, 1000, 5, t).t + 1000;
    expect(g.state().internalScale).toBe(0.5);
    for (let i = 0; i < 60; i++) t = feed(g, 0.1, 5, t).t + 1000;
    expect(g.state().internalScale).toBe(1);
    expect(g.state().effectsLevel).toBe(2);
  });

  it('holds steady inside the hysteresis band', () => {
    const g = new QualityGovernor(cfg);
    const { out } = feed(g, 10, 50, 0, 100); // mean == target: between 6 and 12 ms
    expect(out.some((d) => d.changed)).toBe(false);
    expect(out.at(-1)!.reason).toBe('steady');
  });

  it('respects the cooldown between changes', () => {
    const g = new QualityGovernor(cfg);
    const { out } = feed(g, 50, 40, 0, 16); // 40 frames * 16 ms = 640 ms < 1000 ms cooldown
    expect(out.filter((d) => d.changed)).toHaveLength(1);
    expect(out.slice(5).some((d) => d.reason === 'cooldown')).toBe(true);
  });

  it('ignores non-finite and negative samples', () => {
    const g = new QualityGovernor(cfg);
    feed(g, Number.NaN, 10, 0);
    feed(g, -5, 10, 0);
    expect(g.rollingMeanMs()).toBe(0);
    expect(g.sample(Infinity, 1).reason).toBe('warming');
  });

  it('exposes render-only knobs and nothing that can touch simulation ticks', () => {
    const g = new QualityGovernor(cfg);
    const decisions = feed(g, 50, 30, 0, 200).out;
    const allowed = new Set(['internalScale', 'effectsLevel', 'changed', 'reason']);
    for (const d of decisions) {
      for (const k of Object.keys(d)) expect(allowed.has(k)).toBe(true);
      expect(Object.keys(d).some((k) => /tick|step|hz|dt/i.test(k))).toBe(false);
    }
    const methodNames = Object.getOwnPropertyNames(QualityGovernor.prototype);
    expect(methodNames.some((k) => /tick|step/i.test(k))).toBe(false);
    // A fixed-tick clock driven alongside the governor is unaffected by any quality change.
    let ticks = 0;
    const g2 = new QualityGovernor(cfg);
    for (let f = 0; f < 600; f++) { ticks += 1; g2.sample(f % 2 ? 100 : 1, f * 16); }
    expect(ticks).toBe(600);
  });

  it('forTier bounds scale and effects by tier preset', () => {
    const low = QualityGovernor.forTier('low');
    expect(low.state()).toEqual({ internalScale: TIER_PRESETS.low.maxScale, effectsLevel: 0 });
    const high = QualityGovernor.forTier('high');
    expect(high.state()).toEqual({ internalScale: 1, effectsLevel: 2 });
    expect(() => new QualityGovernor({ minScale: 1, maxScale: 0.5 })).toThrow();
  });
});
