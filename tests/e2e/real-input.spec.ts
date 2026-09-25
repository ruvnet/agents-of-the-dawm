/**
 * Real input: start from the actual Play button, move with real keyboard events (WASD), reach the
 * first gravity anchor and shift with F. Also the failed-shift path outside an anchor.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors, eventCount, eventTypesSince, facts, playerPos, shotPath, waitReady, writeEvidence,
} from './helpers';

const ANCHOR = 'anchor-a1-inspection';

type V2 = [number, number];
const sub2 = (a: readonly number[], b: readonly number[]): V2 => [(a[0] ?? 0) - (b[0] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
const dot2 = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
const norm2 = (a: V2): V2 => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

async function startWithPlayButton(page: Page): Promise<void> {
  await page.goto('/');
  await waitReady(page);
  const play = page.locator('[data-fl-modal="start"] [data-fk="play"]');
  await expect(play).toBeVisible();
  await play.click();
  await page.waitForFunction(() => (window as unknown as { __floodline: { sim(): unknown } }).__floodline.sim() !== null);
  await expect(page.locator('[data-fl-modal="start"]')).toBeHidden();
}

test('Real input: Play button, WASD to the first anchor, F shifts gravity (ShiftCommitted, player.up changes)', async ({ page }, info) => {
  const errs = collectErrors(page);
  await startWithPlayButton(page);
  const start = await playerPos(page);

  // Discover the keyboard frame empirically (no assumption about yaw convention).
  let p0 = await playerPos(page);
  await hold(page, ['KeyW'], 400);
  await page.waitForTimeout(150);
  let p1 = await playerPos(page);
  const fwd = norm2(sub2(p1.pos, p0.pos));
  const movedW = Math.hypot(...sub2(p1.pos, p0.pos));
  p0 = p1;
  await hold(page, ['KeyD'], 300);
  await page.waitForTimeout(150);
  p1 = await playerPos(page);
  const right = norm2(sub2(p1.pos, p0.pos));
  const movedD = Math.hypot(...sub2(p1.pos, p0.pos));
  expect(movedW, 'W moves the player').toBeGreaterThan(0.3);
  expect(movedD, 'D moves the player').toBeGreaterThan(0.2);

  const path: number[][] = [];
  const waypoints: [number, number, number][] = [[10, 0, 1], [18, 0, 2.5], [28, 0, 3]];
  for (const wp of waypoints) {
    for (let i = 0; i < 80; i++) {
      const p = await playerPos(page);
      path.push(p.pos.map((v) => Math.round(v * 100) / 100));
      if (wp === waypoints[2] && p.anchorKey === ANCHOR) break;
      const d = sub2(wp, p.pos);
      if (Math.hypot(...d) < 0.6) break;
      const a = dot2(d, fwd);
      const b = dot2(d, right);
      const keys: string[] = [];
      if (Math.abs(a) > 0.3) keys.push(a > 0 ? 'KeyW' : 'KeyS');
      if (Math.abs(b) > 0.3) keys.push(b > 0 ? 'KeyD' : 'KeyA');
      if (!keys.length) break;
      await hold(page, keys, Math.min(300, 60 + 60 * Math.hypot(a, b)));
    }
  }
  await page.waitForTimeout(300);
  const atAnchor = await playerPos(page);
  expect(atAnchor.anchorKey, 'reached the first anchor volume by keyboard').toBe(ANCHOR);

  const before = await eventCount(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1200);
  const after = await playerPos(page);
  const ev = await eventTypesSince(page, before);
  const committed = ev.filter((e) => e.type === 'ShiftCommitted' && e.key === ANCHOR);
  const f = await facts(page);
  await page.screenshot({ path: shotPath('real-input-after-shift'), scale: 'css' });
  writeEvidence('real-input-shift', {
    start: start.pos, keyboardFrame: { forward: fwd, right, movedW, movedD },
    path, atAnchor, upBefore: atAnchor.up, upAfter: after.up, eventsAfterF: ev.map((e) => `${e.type}:${e.key}@${e.tick}`),
    backend: f?.backend, appErrors: f?.appErrors, pageErrors: errs.pageErrors, consoleErrors: errs.consoleErrors,
  }, info);
  expect(committed.length, 'ShiftCommitted for the first anchor').toBe(1);
  expect(after.up).not.toBe(atAnchor.up);
  expect(after.up).toBe('-z');
  expect(f?.appErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test('Real input: F outside any anchor emits ShiftRejected and leaves state intact', async ({ page }, info) => {
  const errs = collectErrors(page);
  await startWithPlayButton(page);
  await page.waitForTimeout(300);
  const snap = async () => page.evaluate(() => {
    const s = (window as unknown as { __floodline: { sim(): { state(): { player: { pos: number[]; up: string; anchorKey: string | null; health: number; charge: number }; anchors: unknown[]; flags: unknown } } } }).__floodline.sim().state();
    return { pos: s.player.pos, up: s.player.up, anchorKey: s.player.anchorKey, health: s.player.health, charge: s.player.charge, anchors: JSON.stringify(s.anchors), flags: JSON.stringify(s.flags) };
  });
  const before = await snap();
  const n0 = await eventCount(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(800);
  const after = await snap();
  const ev = await eventTypesSince(page, n0);
  const rejected = ev.filter((e) => e.type === 'ShiftRejected');
  const committed = ev.filter((e) => e.type === 'ShiftCommitted');
  const prompt = await page.locator('.fl-hud').innerText().catch(() => '');
  writeEvidence('real-input-failed-shift', {
    before, after, eventsAfterF: ev.map((e) => `${e.type}:${e.key}@${e.tick}`), shiftRejected: rejected.length, shiftCommitted: committed.length,
    hudTextAfterF: prompt.slice(0, 400),
    note: 'src/ui/input/core.ts sets shiftAnchorId only when state.player.anchorKey is non-null, so F outside an anchor never reaches the simulation; no ShiftRejected is emitted and no feedback is shown. The simulation-level rejection is covered by the next test.',
    pageErrors: errs.pageErrors,
  }, info);
  // State intact (ADR 0004 invariant 1).
  expect(after.up).toBe(before.up);
  expect(after.anchors).toBe(before.anchors);
  expect(after.flags).toBe(before.flags);
  expect(after.health).toBe(before.health);
  expect(after.charge).toBe(before.charge);
  expect(committed.length).toBe(0);
  // Task-card requirement: the failed attempt is rejected explicitly.
  expect(rejected.length, 'ShiftRejected emitted for a real F press outside an anchor').toBeGreaterThan(0);
});

test('Sim boundary: a shift request for an anchor the player is not inside is rejected (ShiftRejected, state intact)', async ({ page }, info) => {
  await startWithPlayButton(page);
  await page.waitForTimeout(300);
  const r = await page.evaluate((anchor) => {
    type S = { tick: number; player: { pos: number[]; up: string; health: number; charge: number }; anchors: unknown[] };
    const h = (window as unknown as { __floodline: { setPaused(p: boolean): void; sim(): { state(): S; step(c: unknown): { type: string; key: string; payload: unknown }[]; hash(): string } } }).__floodline;
    h.setPaused(true); // the app loop stops stepping; the test issues exactly one command
    const sim = h.sim();
    const s0 = sim.state();
    const before = { pos: [...s0.player.pos], up: s0.player.up, health: s0.player.health, charge: s0.player.charge, anchors: JSON.stringify(s0.anchors) };
    const ev = sim.step({ tick: s0.tick, move2: [0, 0], look2: [0, 0], jump: false, pulse: false, spike: false, shiftAnchorId: anchor, interact: false, pause: false, control: null });
    const s1 = sim.state();
    const after = { pos: [...s1.player.pos], up: s1.player.up, health: s1.player.health, charge: s1.player.charge, anchors: JSON.stringify(s1.anchors) };
    h.setPaused(false);
    return { before, after, events: ev.map((e) => ({ type: e.type, key: e.key, payload: e.payload })) };
  }, ANCHOR);
  writeEvidence('sim-failed-shift', r, info);
  expect(r.events.some((e) => e.type === 'ShiftRejected' && e.key === ANCHOR)).toBe(true);
  expect(r.after.up).toBe(r.before.up);
  expect(r.after.anchors).toBe(r.before.anchors);
  expect(r.after.health).toBe(r.before.health);
  expect(r.after.charge).toBe(r.before.charge);
});
