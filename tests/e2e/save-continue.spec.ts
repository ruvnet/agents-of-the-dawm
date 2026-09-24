/**
 * Save/continue: a checkpoint written by real play is restored by the Continue button with the
 * same checkpoint and state hash, and play continues. A corrupt IndexedDB record does not break boot.
 */
import { expect, test } from '@playwright/test';
import { collectErrors, facts, idbGet, idbPut, playerPos, waitReady, writeEvidence } from './helpers';

interface SaveLike { schema: number; checkpointKey: string; stateHash: string; savedAtTick: number; manifestId: string }

test('Save/continue: checkpoint reached, reload, Continue restores the same checkpoint and hash; play continues', async ({ page }, info) => {
  const errs = collectErrors(page);
  // Real checkpoint persistence from a real playthrough (demo autopilot, speed 1 is not needed).
  await page.goto('/?demo=upper&speed=4');
  await waitReady(page);
  await page.waitForFunction(() => {
    const s = (window as unknown as { __floodline: { sim(): { state(): { checkpointKey: string } } | null } }).__floodline.sim()?.state();
    return !!s && ['cp-deck', 'cp-bank-near', 'cp-bank-far', 'cp-junction'].includes(s.checkpointKey);
  }, null, { timeout: 120_000, polling: 100 });
  await expect.poll(async () => ((await idbGet(page, 'save.current')) as SaveLike | undefined)?.checkpointKey ?? 'none', { timeout: 10_000 }).not.toBe('none');

  // Reload into normal play (no demo). The record read here is exactly what Continue will load.
  await page.goto('/');
  await waitReady(page);
  const saved = (await idbGet(page, 'save.current')) as SaveLike;
  const cont = page.locator('[data-fl-modal="start"] [data-fk="continue"]');
  await expect(cont).toBeVisible();
  const restored = await page.evaluate(() => {
    const h = (window as unknown as { __floodline: { setPaused(p: boolean): void; sim(): { state(): { tick: number; checkpointKey: string; player: { pos: number[] } }; hash(): string } | null } }).__floodline;
    (document.querySelector('[data-fl-modal="start"] [data-fk="continue"]') as HTMLButtonElement).click();
    h.setPaused(true); // start() is synchronous up to the first rAF, so no tick has run yet
    const sim = h.sim()!;
    const s = sim.state();
    return { tick: s.tick, checkpointKey: s.checkpointKey, hash: sim.hash(), pos: [...s.player.pos] };
  });
  await page.evaluate(() => (window as unknown as { __floodline: { setPaused(p: boolean): void } }).__floodline.setPaused(false));
  await page.waitForTimeout(300);
  const p0 = await playerPos(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  const p1 = await playerPos(page);
  const f = await facts(page);
  writeEvidence('save-continue', {
    saved: { checkpointKey: saved.checkpointKey, stateHash: saved.stateHash, savedAtTick: saved.savedAtTick, schema: saved.schema, manifestId: saved.manifestId },
    restoredImmediately: restored, afterPlay: { tick0: p0.tick, tick1: p1.tick, pos0: p0.pos, pos1: p1.pos },
    appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(restored.checkpointKey).toBe(saved.checkpointKey);
  expect(restored.tick).toBe(saved.savedAtTick);
  expect(restored.hash, 'restored state hash equals the saved stateHash').toBe(saved.stateHash);
  expect(p1.tick).toBeGreaterThan(p0.tick);
  expect(Math.hypot((p1.pos[0] ?? 0) - (p0.pos[0] ?? 0), (p1.pos[2] ?? 0) - (p0.pos[2] ?? 0)), 'player moves after Continue').toBeGreaterThan(0.3);
  expect(f?.appErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test('Save/continue: corrupt IndexedDB save and settings records do not break boot', async ({ page }, info) => {
  const errs = collectErrors(page);
  await page.goto('/');
  await waitReady(page);
  await idbPut(page, 'save.current', { schema: 1, manifestId: 42, snapshot: '{"truncated', stateHash: null });
  await idbPut(page, 'settings', { version: 99, camera: 'broken', textScale: 7 });
  await page.reload();
  await waitReady(page);
  const play = page.locator('[data-fl-modal="start"] [data-fk="play"]');
  await expect(play).toBeVisible();
  const continueVisible = await page.locator('[data-fl-modal="start"] [data-fk="continue"]').isVisible();
  const fatalVisible = await page.locator('[data-fl-modal="fatal"]').isVisible().catch(() => false);
  const quarantine = await idbGet(page, 'save.quarantine');
  const settingsQuarantine = await idbGet(page, 'settings.quarantine');
  const current = await idbGet(page, 'save.current');
  await play.click();
  await page.waitForTimeout(800);
  const f = await facts(page);
  writeEvidence('save-corrupt-boot', {
    continueVisible, fatalVisible, saveQuarantined: quarantine !== undefined, quarantineReason: (quarantine as { reason?: string } | undefined)?.reason ?? null,
    settingsQuarantined: settingsQuarantine !== undefined, settingsQuarantineReason: (settingsQuarantine as { reason?: string } | undefined)?.reason ?? null,
    currentAfterBoot: current === undefined ? 'removed' : 'present',
    playStarted: !!f, tick: f?.tick, appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(fatalVisible).toBe(false);
  expect(continueVisible, 'no Continue offered for an invalid save').toBe(false);
  expect(quarantine, 'corrupt save quarantined').not.toBeUndefined();
  expect(f, 'new game starts').not.toBeNull();
  expect(f!.tick).toBeGreaterThan(0);
  expect(errs.pageErrors).toEqual([]);
});
