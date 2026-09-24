/**
 * GL-dependent backend construction. Thin by design: each attempt either returns a working
 * BackendHandle or throws, and the adapter walks the `selectBackend` chain.
 * `three/webgpu` is imported lazily so node tests and the WebGL-only path never load it.
 */
import { WebGLRenderer, type Camera, type Scene } from 'three';
import { ATTEMPT_BACKEND, type BackendAttempt } from './backend-select';

export interface BackendHandle {
  readonly attempt: BackendAttempt;
  /** Actual backend in use (three's WebGPURenderer may silently fall back to WebGL2). */
  readonly backend: 'webgpu' | 'webgl2';
  readonly notes: readonly string[];
  render(scene: Scene, camera: Camera): void;
  setSize(width: number, height: number): void;
  setPixelRatio(ratio: number): void;
  info(): { drawCalls: number; triangles: number };
  /** Latest resolved GPU frame time, or null when timestamp queries are unavailable. */
  gpuFrameMs(): number | null;
  onLost(cb: (reason: string) => void): void;
  dispose(): void;
}

interface NodeRendererLike {
  init(): Promise<unknown>;
  render(scene: Scene, camera: Camera): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(r: number): void;
  dispose(): void;
  hasFeature(name: string): boolean;
  resolveTimestampsAsync(type?: 'render' | 'compute'): Promise<number | undefined>;
  onDeviceLost: (info: { reason: string | null; message: string }) => void;
  info: { render: { drawCalls: number; triangles: number } };
  backend: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
}

export interface InitOptions {
  readonly antialias: boolean;
}

export async function initBackend(canvas: HTMLCanvasElement, attempt: BackendAttempt, opts: InitOptions): Promise<BackendHandle> {
  return attempt === 'webgl2-classic' ? initClassic(canvas, opts) : initNode(canvas, attempt, opts);
}

/**
 * Once a canvas holds a `webgpu` context it can never hand out `webgl2`, so a WebGPU backend
 * that initialises but cannot draw would strand every fallback. Render a lit box on a scratch
 * canvas first; only a clean warm-up lets WebGPU touch the game canvas. (Observed: three
 * 0.186's WebGPU backend throws on `createView({ swizzle })` in Chromium builds lacking
 * texture-view swizzle, after `init()` has already succeeded.)
 */
async function warmUpWebGPU(mod: typeof import('three/webgpu')): Promise<void> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) throw new Error('no document for WebGPU warm-up');
  const scratch = doc.createElement('canvas');
  scratch.width = scratch.height = 8;
  const r = new mod.WebGPURenderer({ canvas: scratch }) as unknown as NodeRendererLike;
  try {
    await r.init();
    if (r.backend.isWebGPUBackend !== true) throw new Error('WebGPU backend unavailable (three fell back during warm-up)');
    const scene = new mod.Scene();
    const cam = new mod.PerspectiveCamera(50, 1, 0.1, 10);
    cam.position.set(0, 0, 3);
    // Mirror the scene's feature set: lit standard, instanced + transparent, vertex colours, fog.
    const box = new mod.BoxGeometry(1, 1, 1);
    const colors = new Float32Array(box.getAttribute('position').count * 3).fill(0.5);
    box.setAttribute('color', new mod.BufferAttribute(colors, 3));
    const lit = new mod.MeshStandardMaterial({ color: 0xe8e2d4 });
    const glassy = new mod.MeshStandardMaterial({ color: 0x3e9c8c, transparent: true, opacity: 0.8 });
    const tinted = new mod.MeshBasicMaterial({ vertexColors: true });
    const inst = new mod.InstancedMesh(box, glassy, 2);
    inst.setMatrixAt(0, new mod.Matrix4().makeTranslation(-0.6, 0, 0));
    inst.setMatrixAt(1, new mod.Matrix4().makeTranslation(0.6, 0, 0));
    scene.fog = new mod.Fog(0xcdb7ad, 1, 20);
    scene.add(new mod.Mesh(box, lit), new mod.Mesh(box, tinted), inst,
      new mod.DirectionalLight(0xffffff, 1), new mod.HemisphereLight(0xffffff, 0x000000, 1));
    r.render(scene as unknown as Scene, cam as unknown as Camera);
    box.dispose();
    lit.dispose();
    glassy.dispose();
    tinted.dispose();
  } finally {
    try { r.dispose(); } catch { /* ignore */ }
  }
}

