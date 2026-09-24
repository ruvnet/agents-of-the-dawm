// Browser smoke for the renderer: `node tests/render/harness/smoke.mjs [--headed]`.
// Starts a vite dev server, loads the harness in Chromium for each backend preference, prints
// the init result, readiness phases and stats, and saves screenshots to $RENDER_SMOKE_OUT
// (default node_modules/.render-smoke/, never committed).
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname;
const outDir = process.env.RENDER_SMOKE_OUT ?? `${root}node_modules/.render-smoke`;
mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, server: { port: 5199, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  for (const preferred of ['auto', 'webgl2']) {
    for (const shift of ['', '1']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const logs = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
      await page.goto(`${url}tests/render/harness/index.html?preferred=${preferred}&shift=${shift}`);
      await page.waitForFunction(() => window.__renderSmoke !== undefined, null, { timeout: 60_000 });
      const result = await page.evaluate(() => window.__renderSmoke);
      const shot = `${outDir}/smoke-${preferred}${shift ? '-shift' : ''}.png`;
      await page.screenshot({ path: shot });
      console.log(JSON.stringify({ preferred, shift: !!shift, result, logs: logs.slice(0, 8), shot }, null, 1));
      if (!result.ok) failed = true;
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
