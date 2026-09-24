/**
 * R05: renderer failure paths. No WebGPU adapter is the default on this host (recorded). WebGL
 * context loss is simulated with WEBGL_lose_context on the game canvas; the fatal compatibility
 * screen is exercised by making every getContext return null.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, facts, shotPath, waitReady, waitForTick, writeEvidence } from './helpers';
import { ctxCalls, gpuFacts, installGlProbe, rendererPath } from './gl-probe';

async function loseGameContext(page: Page): Promise<{ hasGl: boolean; hasExt: boolean; lostAfter: boolean | null }> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas#game') as HTMLCanvasElement | null;
    const gl = c?.getContext('webgl2') as WebGL2RenderingContext | null | undefined;
    const ext = gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
    (window as unknown as { __w6lose?: unknown }).__w6lose = ext ?? null;
    return { hasGl: !!gl, hasExt: !!ext, lostAfter: gl ? gl.isContextLost() : null };
  });
}

async function fatalState(page: Page): Promise<{ visible: boolean; text: string; buttons: string[] }> {
  const fatal = page.locator('[data-fl-modal="fatal"]');
  const visible = await fatal.isVisible().catch(() => false);
  return {
    visible,
    text: visible ? (await fatal.innerText()).slice(0, 600) : '',
    buttons: visible ? await fatal.locator('button').allInnerTexts() : [],
  };
}

async function runContextLoss(page: Page) {
  const errs = collectErrors(page);
  await installGlProbe(page, 'observe');
  await page.goto('/?demo=upper&speed=2');
  await waitReady(page);
  await waitForTick(page, 300);
  const before = await facts(page);
  const pathBefore = rendererPath(await ctxCalls(page));
  const lose = await loseGameContext(page);
  await page.waitForTimeout(2500);
  const afterLoss = await facts(page);
  const fatalAfterLoss = await fatalState(page);
  await page.screenshot({ path: shotPath('r05-after-context-loss'), scale: 'css' });
  // Try the app's own recovery affordance, first on the still-lost context...
  let retry1: unknown = null;
  if (fatalAfterLoss.visible) {
    await page.locator('[data-fl-modal="fatal"] button').first().click();
    await page.waitForTimeout(2000);
    retry1 = { backend: (await facts(page))?.backend, fatal: await fatalState(page) };
  }
  // ...then after the browser restores the context (WEBGL_lose_context.restoreContext).
  await page.evaluate(() => (window as unknown as { __w6lose?: { restoreContext(): void } | null }).__w6lose?.restoreContext());
  await page.waitForTimeout(1500);
  let retry2: unknown = null;
  const fatalAfterRestore = await fatalState(page);
  if (fatalAfterRestore.visible) {
    await page.locator('[data-fl-modal="fatal"] button').first().click();
    await page.waitForTimeout(2500);
  }
  retry2 = { backend: (await facts(page))?.backend, fatal: await fatalState(page) };
  const end = await facts(page);
  const calls = await ctxCalls(page);
  const data = {
    speed: 2, lose, pathBefore, backendBefore: before?.backend, tickAtLoss: before?.tick,
    afterLoss: { backend: afterLoss?.backend, tick: afterLoss?.tick, appErrors: afterLoss?.appErrors, fatal: fatalAfterLoss },
    retryOnLostContext: retry1, afterRestoreContextAndRetry: retry2,
    end: { backend: end?.backend, tick: end?.tick, beat: end?.beat, appErrors: end?.appErrors },
    contextCallsAfterLoss: calls.slice(2), pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  };
  return { data, before, afterLoss, end, fatalAfterLoss };
}

test('R05 context loss: error recorded, simulation keeps running, screen never blank', async ({ page }, info) => {
  const r = await runContextLoss(page);
  writeEvidence('r05-context-loss-play-continues', r.data, info);
  expect(r.data.lose.hasExt).toBe(true);
  expect(r.afterLoss?.appErrors.some((e) => e.includes('device lost'))).toBe(true);
  expect((r.afterLoss?.tick ?? 0)).toBeGreaterThan(r.before?.tick ?? 0);
  expect((r.end?.tick ?? 0)).toBeGreaterThan(r.afterLoss?.tick ?? 0);
  // Either the renderer is back or an actionable message is visible: never an unexplained blank canvas.
  expect(r.afterLoss?.backend !== 'none' || r.fatalAfterLoss.visible).toBe(true);
});

test('R05 context loss: renderer recovers and rendering continues (backend back to webgl2)', async ({ page }, info) => {
  const r = await runContextLoss(page);
  writeEvidence('r05-context-loss-recovery', r.data, info);
  expect(r.afterLoss?.backend, 'automatic recovery after webglcontextlost').toBe('webgl2');
  expect(r.end?.backend, 'recovered after restoreContext + Retry').toBe('webgl2');
});

test('R05 fatal compatibility screen when no graphics context can be created', async ({ page }, info) => {
  const errs = collectErrors(page);
  await installGlProbe(page, 'no-context');
  await page.goto('/');
  await waitReady(page);
  await page.waitForTimeout(500);
  const fatal = await fatalState(page);
  const f = await page.evaluate(() => (window as unknown as { __floodline: { backend(): string } }).__floodline.backend());
  await page.screenshot({ path: shotPath('r05-fatal-no-context'), scale: 'css' });
  const calls = await ctxCalls(page);
  writeEvidence('r05-fatal-no-context', { backend: f, fatal, contextCalls: calls, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors }, info);
  expect(f).toBe('none');
  expect(fatal.visible).toBe(true);
  expect(fatal.text).toContain('could not start');
  expect(fatal.buttons.length).toBeGreaterThanOrEqual(2);
  expect(fatal.buttons.join(' ')).toMatch(/Retry/);
  expect(fatal.buttons.join(' ')).toMatch(/WebGL2/);
  expect(errs.pageErrors).toEqual([]);
});

test('R05 no WebGPU adapter (host default): app selects WebGL2 and reaches controllable readiness', async ({ page }, info) => {
  await installGlProbe(page, 'observe');
  await page.goto('/');
  await waitReady(page);
  await expect(page.locator('.fl-ready.is-ready')).toBeVisible({ timeout: 30_000 });
  const readyText = await page.locator('.fl-ready').innerText();
  const gpu = await gpuFacts(page);
  const path = rendererPath(await ctxCalls(page));
  const backend = await page.evaluate(() => (window as unknown as { __floodline: { backend(): string } }).__floodline.backend());
  writeEvidence('r05-no-webgpu', { gpu, backend, path, readyText }, info);
  expect(gpu.webgpuAdapter).not.toBe('adapter returned');
  expect(backend).toBe('webgl2');
});
