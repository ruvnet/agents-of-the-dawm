/**
 * Adapter behaviour with mocked GPU seams (no real GPU in node): backend chain, init failure
 * message, progressive readiness, pure consumption of RenderFrame, device loss, stats.
 * Scene materialisation runs for real (three core objects construct without a context).
 */
import { describe, expect, it, vi } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import type { RendererOptions } from '../../src/contracts/render';
import { createRenderer, FloodlineRenderer, type RendererDeps } from '../../src/render/renderer';
import type { BackendHandle } from '../../src/render/backend-init';
import type { BackendAttempt, BackendCapabilities } from '../../src/render/backend-select';
import { deepFreeze, ev, frame, makeState, richManifest } from './fixtures';

const opts: RendererOptions = { preferred: 'auto', quality: 'medium', reducedMotion: false };
const canvas = {} as HTMLCanvasElement;

function fakeHandle(attempt: BackendAttempt, backend: 'webgpu' | 'webgl2') {
  let lost: ((r: string) => void) | null = null;
  const h = {
    attempt, backend, notes: [`fake ${attempt}`],
    render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(), dispose: vi.fn(),
    info: () => ({ drawCalls: 42, triangles: 1234 }),
    gpuFrameMs: () => null,
    onLost: (cb: (r: string) => void) => { lost = cb; },
    loseDevice: (reason: string) => lost?.(reason),
  };
  return h satisfies BackendHandle & { loseDevice(r: string): void };
}

function deps(caps: Partial<BackendCapabilities>, fail: BackendAttempt[] = []) {
  const handles: ReturnType<typeof fakeHandle>[] = [];
  const d: RendererDeps = {
    probe: async (preferred) => ({ preferred, hasNavigatorGpu: true, adapterAvailable: true, hasWebGL2: true, ...caps }),
    initBackend: async (_c, attempt) => {
      if (fail.includes(attempt)) throw new Error(`${attempt} boom`);
      const h = fakeHandle(attempt, attempt === 'webgpu' ? 'webgpu' : 'webgl2');
      handles.push(h);
      return h;
    },
  };
  return { d, handles };
}

