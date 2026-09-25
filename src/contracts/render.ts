import type { LevelManifest } from './manifest';
import type { SimState, WorldEvent } from './sim';

export type RenderBackend = 'webgpu' | 'webgl2' | 'none';
export type QualityTier = 'low' | 'medium' | 'high';

export interface CameraSettings {
  noRoll: boolean;
  reducedMotion: boolean;
  fovDeg: number;
  motionBlur: boolean;
  /** v1.1 (W2 P2): reduce flashes independently of motion; defaults to reducedMotion. */
  reducedFlashes?: boolean;
}

/** Interpolates two committed states. Holds no authority to mutate simulation (ADR 0004). */
export interface RenderFrame {
  readonly alpha: number;
  readonly prev: Readonly<SimState>;
  readonly curr: Readonly<SimState>;
  /** Events committed since the previous rendered frame. */
  readonly events: readonly WorldEvent[];
  readonly camera: Readonly<CameraSettings>;
  /** Anchor key currently being previewed (ghost of destination), render-only. */
  readonly previewAnchorKey: string | null;
  readonly nowMs: number;
}

export interface RendererOptions {
  preferred: 'auto' | 'webgpu' | 'webgl2';
  quality: QualityTier;
  reducedMotion: boolean;
}

export type RenderInitResult =
  | { ok: true; backend: Exclude<RenderBackend, 'none'>; notes: string[] }
  | { ok: false; reason: string; tried: RenderBackend[] };

export interface RenderStats {
  backend: RenderBackend;
  cpuFrameMs: number;
  gpuFrameMs: number | null;
  internalScale: number;
  quality: QualityTier;
  drawCalls: number;
  triangles: number;
}

/** Readiness phases reported to the loader UI: control readiness, not a fake asset percentage (ADR 0002). */
export type RenderReadiness = 'initializing' | 'controllable' | 'optional-loading' | 'complete';

export interface RendererAdapter {
  readonly backend: RenderBackend;
  init(canvas: HTMLCanvasElement, manifest: LevelManifest, options: RendererOptions): Promise<RenderInitResult>;
  render(frame: RenderFrame): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  setQuality(tier: QualityTier): void;
  readiness(): RenderReadiness;
  onDeviceLost(cb: (info: { reason: string }) => void): void;
  stats(): RenderStats;
  /** v1.1 (VR1): concrete init attempt in use, e.g. webgpu | webgpu-webgl2 | webgl2-classic. */
  attempt?(): string | null;
  dispose(): void;
}

export type CreateRenderer = () => RendererAdapter;
