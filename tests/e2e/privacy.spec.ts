/**
 * P05 local privacy: during a full demo playthrough the network log contains only same-origin GET
 * requests for the app's own assets. No other origins, no POST/PUT, no beacons, no websockets.
 */
import { expect, test } from '@playwright/test';
import { collectErrors, facts, waitForTram, waitReady, writeEvidence } from './helpers';

test('P05 privacy: full demo network log is same-origin GET for own assets only', async ({ page, baseURL }, info) => {
  const errs = collectErrors(page);
  const origin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
  const requests: { method: string; url: string; type: string; status: number | null; bytes: number | null }[] = [];
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('requestfinished', async (req) => {
    const res = await req.response().catch(() => null);
    const sizes = await req.sizes().catch(() => null);
    requests.push({ method: req.method(), url: req.url(), type: req.resourceType(), status: res?.status() ?? null, bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : null });
  });
  page.on('requestfailed', (req) => requests.push({ method: req.method(), url: req.url(), type: req.resourceType(), status: null, bytes: null }));
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __w6net: string[] }).__w6net = calls;
    const nav = navigator as Navigator & { sendBeacon?: (u: string, d?: unknown) => boolean };
    if (nav.sendBeacon) {
      const orig = nav.sendBeacon.bind(nav);
      nav.sendBeacon = (u: string, d?: unknown) => { calls.push(`sendBeacon ${u}`); return orig(u, d as BodyInit); };
    }
    const OrigWS = window.WebSocket;
    window.WebSocket = function (this: unknown, u: string | URL, p?: string | string[]) { calls.push(`WebSocket ${String(u)}`); return new OrigWS(u, p); } as unknown as typeof WebSocket;
  });
  await page.goto('/?demo=upper&speed=8');
  await waitReady(page);
  await waitForTram(page);
  await page.waitForTimeout(3000);
  const f = await facts(page);
  const jsCalls = await page.evaluate(() => (window as unknown as { __w6net: string[] }).__w6net);
  const foreign = requests.filter((r) => !r.url.startsWith('data:') && !r.url.startsWith('blob:') && new URL(r.url).origin !== origin);
  const nonGet = requests.filter((r) => r.method !== 'GET');
  const beacons = requests.filter((r) => ['ping', 'beacon', 'eventsource', 'websocket'].includes(r.type));
  const paths = [...new Set(requests.map((r) => (r.url.startsWith('data:') || r.url.startsWith('blob:') ? r.url.slice(0, 16) : new URL(r.url).pathname)))].sort();
  const totalBytes = requests.reduce((a, r) => a + (r.bytes ?? 0), 0);
  writeEvidence('p05-privacy', {
    origin, requestCount: requests.length, uniquePaths: paths, requests, foreign, nonGet, beacons, websockets: sockets, jsNetworkApiCalls: jsCalls,
    transferBytesIncludingHeaders: totalBytes, tramCrossed: f?.tramCrossed, pageErrors: errs.pageErrors,
  }, info);
  expect(f?.tramCrossed).toBe(true);
  expect(foreign, 'no other origins').toEqual([]);
  expect(nonGet, 'GET only').toEqual([]);
  expect(beacons, 'no beacons/pings/event streams').toEqual([]);
  expect(sockets, 'no websockets').toEqual([]);
  expect(jsCalls, 'no sendBeacon/WebSocket calls').toEqual([]);
  for (const p of paths) expect(p === '/' || p.startsWith('/assets/') || p === '/favicon.ico' || p.startsWith('data:') || p.startsWith('blob:'), `own asset path: ${p}`).toBe(true);
});
