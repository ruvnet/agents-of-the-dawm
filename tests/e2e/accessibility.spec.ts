/**
 * P04 accessibility: reduced motion (with a G06 story/authorization invariance check), captions
 * toggle, 200 percent text scale, keyboard-only start/settings walk with visible focus, and a
 * touch-emulated 390x844 smoke test. Screenshots go to reports/e2e/screens.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors, facts, installObserver, observation, playerPos, shotPath, waitForTick, waitForTram, waitReady, writeEvidence,
} from './helpers';
import { compareHashes, referenceRun } from './reference';

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { fk: null, tag: 'body', text: '', focusVisible: false, outline: 'none', modal: null };
    const cs = getComputedStyle(el);
    return {
      fk: el.getAttribute('data-fk'), tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 40),
      focusVisible: el.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      modal: el.closest('[data-fl-modal]')?.getAttribute('data-fl-modal') ?? null,
    };
  });
}

test('P04 reduced motion: prefers-reduced-motion is honoured and leaves story/authorization identical (G06)', async ({ page }, info) => {
  const errs = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installObserver(page);
  await page.goto('/');
  await waitReady(page);
  const appClass = await page.locator('.fl-app').getAttribute('class');
  await page.locator('[data-fl-modal="start"] [data-fk="settings"]').click();
  const reducedChecked = await page.locator('[data-fk="Reduced camera motion"]').isChecked();
  await page.screenshot({ path: shotPath('p04-reduced-motion-settings'), scale: 'css' });
  await page.keyboard.press('Escape');
  await page.goto('/?demo=upper&speed=8');
  await waitReady(page);
  await waitForTram(page);
  const ref = referenceRun('upper', 4200);
  await waitForTick(page, 4000 + 5);
  const obs = await observation(page);
  const f = await facts(page);
  const cmp = compareHashes(obs.hashes, ref.hashes);
  writeEvidence('p04-reduced-motion', {
    appClass, reducedCameraMotionChecked: reducedChecked, flags: f?.flags, tramCrossed: f?.tramCrossed,
    hashComparisonWithDefaultMotionReference: cmp, pageErrors: errs.pageErrors, appErrors: f?.appErrors,
  }, info);
  expect(appClass ?? '').toContain('fl-reduced-motion');
  expect(reducedChecked).toBe(true);
  expect(f?.flags.gateOpen).toBe(true);
  expect(cmp.mismatches, 'reduced motion does not change simulation hashes').toEqual([]);
  expect(cmp.commonTicks).toBeGreaterThan(10);
});

test('P04 captions toggle: start-screen toggle hides and restores in-game captions', async ({ page }, info) => {
  await page.goto('/?autostart=0');
  await waitReady(page);
  const btn = page.locator('[data-fl-modal="start"] [data-fk="captions"]');
  const initial = await btn.getAttribute('aria-pressed');
  await btn.click();
  const off = await btn.getAttribute('aria-pressed');
  const classOff = await page.locator('.fl-app').getAttribute('class');
  await page.locator('[data-fl-modal="start"] [data-fk="play"]').click();
  await page.keyboard.down('KeyW'); // first movement triggers S01
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const captionsWhileOff = await page.locator('.fl-captions .fl-caption').count();
  const narrativeLines = await page.evaluate(() => (window as unknown as { __floodline: { captions(): readonly string[] } }).__floodline.captions().length);
  await page.screenshot({ path: shotPath('p04-captions-off'), scale: 'css' });
  // Turn captions back on from the pause menu's settings.
  await page.keyboard.press('Escape');
  await page.locator('[data-fl-modal="pause"] [data-fk="settings"]').click();
  await page.locator('[data-fk="Captions"]').check().catch(async () => { await page.locator('[data-fk="Captions"]').click(); });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const classOn = await page.locator('.fl-app').getAttribute('class');
  const captionsWhileOn = await page.locator('.fl-captions .fl-caption').count();
  await page.screenshot({ path: shotPath('p04-captions-on'), scale: 'css' });
  writeEvidence('p04-captions', { initial, afterToggle: off, classOff, captionsRenderedWhileOff: captionsWhileOff, narrativeLinesWhileOff: narrativeLines, classOn, captionsRenderedWhileOn: captionsWhileOn }, info);
  expect(initial).toBe('true');
  expect(off).toBe('false');
  expect(classOff ?? '').toContain('fl-no-captions');
  expect(narrativeLines, 'dialogue still played while captions were off').toBeGreaterThan(0);
  expect(captionsWhileOff).toBe(0);
  expect(classOn ?? '').not.toContain('fl-no-captions');
  expect(captionsWhileOn).toBeGreaterThan(0);
});

test('P04 200 percent text scale setting doubles UI text size without horizontal overflow', async ({ page }, info) => {
  await page.goto('/');
  await waitReady(page);
  const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-fl-modal="start"] [data-fk="play"]')!).fontSize));
  const s1 = await size();
  await page.locator('[data-fl-modal="start"] [data-fk="settings"]').click();
  await page.locator('[data-fk="Text size"]').selectOption('2');
  const scaleVar = await page.locator('.fl-app').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fl-text-scale'));
  await page.screenshot({ path: shotPath('p04-text-200-settings'), scale: 'css' });
  await page.keyboard.press('Escape');
  const s2 = await size();
  const overflow = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-fl-modal="start"] *'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width && (r.right > window.innerWidth + 1 || r.left < -1)) out.push(`${el.tagName}.${(el as HTMLElement).className}`);
    }
    return { docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, clipped: out.slice(0, 10) };
  });
  await page.screenshot({ path: shotPath('p04-text-200-start'), scale: 'css' });
  writeEvidence('p04-text-scale-200', { playFontPxAt100: s1, playFontPxAt200: s2, ratio: s2 / s1, cssVar: scaleVar, overflow }, info);
  expect(scaleVar).toBe('2');
  expect(s2 / s1).toBeGreaterThan(1.9);
  expect(overflow.clipped, 'no start-screen element outside the viewport at 200%').toEqual([]);
});

test('P04 keyboard-only walk through the start screen and settings with visible focus', async ({ page }, info) => {
  await page.goto('/');
  await waitReady(page);
  const stops: Awaited<ReturnType<typeof focusInfo>>[] = [];
  stops.push(await focusInfo(page)); // initial focus set by the UI
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); stops.push(await focusInfo(page)); }
  // Reach the settings button by keyboard and open it with Enter.
  for (let i = 0; i < 8 && (await focusInfo(page)).fk !== 'settings'; i++) await page.keyboard.press('Tab');
  const onSettings = await focusInfo(page);
  await page.keyboard.press('Enter');
  const settingsOpen = await page.locator('[data-fl-modal="settings"]').isVisible();
  const inSettings: Awaited<ReturnType<typeof focusInfo>>[] = [await focusInfo(page)];
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); inSettings.push(await focusInfo(page)); }
  await page.screenshot({ path: shotPath('p04-keyboard-settings-focus'), scale: 'css' });
  await page.keyboard.press('Escape');
  const settingsClosed = !(await page.locator('[data-fl-modal="settings"]').isVisible());
  const afterClose = await focusInfo(page);
  // Start the game with the keyboard only.
  for (let i = 0; i < 8 && (await focusInfo(page)).fk !== 'play'; i++) await page.keyboard.press('Shift+Tab');
  const onPlay = await focusInfo(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const started = await page.evaluate(() => (window as unknown as { __floodline: { sim(): unknown } }).__floodline.sim() !== null);
  const all = [...stops, onSettings, ...inSettings, onPlay].filter((s) => s.tag !== 'body');
  const invisible = all.filter((s) => !s.focusVisible || s.outline.startsWith('none'));
  writeEvidence('p04-keyboard-walk', { stops, onSettings, settingsOpen, inSettings, settingsClosed, afterClose, onPlay, started, invisibleFocusStops: invisible }, info);
  expect(stops[0]?.fk, 'initial focus on Play').toBe('play');
  expect(onSettings.fk).toBe('settings');
  expect(settingsOpen).toBe(true);
  expect(inSettings.every((s) => s.modal === 'settings'), 'focus trapped inside settings').toBe(true);
  expect(settingsClosed).toBe(true);
  expect(onPlay.fk).toBe('play');
  expect(started).toBe(true);
  expect(invisible, 'every keyboard focus stop shows a visible focus ring').toEqual([]);
});

test.describe('touch 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

  test('P04 touch-emulated 390x844 smoke: tap Play, touch layer visible, virtual stick moves the player', async ({ page }, info) => {
    const errs = collectErrors(page);
    await page.goto('/');
    await waitReady(page);
    await page.screenshot({ path: shotPath('p04-touch-390x844-start'), scale: 'css' });
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.locator('[data-fl-modal="start"] [data-fk="play"]').tap();
    await page.waitForTimeout(600);
    const touchVisible = await page.locator('.fl-touch').isVisible();
    const buttons = await page.locator('.fl-touch .fl-touch-btn').count();
    const stick = await page.locator('.fl-touch-stick').boundingBox();
    const p0 = await playerPos(page);
    let moved: number | null = null;
    if (stick) {
      const cdp = await page.context().newCDPSession(page);
      const cx = stick.x + stick.width / 2;
      const cy = stick.y + stick.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
      for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 10, id: 1 }] });
      await page.waitForTimeout(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
      const p1 = await playerPos(page);
      moved = Math.hypot((p1.pos[0] ?? 0) - (p0.pos[0] ?? 0), (p1.pos[2] ?? 0) - (p0.pos[2] ?? 0));
    }
    await page.screenshot({ path: shotPath('p04-touch-390x844-play'), scale: 'css' });
    const f = await facts(page);
    writeEvidence('p04-touch-390x844', { touchVisible, touchButtons: buttons, stickBox: stick, horizontalOverflowPx: overflowX, stickMovedMetres: moved, device: f?.backend, appErrors: f?.appErrors, pageErrors: errs.pageErrors }, info);
    expect(overflowX).toBeLessThanOrEqual(0);
    expect(touchVisible).toBe(true);
    expect(buttons).toBeGreaterThanOrEqual(5);
    expect(moved ?? 0, 'virtual stick drag moves the player').toBeGreaterThan(0.3);
    expect(errs.pageErrors).toEqual([]);
  });
});
