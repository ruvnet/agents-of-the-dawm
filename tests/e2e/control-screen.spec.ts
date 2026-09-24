/**
 * G04 at the UI boundary and W04/G05 (WorldGraph WASM unavailable).
 *
 * `window.__floodline.control()` is a no-op under `?demo` (the autopilot input ignores queued
 * control actions), so these tests reach the control room in NORMAL play: a demo run persists the
 * real cp-control checkpoint, then a fresh non-demo session uses Continue, walks to the control
 * screen with WASD and opens it with E.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors, eventCount, eventTypesSince, facts, idbGet, installObserver, observation, playerPos, shotPath,
  waitForTram, waitReady, writeEvidence,
} from './helpers';

async function blockWasm(page: Page, log: string[]): Promise<void> {
  await page.route('**/*.wasm', (r) => { log.push(r.request().url()); return r.abort('failed'); });
}

async function control(page: Page, action: Record<string, string>): Promise<{ type: string; key: string; payload: unknown }[]> {
  const n = await eventCount(page);
  await page.evaluate((a) => (window as unknown as { __floodline: { control(a: unknown): void } }).__floodline.control(a), action);
  await page.waitForTimeout(250);
  return eventTypesSince(page, n);
}

async function flags(page: Page): Promise<Record<string, boolean>> {
  return (await facts(page))!.flags;
}

/** Demo run -> cp-control save -> normal session -> Continue -> walk -> E opens the panel. */
async function reachOpenPanel(page: Page): Promise<{ openedBy: string; savedCheckpoint: string }> {
  await page.goto('/?demo=upper&speed=8');
  await waitReady(page);
  await waitForTram(page);
  await expect.poll(async () => ((await idbGet(page, 'save.current')) as { checkpointKey?: string } | undefined)?.checkpointKey).toBe('cp-control');
  await page.goto('/');
  await waitReady(page);
  await page.locator('[data-fl-modal="start"] [data-fk="continue"]').click();
  await page.waitForTimeout(400);
  // Walk to the control screen (autopilot target 120,14,13) with the keyboard: +z is D at yaw 0.
  for (let i = 0; i < 20; i++) {
    const p = await playerPos(page);
    const dz = 13 - (p.pos[2] ?? 0);
    const dx = 120 - (p.pos[0] ?? 0);
    if (Math.abs(dz) < 0.3 && Math.abs(dx) < 0.5) break;
    const keys = [...(Math.abs(dz) >= 0.3 ? [dz > 0 ? 'KeyD' : 'KeyA'] : []), ...(Math.abs(dx) >= 0.5 ? [dx > 0 ? 'KeyW' : 'KeyS'] : [])];
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(120);
    for (const k of keys) await page.keyboard.up(k);
  }
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  let openedBy = 'keyboard E';
  const open = await page.evaluate(() => (window as unknown as { __floodline: { sim(): { state(): { pressure: { panelOpen: boolean } } } } }).__floodline.sim().state().pressure.panelOpen);
  if (!open) {
    await control(page, { kind: 'open-panel' });
    openedBy = 'window.__floodline.control(open-panel) after E did not open it';
  }
  return { openedBy, savedCheckpoint: 'cp-control' };
}

