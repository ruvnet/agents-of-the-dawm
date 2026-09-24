/**
 * The app-side semantic read cache must produce exactly the FinalGraphView the uncached path does,
 * frame by frame, with the REAL worldgraph-wasm module, across a full playthrough (W7.PERF.01).
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cacheSemanticReads } from '../../src/app/semantic-cache';
import { loadSector01 } from '../../src/contracts/fixtures';
import { createSimulation } from '../../src/sim';
import { createAutopilot, fullPlan } from '../../src/sim/autopilot';
import { composeFinalGraphView, createWorldgraphAdapter } from '../../src/world';
import { realLoader } from '../../tests/world/helpers';

const STORY = new Set(['ChannelLocated', 'SensorVerified', 'EdgeRestored', 'TransferAuthorized', 'GateOpened']);

describe('semantic read cache', () => {
  for (const route of ['upper', 'lower'] as const) {
    it(`matches the uncached FinalGraphView every frame (${route})`, async () => {
      const m = loadSector01();
      const raw = createWorldgraphAdapter({ loader: realLoader });
      const cached = cacheSemanticReads(createWorldgraphAdapter({ loader: realLoader }));
      expect(await raw.init(m)).toBe('ready');
      expect(await cached.view.init(m)).toBe('ready');
      const sim = createSimulation(m, { seed: 1047 });
      const pilot = createAutopilot(m, fullPlan(route));
      let frames = 0;
      let rawNs = 0n;
      let cachedNs = 0n;
      while (!pilot.done) {
        const c = pilot.next(sim.state());
        if (!c) break;
        const story = sim.step(c).filter((e) => STORY.has(e.type));
        if (story.length) { raw.enqueue(story); cached.view.enqueue(story); }
        const t = (sim.state().tick * 1000) / 60;
        raw.flush(t);
        cached.view.flush(t);
        const pv = sim.pressureView();
        const t0 = process.hrtime.bigint();
        const a = composeFinalGraphView(pv, raw, m);
        const t1 = process.hrtime.bigint();
        const b = composeFinalGraphView(pv, cached.view, m);
        const t2 = process.hrtime.bigint();
        rawNs += t1 - t0;
        cachedNs += t2 - t1;
        expect(b).toEqual(a);
        frames += 1;
      }
      expect(raw.appliedBatches()).toBeGreaterThan(0);
      expect(cached.view.canonicalDigest()).toBe(raw.canonicalDigest());
      // One digest + one provenance fill per derived state per applied batch (plus the initial one).
      expect(cached.fills()).toBeLessThan(frames / 20);
      const out = process.env.PERF_OUT_SEMANTIC;
      const result = { route, frames, batches: raw.appliedBatches(), fills: cached.fills(), uncachedUsPerCompose: Number(rawNs) / frames / 1000, cachedUsPerCompose: Number(cachedNs) / frames / 1000 };
      console.log(JSON.stringify(result));
      if (out) writeFileSync(out.replace('.json', `-${route}.json`), `${JSON.stringify(result, null, 2)}\n`);
    });
  }
});
