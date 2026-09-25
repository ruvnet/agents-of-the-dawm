import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/app/stepper';
import { createAutopilotInput } from '../../src/app/autopilot-input';
import { loadSector01 } from '../../src/contracts/fixtures';
import { createSimulation } from '../../src/sim';
import { TICK_MS } from '../../src/contracts/sim';

describe('FixedStepper', () => {
  it('runs the same number of ticks for the same elapsed time at 30/60/120 fps', () => {
    const counts = [30, 60, 120].map((fps) => {
      const st = new FixedStepper(1000);
      let ticks = 0;
      for (let f = 0; f <= fps * 10; f++) ticks += st.advance((f * 1000) / fps).ticks;
      return ticks;
    });
    expect(Math.abs(counts[0]! - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(counts[1]! - counts[2]!)).toBeLessThanOrEqual(1);
  });

  it('clamps catch-up after a long stall and keeps alpha in [0,1]', () => {
    const st = new FixedStepper();
    st.advance(0);
    const r = st.advance(5000);
    expect(r.ticks).toBeLessThanOrEqual(5);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThanOrEqual(1);
    expect(st.advance(5000 + TICK_MS).ticks).toBe(1);
  });
});

describe('autopilot input through the app sampling contract', () => {
  it('drives the real simulation to an open gate via InputSource.sample (demo mode)', () => {
    const manifest = loadSector01();
    for (const route of ['upper', 'lower'] as const) {
      const sim = createSimulation(manifest, { seed: 1047 });
      const input = createAutopilotInput(manifest, route);
      for (let i = 0; i < 60 * 60 * 10 && !sim.state().tramCrossed; i++) {
        const s = sim.state();
        sim.step(input.sample({ tick: s.tick, state: s, manifest, uiCapturing: false, settings: {} as never }));
      }
      const s = sim.state();
      expect(s.flags).toMatchObject({ gateOpen: true, playerAuthorized: true, channelEdgeRestored: true });
      expect(s.tramCrossed).toBe(true);
      expect(s.branch).toBe(route);
    }
  });
});