test('G04 at the UI boundary: authorizing the occupied street or the protected pump never opens the gate', async ({ page }, info) => {
  const errs = collectErrors(page);
  await installObserver(page);
  const setup = await reachOpenPanel(page);
  const panelVisible = await page.locator('[data-fl-modal="control"]').isVisible();
  await page.screenshot({ path: shotPath('control-screen-open'), scale: 'css' });
  const attempts: { action: string; events: string[]; flagsAfter: Record<string, boolean> }[] = [];
  const tryAct = async (label: string, a: Record<string, string>) => {
    const ev = await control(page, a);
    attempts.push({ action: label, events: ev.map((e) => `${e.type}:${e.key}:${JSON.stringify(e.payload)}`), flagsAfter: await flags(page) });
    return ev;
  };
  const street = await tryAct('authorize occupied-street (before evidence)', { kind: 'authorize', destination: 'occupied-street' });
  const pump = await tryAct('authorize protected-pump (before evidence)', { kind: 'authorize', destination: 'protected-pump' });
  const reliefEarly = await tryAct('authorize relief-channel before sensor scan', { kind: 'authorize', destination: 'relief-channel' });
  await tryAct('scan-sensor', { kind: 'scan-sensor' });
  for (const d of ['occupied-street', 'protected-pump', 'relief-channel']) await tryAct(`preview ${d}`, { kind: 'preview', destination: d });
  await tryAct('restore-edge', { kind: 'restore-edge' });
  const street2 = await tryAct('authorize occupied-street (all evidence present)', { kind: 'authorize', destination: 'occupied-street' });
  const pump2 = await tryAct('authorize protected-pump (all evidence present)', { kind: 'authorize', destination: 'protected-pump' });
  const uiAuthorize = await page.locator('[data-fl-modal="control"] [data-fk="authorize"]').first();
  const uiAuthorizeEnabled = await uiAuthorize.isEnabled().catch(() => null);
  const beforeSafe = await flags(page);
  const safe = await tryAct('authorize relief-channel (safe, all evidence present)', { kind: 'authorize', destination: 'relief-channel' });
  const again = await tryAct('authorize relief-channel again (duplicate)', { kind: 'authorize', destination: 'relief-channel' });
  await waitForTram(page, 60_000);
  const obs = await observation(page);
  const f = await facts(page);
  writeEvidence('g04-control-screen', {
    ...setup, panelVisible, attempts, uiAuthorizeEnabledBeforeSafeAuthorize: uiAuthorizeEnabled, flagsBeforeSafeAuthorize: beforeSafe,
    gateOpenedEvents: obs.events.filter((e) => e.type === 'GateOpened').length, final: f && { flags: f.flags, tramCrossed: f.tramCrossed, semanticStatus: f.semanticStatus },
    appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(panelVisible, 'control screen visible after opening').toBe(true);
  for (const ev of [street, pump, reliefEarly, street2, pump2]) {
    expect(ev.some((e) => e.type === 'TransferRejected')).toBe(true);
    expect(ev.some((e) => e.type === 'GateOpened' || e.type === 'TransferAuthorized')).toBe(false);
  }
  expect(beforeSafe.gateOpen).toBe(false);
  expect(beforeSafe.playerAuthorized).toBe(false);
  expect(safe.filter((e) => e.type === 'GateOpened').length).toBe(1);
  expect(again.some((e) => e.type === 'GateOpened')).toBe(false);
  expect(obs.events.filter((e) => e.type === 'GateOpened').length).toBe(1);
  expect(f?.tramCrossed).toBe(true);
  expect(f?.appErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test('W04/G05: WASM blocked -> semantic status unavailable, degraded/authored label on the control screen, rescue completes', async ({ page }, info) => {
  const errs = collectErrors(page);
  const blocked: string[] = [];
  await blockWasm(page, blocked);
  await installObserver(page);
  const setup = await reachOpenPanel(page); // the demo leg also runs with WASM blocked
  const demoLegStatus = 'see semanticStatus below (same blocked context)';
  const status = await page.evaluate(() => (window as unknown as { __floodline: { semanticStatus(): string } }).__floodline.semanticStatus());
  const semSection = page.locator('[data-fl-modal="control"] .fl-semantic');
  const semText = (await semSection.innerText().catch(() => '')).slice(0, 600);
  const semClass = await semSection.getAttribute('class').catch(() => null);
  const routesText = (await page.locator('[data-fl-modal="control"]').innerText().catch(() => '')).slice(0, 1500);
  await page.screenshot({ path: shotPath('control-screen-wasm-unavailable'), scale: 'css' });
  const sequence: Record<string, string>[] = [
    { kind: 'authorize', destination: 'occupied-street' },
    { kind: 'scan-sensor' },
    { kind: 'preview', destination: 'occupied-street' }, { kind: 'preview', destination: 'protected-pump' }, { kind: 'preview', destination: 'relief-channel' },
    { kind: 'restore-edge' },
    { kind: 'authorize', destination: 'relief-channel' },
  ];
  for (const a of sequence) await control(page, a);
  await waitForTram(page, 60_000);
  const f = await facts(page);
  const obs = await observation(page);
  writeEvidence('w04-wasm-unavailable', {
    ...setup, demoLegStatus, blockedRequests: blocked, semanticStatus: status, semanticSectionClass: semClass, semanticSectionText: semText,
    controlScreenText: routesText,
    final: f && { flags: f.flags, tramCrossed: f.tramCrossed }, gateOpenedEvents: obs.events.filter((e) => e.type === 'GateOpened').length,
    appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(blocked.length, 'the .wasm request was attempted and blocked').toBeGreaterThan(0);
  expect(status).toBe('unavailable');
  expect(semClass ?? '').toContain('is-unavailable');
  expect(semText).toContain('Semantic detail unavailable');
  expect(semText.toLowerCase()).toContain('authored');
  for (const d of ['occupied', 'pump', 'relief']) expect(routesText.toLowerCase()).toContain(d);
  expect(routesText).toContain('kPa');
  expect(f?.flags.gateOpen).toBe(true);
  expect(f?.tramCrossed).toBe(true);
  expect(obs.events.filter((e) => e.type === 'GateOpened').length).toBe(1);
  expect(errs.pageErrors).toEqual([]);
});

test('W04/G05: demo route completes with WASM blocked (seeded upper route)', async ({ page }, info) => {
  const errs = collectErrors(page);
  const blocked: string[] = [];
  await blockWasm(page, blocked);
  await page.goto('/?demo=upper&speed=8');
  await waitReady(page);
  await waitForTram(page);
  const f = await facts(page);
  writeEvidence('w04-demo-wasm-blocked', {
    blockedRequests: blocked, semanticStatus: f?.semanticStatus, flags: f?.flags, tramCrossed: f?.tramCrossed,
    appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(f?.semanticStatus).toBe('unavailable');
  expect(f?.flags.gateOpen).toBe(true);
  expect(f?.tramCrossed).toBe(true);
  expect(errs.pageErrors).toEqual([]);
});
