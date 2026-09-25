/**
 * R03 / G02: the same seeded demo route under different renderer paths yields identical
 * simulation hashes (tick by tick, and at the final common tick after the plan completes).
 *
 * WebGPU itself is NOT testable here: headless Chromium on this host exposes no WebGPU adapter.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, facts, idbGet, installObserver, observation, waitForTick, waitReady, writeEvidence } from './helpers';
import { ctxCalls, gpuFacts, installGlProbe, rendererPath, type GlMode } from './gl-probe';
import { compareHashes, referenceRun } from './reference';

const ROUTE = 'upper' as const;
const ref = referenceRun(ROUTE, 4600);
const FINAL_TICK = Math.ceil((ref.planDoneTick + 1) / 250) * 250; // first hashed tick after the plan ends

interface VariantResult {
  variant: string; rendererSetting: string; path: string; backend: string | undefined; finalTick: number;
  finalHash: string | undefined; referenceFinalHash: string | undefined; mismatches: number; commonTicks: number;
  hashes: Record<string, string>; appErrors: string[] | undefined; pageErrors: string[]; consoleErrors: string[];
  contextCalls: unknown[];
}

async function runVariant(page: Page, variant: string, mode: GlMode, rendererSetting: 'auto' | 'webgl2', quality: 'auto' | 'low' | 'high' = 'auto'): Promise<VariantResult> {
  const errs = collectErrors(page);
  await installObserver(page);
  await installGlProbe(page, mode);
  if (rendererSetting !== 'auto' || quality !== 'auto') {
    // Set preferences through the real UI (persisted to IndexedDB), then boot the demo.
    await page.goto('/');
    await waitReady(page);
    if (quality !== 'auto') {
      await page.locator('[data-fl-modal="start"] [data-fk="quality"]').selectOption(quality);
      await expect.poll(async () => ((await idbGet(page, 'settings')) as { quality?: string } | undefined)?.quality).toBe(quality);
    }
    if (rendererSetting !== 'auto') {
      await page.locator('[data-fl-modal="start"] [data-fk="settings"]').click();
      await page.locator('[data-fk="Renderer (applies on reload)"]').selectOption(rendererSetting);
      await expect.poll(async () => ((await idbGet(page, 'settings')) as { renderer?: string } | undefined)?.renderer).toBe(rendererSetting);
    }
  }
  await page.goto(`/?demo=${ROUTE}&speed=8`);
  await waitReady(page);
  await waitForTick(page, FINAL_TICK + 5);
  const f = await facts(page);
  const obs = await observation(page);
  const calls = await ctxCalls(page);
  const cmp = compareHashes(obs.hashes, ref.hashes);
  return {
    variant, rendererSetting, path: rendererPath(calls), backend: f?.backend, finalTick: FINAL_TICK,
    finalHash: obs.hashes[String(FINAL_TICK)], referenceFinalHash: ref.hashes[String(FINAL_TICK)],
    mismatches: cmp.mismatches.length, commonTicks: cmp.commonTicks, hashes: obs.hashes,
    appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
    contextCalls: calls,
  };
}

const results: VariantResult[] = [];

test.describe.configure({ mode: 'serial' });

test('R03 variant A: default (auto) renderer -> three WebGPURenderer WebGL2 backend', async ({ page }) => {
  const r = await runVariant(page, 'A-auto', 'observe', 'auto');
  results.push(r);
  expect(r.path).toBe('WebGPURenderer(WebGL2 backend)');
  expect(r.backend).toBe('webgl2');
  expect(r.mismatches).toBe(0);
  expect(r.finalHash).toBe(r.referenceFinalHash);
});

test('R03 variant B: renderer setting "webgl2" chosen in the settings UI', async ({ page }) => {
  const r = await runVariant(page, 'B-setting-webgl2', 'observe', 'webgl2');
  results.push(r);
  expect(r.backend).toBe('webgl2');
  expect(r.mismatches).toBe(0);
  expect(r.finalHash).toBe(r.referenceFinalHash);
});

test('R03 variant C: classic WebGLRenderer (WebGPURenderer WebGL2 context withheld by test stub)', async ({ page }) => {
  const r = await runVariant(page, 'C-classic', 'force-classic', 'auto');
  results.push(r);
  expect(r.path).toBe('WebGLRenderer(classic)');
  expect(r.backend).toBe('webgl2');
  expect(r.appErrors).toEqual([]);
  expect(r.mismatches).toBe(0);
  expect(r.finalHash).toBe(r.referenceFinalHash);
});

for (const q of ['low', 'high'] as const) {
  test(`R04 quality preset "${q}" (start-screen quality select) leaves every simulation hash unchanged`, async ({ page }) => {
    const r = await runVariant(page, `R04-quality-${q}`, 'observe', 'auto', q);
    results.push(r);
    expect(r.appErrors).toEqual([]);
    expect(r.mismatches).toBe(0);
    expect(r.finalHash).toBe(r.referenceFinalHash);
  });
}

test('R03 cross-backend: identical final hash across all variants; WebGPU availability recorded', async ({ page }, info) => {
  await page.goto('/');
  const gpu = await gpuFacts(page);
  const finals = results.map((r) => ({ variant: r.variant, path: r.path, finalHash: r.finalHash }));
  writeEvidence('r03-cross-backend', {
    route: ROUTE, seed: 1047, speed: 8, finalTick: FINAL_TICK, planDoneTick: ref.planDoneTick,
    referenceFinalHash: ref.hashes[String(FINAL_TICK)], finals,
    variants: results.map(({ hashes: _h, contextCalls, ...rest }) => ({ ...rest, contextCalls })),
    gpu,
    webgpu: 'NOT TESTABLE on this host: headless Chromium exposes navigator.gpu but requestAdapter() returns no adapter; the app therefore never selects the WebGPU backend here.',
    forcingMethod: {
      A: 'no stub; app default preferred=auto',
      B: 'settings panel Renderer=WebGL2 persisted to IndexedDB, then ?demo boot (same attempt chain as auto when no adapter)',
      C: 'test-side getContext stub returns null for the first webgl2 request made by the three.webgpu chunk on the game canvas; the app chain then uses its classic WebGLRenderer. The app has no setting or query param to force the classic path directly (see reports/validation-requests.md).',
      R04: 'quality low / high chosen with the start-screen Quality select (persisted), default renderer path; the adaptive QualityGovernor also runs in every variant',
    },
  }, info);
  expect(results.length).toBe(5);
  expect(new Set(finals.map((x) => x.finalHash)).size, 'one final hash across backends').toBe(1);
  expect(finals[0]?.finalHash).toBe(ref.hashes[String(FINAL_TICK)]);
});
