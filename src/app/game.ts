/**
 * C1 integration: wires simulation (authority), renderer, semantic projection, UI, input, audio,
 * narrative and saves. The simulation is the only authority; everything else consumes committed
 * state and events. All modules are injected so the loop is testable headlessly.
 */
import type { ControlAction, InputCommand } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import type { FinalGraphView } from '../contracts/pressure';
import type { RendererAdapter, RenderBackend, RenderReadiness } from '../contracts/render';
import type { SemanticAdapter, SemanticStatus } from '../contracts/semantic';
import type { CreateSimulation, SimSnapshot, SimState, Simulation, WorldEvent } from '../contracts/sim';
import type { AudioEngine } from '../contracts/audio';
import type { CaptionCue, NarrativeDirector, Objective } from '../contracts/narrative';
import type { GameUi, InputSource, SaveStore, UiSettings } from '../contracts/ui';
import { SAVE_SCHEMA_VERSION } from '../contracts/ui';
import { FixedStepper } from './stepper';
import { createPerfProbe, perfProbeRequested, type PerfSnapshot } from './perf-probe';

export interface AppDeps {
  manifest: LevelManifest;
  createSimulation: CreateSimulation;
  createRenderer: () => RendererAdapter;
  createSemanticAdapter: () => SemanticAdapter;
  composeFinalGraphView: (p: ReturnType<Simulation['pressureView']>, a: SemanticAdapter | null, m: LevelManifest) => FinalGraphView;
  createInput: () => InputSource;
  createUi: () => GameUi;
  createAudioEngine: () => AudioEngine;
  createNarrativeDirector: () => NarrativeDirector;
  /** Once-only lines already played, derived from a restored state (W5: SaveRecord has no played list). */
  playedFromState?: (s: SimState) => readonly string[];
  objectiveFor: (s: SimState) => Objective;
  createSaveStore: () => SaveStore;
  defaultSettings: () => UiSettings;
  validateSettings?: (u: unknown) => UiSettings | null;
  /** Optional input override (demo autopilot). */
  inputOverride?: (m: LevelManifest) => InputSource;
  seed?: number;
  speed?: number;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  /** Record per-frame CPU timings (default: `?perf` present in the URL). Read-only evidence. */
  perfProbe?: boolean;
}

export interface GameHandle {
  readonly sim: () => Simulation | null;
  readonly backend: () => RenderBackend;
  readonly semanticStatus: () => SemanticStatus;
  readonly commands: () => readonly InputCommand[];
  readonly captions: () => readonly string[];
  readonly errors: () => readonly string[];
  start(mode: 'new' | 'continue'): Promise<void>;
  stepOnce(): void;
  setPaused(p: boolean): void;
  control(a: ControlAction): void;
  /** Current renderer readiness phase (read-only). */
  readiness(): RenderReadiness;
  /** Startup marks and, when enabled, per-frame CPU timing ring buffers (read-only copies). */
  perf(): PerfSnapshot;
}

const STORY_SEMANTIC_EVENTS = new Set(['ChannelLocated', 'SensorVerified', 'EdgeRestored', 'TransferAuthorized', 'GateOpened']);