describe('FloodlineRenderer adapter', () => {
  it('createRenderer returns a fresh adapter reporting backend none before init', () => {
    const r = createRenderer();
    expect(r.backend).toBe('none');
    expect(r.readiness()).toBe('initializing');
    expect(r.stats().backend).toBe('none');
  });

  it('returns ok:false with an actionable reason when nothing can render (node has no GPU or WebGL2)', async () => {
    const r = createRenderer(); // real probe: no document → no WebGL2
    const res = await r.init(canvas, loadSector01(), opts);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/could not start a 3D renderer/);
      expect(res.tried).toEqual([]);
    }
    r.render(frame(makeState(loadSector01()), makeState(loadSector01()))); // no throw, no-op
    expect(r.readiness()).toBe('initializing');
    r.dispose();
    r.dispose();
  });

  it('walks the chain: WebGPU failure → WebGPURenderer WebGL2 backend', async () => {
    const { d, handles } = deps({}, ['webgpu']);
    const r = new FloodlineRenderer(d);
    const res = await r.init(canvas, loadSector01(), opts);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.backend).toBe('webgl2');
      expect(res.notes.join(' ')).toMatch(/webgpu failed: webgpu boom/);
    }
    expect(handles[0]!.attempt).toBe('webgpu-webgl2');
    expect(r.backend).toBe('webgl2');
  });

  it('strict exit to classic WebGLRenderer when both WebGPURenderer paths fail', async () => {
    const { d, handles } = deps({}, ['webgpu', 'webgpu-webgl2']);
    const r = new FloodlineRenderer(d);
    expect((await r.init(canvas, loadSector01(), opts)).ok).toBe(true);
    expect(handles[0]!.attempt).toBe('webgl2-classic');
  });

  it('reports every tried backend when all attempts fail', async () => {
    const { d } = deps({}, ['webgpu', 'webgpu-webgl2', 'webgl2-classic']);
    const res = await new FloodlineRenderer(d).init(canvas, loadSector01(), opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.tried).toEqual(['webgpu', 'webgl2']);
  });

  it('progressive readiness and pure consumption of frozen frames (rich manifest, every builder)', async () => {
    const m = richManifest();
    const { d, handles } = deps({});
    const r = new FloodlineRenderer(d);
    await r.init(canvas, m, opts);
    r.resize(1280, 720, 2);
    expect(r.readiness()).toBe('initializing');
    const prev = makeState(m);
    const curr = makeState(m, {
      tick: 1,
      player: { ...prev.player, pos: [28, 1.5, 4], up: '-z', anchorKey: 'anchor-a1-inspection' },
      keeper: { ...prev.keeper, phase: 2, sealsRemaining: 1 },
      machines: prev.machines.map((x) => ({ ...x, mode: 'telegraph' as const })),
      flags: { ...prev.flags, gateOpen: true },
      tramCrossed: true,
    });
    deepFreeze(prev);
    deepFreeze(curr);
    const snapshot = JSON.stringify([prev, curr]);
    const events = deepFreeze([ev('ShiftCommitted', 1, 'anchor-a1-inspection'), ev('SurgeTelegraph', 1, 'keeper'), ev('SealBroken', 1, 'keeper'),
      ev('GateOpened', 1, 'gate'), ev('TramCrossed', 1, 'tram'), ev('ToolPulse', 1), ev('ToolSpike', 1)]);
    const phases: string[] = [];
    for (let i = 0; i < 8; i++) {
      r.render(frame(prev, curr, { events, nowMs: i * 16, previewAnchorKey: i % 2 ? 'anchor-gantry' : 'anchor-a1-inspection' }));
      phases.push(r.readiness());
    }
    expect(phases[0]).toBe('controllable');
    expect(phases).toContain('optional-loading');
    expect(phases.at(-1)).toBe('complete');
    expect(JSON.stringify([prev, curr])).toBe(snapshot);
    expect(handles[0]!.render).toHaveBeenCalledTimes(8);
    const s = r.stats();
    expect(s).toMatchObject({ backend: 'webgpu', drawCalls: 42, triangles: 1234, quality: 'medium', gpuFrameMs: null });
    expect(s.internalScale).toBeGreaterThan(0);
    expect(s.cpuFrameMs).toBeGreaterThanOrEqual(0);
    r.setQuality('low');
    expect(r.stats().quality).toBe('low');
    expect(r.stats().internalScale).toBeLessThanOrEqual(0.75);
    r.dispose();
    expect(handles[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('device loss notifies callbacks once, releases the backend, and stops rendering', async () => {
    const { d, handles } = deps({});
    const r = new FloodlineRenderer(d);
    await r.init(canvas, loadSector01(), opts);
    const lost = vi.fn();
    r.onDeviceLost(lost);
    handles[0]!.loseDevice('driver reset');
    handles[0]!.loseDevice('again');
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledWith({ reason: 'driver reset' });
    expect(handles[0]!.dispose).toHaveBeenCalledTimes(1);
    const s = makeState(loadSector01());
    r.render(frame(s, s));
    expect(handles[0]!.render).not.toHaveBeenCalled();
    r.dispose();
  });

  it('a render exception is treated as device loss (strict exit, no blank loop)', async () => {
    const { d, handles } = deps({});
    const r = new FloodlineRenderer(d);
    await r.init(canvas, loadSector01(), opts);
    handles[0]!.render.mockImplementation(() => { throw new Error('pipeline compile failed'); });
    const lost = vi.fn();
    r.onDeviceLost(lost);
    const s = makeState(loadSector01());
    r.render(frame(s, s));
    expect(lost.mock.calls[0]![0].reason).toMatch(/pipeline compile failed/);
  });
});
