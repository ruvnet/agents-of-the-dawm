// Browser check for the UI: `node tests/ui/harness/shots.mjs [--headed]`.
// Starts a vite dev server, mounts the UI harness with real-simulation fixture frames in headless
// Chromium, saves screenshots to $UI_SHOTS_OUT (default tests/ui/harness/screenshots/, untracked)
// and checks for page errors and horizontal overflow.
import { createServer } from 'vite';
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname;
const outDir = process.env.UI_SHOTS_OUT ?? `${root}tests/ui/harness/screenshots`;
mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, server: { port: 5198, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const desktop = { viewport: { width: 1280, height: 800 } };
const phone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } };
delete phone.defaultBrowserType;

const shots = [
  { name: 'start', q: 'view=start', ctx: desktop },
  { name: 'hud', q: 'view=hud', ctx: desktop },
  { name: 'hud-200', q: 'view=hud&scale=2', ctx: desktop },
  { name: 'control-fresh-100', q: 'view=control&stage=fresh', ctx: desktop },
  { name: 'control-100', q: 'view=control&stage=previewed', ctx: desktop },
  { name: 'control-100-scrolled', q: 'view=control&stage=previewed', ctx: desktop, scroll: 0.55 },
  { name: 'control-200', q: 'view=control&stage=previewed&scale=2', ctx: desktop },
  { name: 'control-200-scrolled', q: 'view=control&stage=previewed&scale=2', ctx: desktop, scroll: 0.5 },
  { name: 'control-restored-ready', q: 'view=control&stage=restored&semantic=ready', ctx: desktop, scroll: 1 },
  { name: 'control-confirm', q: 'view=control&stage=confirm', ctx: desktop, scroll: 1 },
  { name: 'ending', q: 'view=ending', ctx: desktop },
  { name: 'fatal', q: 'view=fatal', ctx: desktop },
  { name: 'touch-start-390', q: 'view=start&touch=1', ctx: phone },
  { name: 'touch-hud-390', q: 'view=hud&touch=1', ctx: phone },
  { name: 'touch-control-390', q: 'view=control&stage=previewed&touch=1', ctx: phone },
  { name: 'touch-control-390-200', q: 'view=control&stage=previewed&touch=1&scale=2', ctx: phone, scroll: 0.3 },
];

let failed = false;
try {
  for (const s of shots) {
    const context = await browser.newContext(s.ctx);
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`${base}tests/ui/harness/index.html?${s.q}`);
    await page.waitForFunction(() => window.__uiHarness?.ready === true, null, { timeout: 30_000 });
    if (s.scroll !== undefined) {
      await page.evaluate((f) => {
        const el = document.querySelector('.fl-modal:not([hidden])');
        if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      }, s.scroll);
    }
    await page.waitForTimeout(150);
    const check = await page.evaluate(() => {
      const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const modal = document.querySelector('.fl-modal:not([hidden])');
      const modalOverflowX = modal ? modal.scrollWidth > modal.clientWidth + 1 : false;
      const offscreen = modal ? (() => { const r = modal.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; })() : false;
      const focused = document.activeElement?.getAttribute('data-fk') ?? document.activeElement?.tagName ?? null;
      return { docOverflow, modalOverflowX, offscreen, focused, capturing: !!document.querySelector('.fl-app.is-capturing') };
    });
    const path = `${outDir}/${s.name}.png`;
    await page.screenshot({ path });
    const errs = [...logs, ...(await page.evaluate(() => window.__uiHarness?.errors ?? []))];
    const bad = errs.length > 0 || check.docOverflow || check.modalOverflowX || check.offscreen;
    if (bad) failed = true;
    console.log(JSON.stringify({ shot: s.name, path, ...check, errors: errs }));
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
