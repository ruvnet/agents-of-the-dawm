/**
 * Pure backend selection (ADR 0002). Browser probing lives in `probeCapabilities`, which only
 * gathers facts; the decision is made by `selectBackend`, which is unit tested in node.
 */
import type { RenderBackend, RendererOptions } from '../contracts/render';

export interface BackendCapabilities {
  readonly preferred: RendererOptions['preferred'];
  /** `'gpu' in navigator`. */
  readonly hasNavigatorGpu: boolean;
  /** Result of `navigator.gpu.requestAdapter()` (null = no adapter, undefined = not probed). */
  readonly adapterAvailable: boolean | null | undefined;
  /** A scratch canvas returned a `webgl2` context. */
  readonly hasWebGL2: boolean;
}

/**
 * Ordered attempts:
 * - `webgpu`         three `WebGPURenderer`, native WebGPU backend.
 * - `webgpu-webgl2`  three `WebGPURenderer({ forceWebGL: true })`, its documented WebGL2 backend.
 * - `webgl2-classic` three `WebGLRenderer`, the strict-exit fallback.
 */
export type BackendAttempt = 'webgpu' | 'webgpu-webgl2' | 'webgl2-classic';

export const ATTEMPT_BACKEND: Readonly<Record<BackendAttempt, Exclude<RenderBackend, 'none'>>> = {
  'webgpu': 'webgpu',
  'webgpu-webgl2': 'webgl2',
  'webgl2-classic': 'webgl2',
};

export interface BackendSelection {
  /** Best expected backend, or 'none' when nothing can work. */
  readonly backend: RenderBackend;
  readonly attempts: readonly BackendAttempt[];
  readonly reasons: readonly string[];
}

export function selectBackend(caps: BackendCapabilities): BackendSelection {
  const reasons: string[] = [];
  const attempts: BackendAttempt[] = [];
  const webgpuUsable = caps.hasNavigatorGpu && caps.adapterAvailable !== null && caps.adapterAvailable !== false;

  if (caps.preferred === 'webgl2') reasons.push('WebGL2 preferred by options; WebGPU skipped');
  else if (!caps.hasNavigatorGpu) reasons.push('navigator.gpu is absent (WebGPU not exposed by this browser)');
  else if (!webgpuUsable) reasons.push('WebGPU exposed but no GPU adapter was returned');

  if (caps.preferred !== 'webgl2' && webgpuUsable) attempts.push('webgpu');
  if (caps.hasWebGL2) attempts.push('webgpu-webgl2', 'webgl2-classic');
  else reasons.push('WebGL2 context unavailable (disabled, blocklisted GPU, or unsupported browser)');

  const first = attempts[0];
  return { backend: first ? ATTEMPT_BACKEND[first] : 'none', attempts, reasons };
}

/** Human-actionable message for the app when every backend failed. */
export function noBackendMessage(reasons: readonly string[]): string {
  return [
    'This browser could not start a 3D renderer.',
    ...reasons,
    'Try a current Chrome, Edge, Firefox or Safari; enable hardware acceleration; or update your graphics driver.',
  ].join(' ');
}

/** Browser-only probe. Uses a scratch canvas so the game canvas is not locked to a context type. */
export async function probeCapabilities(preferred: RendererOptions['preferred']): Promise<BackendCapabilities> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const gpu = nav && 'gpu' in nav ? (nav as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu : undefined;
  let adapterAvailable: boolean | null | undefined;
  if (gpu && preferred !== 'webgl2') {
    try {
      adapterAvailable = (await gpu.requestAdapter()) != null ? true : null;
    } catch {
      adapterAvailable = null;
    }
  }
  let hasWebGL2 = false;
  try {
    const doc = (globalThis as { document?: Document }).document;
    const scratch = doc?.createElement('canvas');
    const ctx = scratch?.getContext('webgl2');
    hasWebGL2 = !!ctx;
    (ctx as WebGL2RenderingContext | null | undefined)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    hasWebGL2 = false;
  }
  return { preferred, hasNavigatorGpu: !!gpu, adapterAvailable, hasWebGL2 };
}