export async function startGame(root: HTMLElement, canvasHost: HTMLElement, deps: AppDeps): Promise<GameHandle> {
  const { manifest } = deps;
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const probe = createPerfProbe(deps.perfProbe ?? perfProbeRequested());
  probe.mark('fl:boot');
  const errors: string[] = [];
  const store = deps.createSaveStore() as SaveStore & { probe?: () => Promise<unknown> };
  await store.probe?.().catch(() => undefined);
  const stored = await store.loadSettings().catch(() => null);
  let settings: UiSettings = (stored && deps.validateSettings ? deps.validateSettings(stored) : stored) ?? deps.defaultSettings();
  const existing = await store.load().catch(() => null);
  const ui = deps.createUi();
  const input = deps.inputOverride ? deps.inputOverride(manifest) : deps.createInput();
  const audio = deps.createAudioEngine();
  const narrative = deps.createNarrativeDirector();
  let semantic: SemanticAdapter | null = null;
  let renderer: RendererAdapter | null = null;
  let backend: RenderBackend = 'none';
  let canvas = canvasHost.querySelector('canvas') as HTMLCanvasElement | null;
  let sim: Simulation | null = null;
  let prev: SimState | null = null;
  let paused = false;
  let pauseHeld = false;
  let running = false;
  let pendingEvents: WorldEvent[] = [];
  let captions: CaptionCue[] = [];
  const captionLog: string[] = [];
  const commands: InputCommand[] = [];
  const stepper = new FixedStepper();

  async function initRenderer(preferred: UiSettings['renderer']): Promise<boolean> {
    renderer?.dispose();
    if (!canvas || canvas.dataset.used === 'webgpu') {
      // A canvas that ever held a WebGPU context cannot hand out WebGL2 (W2 P4): replace it.
      const fresh = document.createElement('canvas');
      fresh.id = 'game';
      fresh.setAttribute('aria-label', 'Floodline game view');
      canvas?.replaceWith(fresh);
      if (!canvas) canvasHost.prepend(fresh);
      canvas = fresh;
    }
    renderer = deps.createRenderer();
    ui.setReadiness('initializing', 'none');
    probe.mark('fl:renderer-init-start');
    const res = await renderer.init(canvas, manifest, {
      preferred, quality: settings.quality === 'auto' ? 'medium' : settings.quality, reducedMotion: settings.camera.reducedMotion,
    });
    if (!res.ok) {
      backend = 'none';
      ui.showFatal('This browser could not start the renderer',
        `${res.reason} (tried: ${res.tried.join(', ') || 'none'}). Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.`,
        [{ label: 'Retry', run: () => void initRenderer('auto') }, { label: 'Use WebGL2', run: () => void initRenderer('webgl2') }]);
      return false;
    }
    backend = res.backend;
    probe.mark('fl:renderer-init-done');
    if (res.backend === 'webgpu') canvas.dataset.used = 'webgpu';
    renderer.onDeviceLost(({ reason }) => {
      errors.push(`device lost: ${reason}`);
      // Recover on a fresh canvas with the WebGL2 path; simulation state is untouched (R05).
      void initRenderer('webgl2');
    });
    resize();
    return true;
  }

  function resize(): void {
    if (!renderer || !canvas) return;
    renderer.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, window.devicePixelRatio || 1);
  }
  window.addEventListener('resize', resize);

  function persistCheckpoint(): void {
    if (!sim) return;
    const s = sim.state();
    void store.save({
      schema: SAVE_SCHEMA_VERSION, manifestId: manifest.id, seed: s.seed, savedAtTick: s.tick,
      checkpointKey: s.checkpointKey, snapshot: sim.snapshot(), stateHash: sim.hash(), settings,
    }).catch((e) => errors.push(`save failed: ${String(e)}`));
  }

  function graph(): FinalGraphView {
    return deps.composeFinalGraphView(sim!.pressureView(), semantic, manifest);
  }

  function stepTick(): void {
    if (!sim) return;
    const s = sim.state();
    const cmd = input.sample({ tick: s.tick, state: s, manifest, uiCapturing: ui.capturing(), settings });
    if (cmd.pause && !pauseHeld) setPaused(!paused);
    pauseHeld = cmd.pause;
    if (paused) return;
    const safeCmd = { ...cmd, pause: false };
    prev = s as SimState;
    commands.push(safeCmd);
    const events = sim.step(safeCmd);
    probe.mark('fl:first-tick');
    if (events.length) pendingEvents.push(...events);
  }

  function setPaused(p: boolean): void {
    paused = p;
    stepper.reset();
  }

  function frame(): void {
    if (!running) return;
    const timing = probe.enabled;
    let tA = 0, tB = 0, tC = 0, tD = 0, tE = 0;
    let nTicks = 0;
    try {
      const t = now();
      if (timing) tA = performance.now();
      const { ticks, alpha } = stepper.advance(t, deps.speed ?? 1);
      nTicks = ticks;
      for (let i = 0; i < ticks; i++) stepTick();
      if (timing) tB = performance.now();
      const events = pendingEvents;
      pendingEvents = [];
      if (sim) {
        const s = sim.state();
        if (events.length) {
          const cues = narrative.consume(events, s.branch);
          for (const c of cues) captionLog.push(`${c.speaker ?? '·'}: ${c.text}`);
          captions = [...captions, ...cues].slice(-6);
          audio.handleEvents(events);
          const story = events.filter((e) => STORY_SEMANTIC_EVENTS.has(e.type));
          if (story.length && semantic) semantic.enqueue(story);
          if (events.some((e) => e.type === 'CheckpointReached')) persistCheckpoint();
        }
        semantic?.flush(t);
        if (semantic?.status() === 'ready') probe.mark('fl:semantic-ready');
        if (timing) tC = performance.now();
        renderer?.render({
          alpha: paused ? 1 : alpha, prev: prev ?? s, curr: s, events, camera: settings.camera,
          previewAnchorKey: input.previewAnchorKey(), nowMs: t,
        });
        if (timing) tD = performance.now();
        if (renderer && renderer.readiness() !== 'initializing') probe.mark('fl:controllable');
        const g = graph();
        if (timing) tE = performance.now();
        ui.update({
          state: s, events, graph: g, captions, objective: deps.objectiveFor(s as SimState), backend,
          readiness: renderer?.readiness() ?? 'initializing', renderStats: renderer?.stats() ?? null,
          semanticStatus: semantic?.status() ?? 'unavailable', device: input.activeDevice(), paused,
        });
        if (timing) {
          const tF = performance.now();
          probe.record({
            frame: tF - tA, ticks: tB - tA, render: tD - tC, graph: tE - tD, ui: tF - tE,
            scale: renderer?.stats().internalScale ?? 0, nticks: nTicks,
          });
        }
      }
    } catch (e) {
      errors.push(String(e instanceof Error ? e.stack ?? e.message : e));
      if (errors.length > 50) errors.splice(0, errors.length - 50);
    }
    raf(frame);
  }

  async function start(mode: 'new' | 'continue'): Promise<void> {
    probe.mark('fl:start');
    ui.markStarted?.(mode);
    void audio.unlock();
    sim = deps.createSimulation(manifest, { seed: deps.seed ?? 1047, assist: settings.assist });
    if (mode === 'continue' && existing && existing.manifestId === manifest.id) {
      try { sim.restore(existing.snapshot as SimSnapshot); } catch (e) { errors.push(`continue failed: ${String(e)}`); }
    }
    prev = sim.state() as SimState;
    commands.length = 0;
    narrative.reset(deps.playedFromState ? deps.playedFromState(sim.state() as SimState) : []);
    captions = [];
    stepper.reset();
    paused = false;
    // Semantic projection loads after the first interaction, never gating control (ADR 0003).
    if (!semantic) {
      semantic = deps.createSemanticAdapter();
      semantic.init(manifest).catch((e) => errors.push(`semantic init: ${String(e)}`));
    }
    if (!running) { running = true; raf(frame); }
  }

  ui.mount(root, {
    onStart: (mode) => void start(mode),
    onControl: (a) => input.queueControl(a),
    onSettings: (next) => {
      const rendererChanged = next.renderer !== settings.renderer;
      settings = next;
      audio.setSettings(next.audio);
      if (renderer && next.quality !== 'auto') renderer.setQuality(next.quality);
      void store.saveSettings(next);
      if (rendererChanged) void initRenderer(next.renderer);
    },
    onPause: (p) => setPaused(p),
    onRestartCheckpoint: () => { sim?.restartFromCheckpoint(); prev = sim?.state() as SimState; setPaused(false); },
    onResetSave: () => void store.reset(),
  }, settings, { hasSave: !!existing });
  audio.setSettings(settings.audio);
  input.attach(canvasHost);
  // Autoplay policy: retry audio unlock on the next gesture while suspended (W5 note).
  const regesture = () => { if (audio.state() === 'suspended' || audio.state() === 'locked') void audio.unlock(); };
  window.addEventListener('pointerdown', regesture);
  window.addEventListener('keydown', regesture);
  await initRenderer(settings.renderer);
  // Draw the start state behind the menu so the first view is the game (ADR 0001).
  const r0 = renderer as RendererAdapter | null;
  if (r0) {
    const preview = deps.createSimulation(manifest, { seed: deps.seed ?? 1047 });
    const s = preview.state();
    r0.render({ alpha: 1, prev: s, curr: s, events: [], camera: settings.camera, previewAnchorKey: null, nowMs: now() });
    ui.setReadiness(r0.readiness(), backend);
    if (r0.readiness() !== 'initializing') probe.mark('fl:controllable');
  }

  return {
    sim: () => sim,
    backend: () => backend,
    semanticStatus: () => semantic?.status() ?? 'unavailable',
    commands: () => commands,
    captions: () => captionLog,
    errors: () => errors,
    start,
    stepOnce: stepTick,
    setPaused,
    control: (a) => input.queueControl(a),
    readiness: () => renderer?.readiness() ?? 'initializing',
    perf: () => probe.snapshot(),
  };
}
