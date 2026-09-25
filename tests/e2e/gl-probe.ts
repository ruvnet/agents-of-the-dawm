/**
 * getContext instrumentation (test side). The app handle reports only 'webgl2' for both the
 * three WebGPURenderer WebGL2 backend and the classic WebGLRenderer, so the calling module in the
 * stack (lazy `three.webgpu-*.js` chunk vs the main `index-*.js` chunk) is the discriminator.
 *
 * mode 'observe'          : log only.
 * mode 'force-classic'    : the first `webgl2` request from the three.webgpu chunk on the in-DOM game
 *                           canvas returns null, so WebGPURenderer's WebGL2 backend fails and the app's
 *                           own chain falls through to its classic WebGLRenderer attempt.
 * mode 'no-context'       : every webgl/webgl2/webgpu request returns null (fatal compatibility path).
 */
import type { Page } from '@playwright/test';

export type GlMode = 'observe' | 'force-classic' | 'no-context';

export interface CtxCall { type: string; onGameCanvas: boolean; module: 'three.webgpu-chunk' | 'main-chunk' | 'other'; blocked: boolean; frame: string }

export async function installGlProbe(page: Page, mode: GlMode): Promise<void> {
  await page.addInitScript((mode: string) => {
    const orig = HTMLCanvasElement.prototype.getContext;
    const log: { type: string; onGameCanvas: boolean; module: string; blocked: boolean; frame: string }[] = [];
    (window as unknown as { __w6ctx: typeof log }).__w6ctx = log;
    let forced = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
      const lines = (new Error().stack ?? '').split('\n').slice(2).map((s) => s.trim());
      const frame = lines.find((l) => /assets\//.test(l)) ?? lines[0] ?? '';
      const module = /three\.webgpu/.test(frame) ? 'three.webgpu-chunk' : /assets\/(index|vendor-three)-/.test(frame) ? 'main-chunk' : 'other';
      const onGameCanvas = this.isConnected;
      let blocked = false;
      if (mode === 'force-classic' && type === 'webgl2' && onGameCanvas && module === 'three.webgpu-chunk' && forced === 0) { forced += 1; blocked = true; }
      if (mode === 'no-context' && (type === 'webgl2' || type === 'webgl' || type === 'webgpu' || type === 'experimental-webgl')) blocked = true;
      log.push({ type, onGameCanvas, module, blocked, frame: frame.replace(/^at /, '').slice(0, 160) });
      if (blocked) return null;
      return orig.call(this, type as '2d', attrs as CanvasRenderingContext2DSettings);
    };
  }, mode);
}

export async function ctxCalls(page: Page): Promise<CtxCall[]> {
  return page.evaluate(() => (window as unknown as { __w6ctx: CtxCall[] }).__w6ctx ?? []);
}

/** Which renderer implementation drew the game canvas, from the last successful game-canvas context. */
export function rendererPath(calls: readonly CtxCall[]): 'WebGPURenderer(WebGL2 backend)' | 'WebGLRenderer(classic)' | 'none' | 'unknown' {
  const ok = calls.filter((c) => c.onGameCanvas && !c.blocked && (c.type === 'webgl2' || c.type === 'webgpu'));
  const last = ok[ok.length - 1];
  if (!last) return 'none';
  if (last.module === 'three.webgpu-chunk') return 'WebGPURenderer(WebGL2 backend)';
  if (last.module === 'main-chunk') return 'WebGLRenderer(classic)';
  return 'unknown';
}

export async function gpuFacts(page: Page): Promise<{ navigatorGpu: boolean; webgpuAdapter: string; glRenderer: string | null; glVendor: string | null; glVersion: string | null }> {
  return page.evaluate(async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    let adapter = 'navigator.gpu absent';
    if (nav.gpu) {
      try { adapter = (await nav.gpu.requestAdapter()) ? 'adapter returned' : 'requestAdapter() returned null'; } catch (e) { adapter = `requestAdapter() threw ${String(e)}`; }
    }
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const out = {
      navigatorGpu: !!nav.gpu, webgpuAdapter: adapter,
      glRenderer: gl ? String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null,
      glVendor: gl ? String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)) : null,
      glVersion: gl ? String(gl.getParameter(gl.VERSION)) : null,
    };
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  });
}
