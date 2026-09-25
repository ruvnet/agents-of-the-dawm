/**
 * P01/P03: the seeded demo playthrough (W1 autopilot driving the real simulation through the real
 * app loop, renderer and UI) reaches the rescue on both routes with zero app/page errors.
 * The playthrough is also compared tick-by-tick with a headless Node reference (G02 evidence).
 */
import { expect, test } from '@playwright/test';
import {
  collectErrors, facts, installObserver, observation, shotPath, waitForTick, waitForTram, waitReady, writeEvidence,
} from './helpers';
import { compareHashes, referenceRun } from './reference';

for (const route of ['upper', 'lower'] as const) {
  test(`P01/P03 demo ${route} route reaches gateOpen, playerAuthorized, channelEdgeRestored, tramCrossed with zero errors`, async ({ page }, info) => {
    const errs = collectErrors(page);
    await installObserver(page);
    const t0 = Date.now();
    await page.goto(`/?demo=${route}&speed=8`);
    await waitReady(page);
    await waitForTram(page);
    const tramWallMs = Date.now() - t0;
    const tramFacts = await facts(page);
    // Let the post-crossing epilogue (wider map, further outlines) play out past the plan end.
    const ref = referenceRun(route, (tramFacts?.tick ?? 0) + 1200);
    await waitForTick(page, ref.planDoneTick + 60);
    const f = await facts(page);
    const obs = await observation(page);
    await page.screenshot({ path: shotPath(`demo-${route}-ending`), scale: 'css' });
    const cmp = compareHashes(obs.hashes, ref.hashes);
    const browserKeyIds = obs.events.filter((e) => ['CheckpointReached', 'GateOpened', 'TramCrossed'].includes(e.type)).map((e) => e.id);
    const gateOpened = obs.events.filter((e) => e.type === 'GateOpened');
    writeEvidence(`demo-${route}`, {
      route, speed: 8, seed: 1047, wallMsToTramCrossed: tramWallMs,
      backend: f?.backend, semanticStatus: f?.semanticStatus,
      finalFlags: f?.flags, tramCrossed: f?.tramCrossed, branch: f?.branch, beat: f?.beat, checkpointKey: f?.checkpointKey,
      tick: f?.tick, hash: f?.hash, captionLines: f?.captionCount, commands: f?.commandCount,
      gateOpenedEvents: gateOpened.length,
      appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors, consoleWarnings: errs.consoleWarnings,
      nodeReference: { planDoneTick: ref.planDoneTick, tramTick: ref.tramTick, keyEvents: ref.keyEventIds.length },
      hashComparison: cmp, keyEventIdsMatch: JSON.stringify(browserKeyIds) === JSON.stringify(ref.keyEventIds.slice(0, browserKeyIds.length)),
      observerPatchedSims: obs.patched, observerErrors: obs.stepErrors,
    }, info);

    expect(f, 'simulation running').not.toBeNull();
    expect(f!.flags.channelLocated).toBe(true);
    expect(f!.flags.channelSensorVerified).toBe(true);
    expect(f!.flags.channelEdgeRestored).toBe(true);
    expect(f!.flags.playerAuthorized).toBe(true);
    expect(f!.flags.capacitySafe).toBe(true);
    expect(f!.flags.gateOpen).toBe(true);
    expect(f!.tramCrossed).toBe(true);
    expect(f!.branch).toBe(route);
    expect(gateOpened.length, 'GateOpened exactly once').toBe(1);
    expect(f!.appErrors, 'window.__floodline.errors()').toEqual([]);
    expect(errs.pageErrors, 'page errors').toEqual([]);
    expect(errs.consoleErrors, 'console errors').toEqual([]);
    expect(cmp.commonTicks).toBeGreaterThan(10);
    expect(cmp.mismatches, 'browser hashes equal the headless reference').toEqual([]);
    expect(obs.stepErrors).toEqual([]);
  });
}