async function initNode(canvas: HTMLCanvasElement, attempt: BackendAttempt, opts: InitOptions): Promise<BackendHandle> {
  const mod = await import('three/webgpu');
  if (attempt === 'webgpu') await warmUpWebGPU(mod);
  const r = new mod.WebGPURenderer({
    canvas, antialias: opts.antialias, forceWebGL: attempt === 'webgpu-webgl2', trackTimestamp: true, powerPreference: 'high-performance',
  }) as unknown as NodeRendererLike;
  try {
    await r.init();
  } catch (err) {
    // three's dispose() calls WEBGL_lose_context.loseContext(); on a WebGL-backed attempt that
    // would poison the canvas for the classic fallback, so only dispose WebGPU attempts.
    if (attempt === 'webgpu') { try { r.dispose(); } catch { /* ignore */ } }
    throw err;
  }
  const notes: string[] = [];
  const actual: 'webgpu' | 'webgl2' = r.backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  if (actual !== ATTEMPT_BACKEND[attempt]) notes.push(`WebGPURenderer fell back to its WebGL2 backend during init`);
  notes.push(actual === 'webgpu' ? 'three WebGPURenderer (WebGPU backend)' : 'three WebGPURenderer (WebGL2 backend)');

  let timestamps = false;
  try { timestamps = actual === 'webgpu' ? r.hasFeature('timestamp-query') : true; } catch { timestamps = false; }
  let gpuMs: number | null = null;
  let pending = false;
  let misses = 0;
  const lostCbs: ((reason: string) => void)[] = [];
  r.onDeviceLost = (info) => { for (const cb of lostCbs) cb(info.reason ?? info.message ?? 'device lost'); };

  return {
    attempt, backend: actual, notes,
    render(scene, camera) {
      r.render(scene, camera);
      if (!timestamps || pending) return;
      pending = true;
      r.resolveTimestampsAsync('render').then((ms) => {
        if (typeof ms === 'number' && Number.isFinite(ms)) { gpuMs = ms; misses = 0; }
        else if (++misses > 30) timestamps = false; // unsupported (no timer query extension)
      }).catch(() => { timestamps = false; }).finally(() => { pending = false; });
    },
    setSize: (w, h) => r.setSize(w, h, false),
    setPixelRatio: (x) => r.setPixelRatio(x),
    info: () => ({ drawCalls: r.info.render.drawCalls ?? 0, triangles: r.info.render.triangles ?? 0 }),
    gpuFrameMs: () => gpuMs,
    onLost: (cb) => { lostCbs.push(cb); },
    dispose: () => { r.onDeviceLost = () => {}; r.dispose(); },
  };
}

function initClassic(canvas: HTMLCanvasElement, opts: InitOptions): BackendHandle {
  const r = new WebGLRenderer({ canvas, antialias: opts.antialias, powerPreference: 'high-performance' });
  const gl = r.getContext();
  if (typeof WebGL2RenderingContext !== 'undefined' && !(gl instanceof WebGL2RenderingContext)) {
    r.dispose();
    throw new Error('classic WebGLRenderer did not obtain a WebGL2 context');
  }
  const lostCbs: ((reason: string) => void)[] = [];
  const onLost = (e: Event): void => {
    e.preventDefault();
    for (const cb of lostCbs) cb('webglcontextlost');
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  return {
    attempt: 'webgl2-classic', backend: 'webgl2', notes: ['three WebGLRenderer (classic, strict-exit fallback)'],
    render: (scene, camera) => r.render(scene, camera),
    setSize: (w, h) => r.setSize(w, h, false),
    setPixelRatio: (x) => r.setPixelRatio(x),
    info: () => ({ drawCalls: r.info.render.calls, triangles: r.info.render.triangles }),
    gpuFrameMs: () => null,
    onLost: (cb) => { lostCbs.push(cb); },
    dispose: () => { canvas.removeEventListener('webglcontextlost', onLost, false); r.dispose(); },
  };
}
