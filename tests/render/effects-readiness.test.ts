import { describe, expect, it } from 'vitest';
import {
  EffectTimeline, flashOpacity, gateOpenAmount, seamIntensity, shakeOffset, tramTravel,
} from '../../src/render/effects';
import { ReadinessTracker } from '../../src/render/readiness';
import { ev } from './fixtures';

const ctx = { playerPos: [1, 2, 3] as [number, number, number], playerForward: [1, 0, 0] as [number, number, number] };

describe('EffectTimeline', () => {
  it('maps world events to render effects and dedupes by id', () => {
    const t = new EffectTimeline();
    const batch = [ev('ShiftCommitted', 1, 'a1'), ev('ToolPulse', 1), ev('ToolSpike', 1), ev('SurgeTelegraph', 2, 'keeper'),
      ev('SealBroken', 3, 'keeper'), ev('GateOpened', 4, 'gate'), ev('TramCrossed', 5, 'tram'), ev('DialogueCue', 5, 'S01')];
    const added = t.ingest(batch, 0, ctx);
    expect(added.map((a) => a.kind)).toEqual(['shift-flash', 'pulse-ring', 'spike-trail', 'surge-telegraph', 'seal-break', 'gate-open', 'tram-crossing']);
    expect(t.ingest(batch, 10, ctx)).toHaveLength(0);
    expect(added[1]!.origin).toEqual([1, 2, 3]);
  });

  it('expires transient effects and keeps persistent ones', () => {
    const t = new EffectTimeline();
    t.ingest([ev('ToolPulse', 1), ev('SurgeTelegraph', 1), ev('GateOpened', 1, 'gate')], 0, ctx);
    expect(t.update(1000).map((a) => a.kind).sort()).toEqual(['gate-open', 'surge-telegraph']);
    expect(t.update(3001).map((a) => a.kind)).toEqual(['gate-open']);
    expect(t.update(1e9).map((a) => a.kind)).toEqual(['gate-open']);
  });

  it('bounds its dedupe memory', () => {
    const t = new EffectTimeline(4);
    for (let i = 0; i < 10; i++) t.ingest([ev('ToolPulse', i)], i, ctx);
    expect(t.ingest([ev('ToolPulse', 0)], 100, ctx)).toHaveLength(1); // forgotten id may re-fire
  });

  it('surge telegraph pulses three times over 3 s; reduced flashes do not strobe', () => {
    const peaks = [1 / 6, 3 / 6, 5 / 6].map((p) => seamIntensity(p, false));
    for (const v of peaks) expect(v).toBeCloseTo(1);
    expect(seamIntensity(2 / 6, false)).toBeCloseTo(0.25);
    const reduced = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => seamIntensity(p, true));
    for (let i = 1; i < reduced.length; i++) expect(reduced[i]!).toBeGreaterThanOrEqual(reduced[i - 1]!);
    expect(Math.max(...reduced)).toBeLessThanOrEqual(0.75);
    expect(flashOpacity(0, true)).toBeLessThan(flashOpacity(0, false));
  });

  it('gate and tram follow sim flags; restored saves render the end state', () => {
    const t = new EffectTimeline();
    expect(gateOpenAmount(false, undefined, 0)).toBe(0);
    expect(gateOpenAmount(true, undefined, 0)).toBe(1);
    t.ingest([ev('GateOpened', 1, 'gate'), ev('TramCrossed', 2, 'tram')], 0, ctx);
    expect(gateOpenAmount(true, t.find('gate-open'), 2000)).toBeCloseTo(0.5);
    expect(tramTravel(false, t.find('tram-crossing'), 5000)).toBe(0); // render never runs ahead of sim
    expect(tramTravel(true, t.find('tram-crossing'), 4500)).toBeCloseTo(0.5);
  });

  it('camera shake is zero under reducedMotion', () => {
    const t = new EffectTimeline();
    t.ingest([ev('Surge', 1, 'keeper')], 0, ctx);
    expect(shakeOffset(t.live(), 100, true)).toEqual([0, 0, 0]);
    expect(Math.hypot(...shakeOffset(t.live(), 100, false))).toBeGreaterThan(0);
  });
});

describe('ReadinessTracker', () => {
  it('initializing → controllable → optional-loading → complete, one optional step per frame', () => {
    const r = new ReadinessTracker();
    const built: string[] = [];
    for (const n of ['sky', 'fog', 'spray']) r.enqueueOptional(n, () => built.push(n));
    expect(r.afterFrame()).toBe('initializing'); // critical layer not yet built
    r.markCriticalBuilt();
    expect(r.afterFrame()).toBe('controllable');
    expect(built).toEqual([]); // optional detail never precedes control
    expect(r.afterFrame()).toBe('optional-loading');
    expect(built).toEqual(['sky']);
    expect(r.afterFrame()).toBe('optional-loading');
    expect(r.afterFrame()).toBe('complete');
    expect(built).toEqual(['sky', 'fog', 'spray']);
  });

  it('a failing optional step is recorded and does not block completion', () => {
    const r = new ReadinessTracker();
    r.enqueueOptional('spray', () => { throw new Error('corrupt optional asset'); });
    r.markCriticalBuilt();
    r.afterFrame();
    expect(r.afterFrame()).toBe('complete');
    expect(r.failures()).toEqual(['spray']);
  });
});
