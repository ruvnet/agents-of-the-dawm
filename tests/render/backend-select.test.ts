import { describe, expect, it } from 'vitest';
import { noBackendMessage, selectBackend, type BackendCapabilities } from '../../src/render/backend-select';

const caps = (p: Partial<BackendCapabilities>): BackendCapabilities => ({
  preferred: 'auto', hasNavigatorGpu: true, adapterAvailable: true, hasWebGL2: true, ...p,
});

describe('selectBackend', () => {
  it('WebGPU + adapter + WebGL2 → webgpu first, then both WebGL2 paths', () => {
    const s = selectBackend(caps({}));
    expect(s.backend).toBe('webgpu');
    expect(s.attempts).toEqual(['webgpu', 'webgpu-webgl2', 'webgl2-classic']);
    expect(s.reasons).toEqual([]);
  });

  it('no navigator.gpu → webgl2 (WebGPURenderer WebGL2 backend, then classic)', () => {
    const s = selectBackend(caps({ hasNavigatorGpu: false, adapterAvailable: undefined }));
    expect(s.backend).toBe('webgl2');
    expect(s.attempts).toEqual(['webgpu-webgl2', 'webgl2-classic']);
    expect(s.reasons.join(' ')).toMatch(/navigator\.gpu/);
  });

  it('adapter null → webgl2', () => {
    const s = selectBackend(caps({ adapterAvailable: null }));
    expect(s.backend).toBe('webgl2');
    expect(s.attempts).not.toContain('webgpu');
    expect(s.reasons.join(' ')).toMatch(/adapter/);
  });

  it('preferred webgl2 skips WebGPU even when available', () => {
    const s = selectBackend(caps({ preferred: 'webgl2' }));
    expect(s.backend).toBe('webgl2');
    expect(s.attempts).toEqual(['webgpu-webgl2', 'webgl2-classic']);
  });

  it('preferred webgpu still keeps the documented WebGL2 fallbacks', () => {
    expect(selectBackend(caps({ preferred: 'webgpu' })).attempts).toEqual(['webgpu', 'webgpu-webgl2', 'webgl2-classic']);
  });

  it('WebGPU only (no WebGL2) → webgpu with no fallback', () => {
    const s = selectBackend(caps({ hasWebGL2: false }));
    expect(s.backend).toBe('webgpu');
    expect(s.attempts).toEqual(['webgpu']);
  });

  it('nothing → none with actionable reasons', () => {
    const s = selectBackend(caps({ hasNavigatorGpu: false, adapterAvailable: undefined, hasWebGL2: false }));
    expect(s.backend).toBe('none');
    expect(s.attempts).toEqual([]);
    expect(s.reasons.length).toBeGreaterThanOrEqual(2);
    const msg = noBackendMessage(s.reasons);
    expect(msg).toMatch(/WebGL2/);
    expect(msg).toMatch(/hardware acceleration|driver/);
  });

  it('adapter null and no WebGL2 → none', () => {
    expect(selectBackend(caps({ adapterAvailable: null, hasWebGL2: false })).backend).toBe('none');
  });
});
