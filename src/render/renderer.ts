/**
 * FloodlineRenderer: the RendererAdapter implementation. A pure consumer of RenderFrame — it
 * reads prev/curr SimState and events, never writes them (ADR 0004), and nothing it does
 * (quality, backend, easing) can reach the simulation tick (ADR 0002 R04).
 */
import {
  AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene,
} from 'three';
import { axisToVec, type Aabb } from '../contracts/math';
import type { LevelManifest } from '../contracts/manifest';
import type {
  CreateRenderer, QualityTier, RenderBackend, RenderFrame, RenderInitResult, RenderReadiness, RenderStats, RendererAdapter, RendererOptions,
} from '../contracts/render';
import type { SimState } from '../contracts/sim';
import { buildPlayer, buildPlayerGhost, orient, updateMachine, type PlayerRig } from './actors';
import { initBackend, type BackendHandle } from './backend-init';
import { ATTEMPT_BACKEND, noBackendMessage, probeCapabilities, selectBackend } from './backend-select';
import { CameraUpEaser, computeCameraPose } from './camera';
import { EffectTimeline, shakeOffset } from './effects';
import { EffectsView } from './effects-view';
import { interpolateDynamics, interpolateMachines, interpolatePlayer, surfaceBasis } from './interpolate';
import { createMaterials, type MaterialSet } from './materials';
import { PALETTE } from './palette';
import { box, createSharedGeometry, disposeSharedGeometry, type SharedGeometry } from './primitives';
import { QualityGovernor, TIER_PRESETS } from './quality';
import { ReadinessTracker } from './readiness';
import { buildCriticalScene, type SceneHandles } from './scene-build';
import {
  buildCoast, buildFog, buildRibsAndLamps, buildSky, buildSpray, type OptionalPiece,
} from './scene-optional';
import { buildScenePlan, MACHINE_SIZE, type ScenePlan } from './scene-plan';
import { translateBox, type V3 } from './vec';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Injectable seams (London-school tests substitute these; production uses the defaults). */
export interface RendererDeps {
  readonly probe: typeof probeCapabilities;
  readonly initBackend: typeof initBackend;
}

const DEFAULT_DEPS: RendererDeps = { probe: probeCapabilities, initBackend };

export class FloodlineRenderer implements RendererAdapter {
  private readonly deps: RendererDeps;

  constructor(deps: Partial<RendererDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  private backendKind: RenderBackend = 'none';
  private handle: BackendHandle | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 16 / 9, 0.1, 4000);
  private manifest: LevelManifest | null = null;
  private plan: ScenePlan | null = null;
  private mats: MaterialSet | null = null;
  private geo: SharedGeometry | null = null;
  private handles: SceneHandles | null = null;
  private player: PlayerRig | null = null;
  private ghost: Group | null = null;
  private ghostBox: Mesh | null = null;
  private effectsView: EffectsView | null = null;
  private readonly timeline = new EffectTimeline();
  private readonly easer = new CameraUpEaser();
  private readonly readinessTracker = new ReadinessTracker();
  private governor = QualityGovernor.forTier('medium');
  private tier: QualityTier = 'medium';
  private optional: OptionalPiece[] = [];
  private options: RendererOptions = { preferred: 'auto', quality: 'medium', reducedMotion: false };
  private size = { w: 1, h: 1, dpr: 1 };
  private lastUp: SimState['player']['up'] | null = null;
  private lastCpuMs = 0;
  private lastInfo = { drawCalls: 0, triangles: 0 };
  private lost = false;
  private disposed = false;
  private initStarted = false;
  private readonly lostCbs: ((info: { reason: string }) => void)[] = [];

  get backend(): RenderBackend {
    return this.backendKind;
  }

  async init(canvas: HTMLCanvasElement, manifest: LevelManifest, options: RendererOptions): Promise<RenderInitResult> {
    if (this.disposed) return { ok: false, reason: 'renderer was disposed', tried: [] };
    if (this.handle || this.initStarted) return { ok: false, reason: 'renderer already initialised; create a new one to re-init', tried: [] };
    this.initStarted = true;
    this.options = options;
    this.tier = options.quality;
    const caps = await this.deps.probe(options.preferred);
    const selection = selectBackend(caps);
    if (selection.backend === 'none') return { ok: false, reason: noBackendMessage(selection.reasons), tried: [] };

    const tried: RenderBackend[] = [];
    const failures: string[] = [];
    for (const attempt of selection.attempts) {
      const b = ATTEMPT_BACKEND[attempt];
      if (!tried.includes(b)) tried.push(b);
      try {
        this.handle = await this.deps.initBackend(canvas, attempt, { antialias: TIER_PRESETS[this.tier].antialias });
        break;
      } catch (err) {
        failures.push(`${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!this.handle) return { ok: false, reason: noBackendMessage([...selection.reasons, ...failures]), tried };

    this.backendKind = this.handle.backend;
    if (!tried.includes(this.backendKind)) tried.push(this.backendKind);
    this.handle.onLost((reason) => this.handleLost(reason));
    this.buildScene(manifest);
    this.setQuality(this.tier);
    this.applySize();
    return { ok: true, backend: this.handle.backend, notes: [...selection.reasons, ...failures, ...this.handle.notes] };
  }

  private buildScene(manifest: LevelManifest): void {
    this.manifest = manifest;
    const plan = buildScenePlan(manifest);
    const mats = createMaterials();
    const geo = createSharedGeometry();
    this.plan = plan;
    this.mats = mats;
    this.geo = geo;
    this.scene.background = new Color(PALETTE.skyHorizon);
    this.scene.add(
      new HemisphereLight(PALETTE.skyHorizon, PALETTE.water, 1.3),
      Object.assign(new DirectionalLight(PALETTE.sun, 2.2), { name: 'sun' }),
      new AmbientLight(0xffffff, 0.15),
    );
    this.scene.getObjectByName('sun')!.position.set(120, 60, -80);

    this.handles = buildCriticalScene(plan, mats, geo);
    this.scene.add(this.handles.root);
    this.player = buildPlayer(mats, geo);
    this.ghost = buildPlayerGhost(mats, geo, this.player.capsule);
    this.ghostBox = box(geo, mats.ghost, [0, 0, 0], [1, 1, 1]);
    this.ghostBox.visible = false;
    this.effectsView = new EffectsView(mats, geo);
    this.scene.add(this.player.group, this.ghost, this.ghostBox, this.effectsView.group);
    const spawn = manifest.geometry.spawn;
    this.player.group.position.set(...spawn.feet);
    const b = surfaceBasis(spawn.up, spawn.yaw);
    orient(this.player.group, b.up, b.forward);
    this.easer.reset(axisToVec(spawn.up));
    this.readinessTracker.markCriticalBuilt();

    const add = (piece: OptionalPiece): void => {
      this.optional.push(piece);
      for (const o of piece.objects) this.scene.add(o);
      this.applyEffectsLevel(this.governor.state().effectsLevel);
    };
    this.readinessTracker.enqueueOptional('sky', () => add(buildSky(this.scene)));
    this.readinessTracker.enqueueOptional('fog', () => add(buildFog(this.scene)));
    this.readinessTracker.enqueueOptional('coast', () => add(buildCoast(plan)));
    this.readinessTracker.enqueueOptional('spray', () => add(buildSpray(plan, mats, geo, TIER_PRESETS.high.sprayParticles)));
    this.readinessTracker.enqueueOptional('ribs', () => add(buildRibsAndLamps(plan, mats, geo)));
  }

  render(frame: RenderFrame): void {
    if (!this.handle || this.lost || this.disposed || !this.handles || !this.mats || !this.player || !this.plan) return;
    const t0 = now();
    const { prev, curr, alpha, events, nowMs } = frame;
    const cam = { ...frame.camera, reducedMotion: frame.camera.reducedMotion || this.options.reducedMotion };
    const pose = interpolatePlayer(prev, curr, alpha, events);

    // Camera up easing is purely render-time.
    if (this.lastUp === null || events.some((e) => e.type === 'PlayerRespawned')) this.easer.reset(pose.basis.up);
    else if (curr.player.up !== this.lastUp) this.easer.begin(pose.basis.up, nowMs, pose.basis.forward);
    this.lastUp = curr.player.up;

    this.player.group.position.set(...pose.pos);
    orient(this.player.group, pose.basis.up, pose.basis.forward);
    this.updateAnchors(curr);
    const dynBoxes = this.updateDynamics(prev, curr, alpha);
    for (const m of interpolateMachines(prev, curr, alpha)) {
      const h = this.handles.machines.get(m.key);
      if (h) updateMachine(h, m.pos, m.up, m.visible, m.state, curr.keeper, pose.pos, this.mats, nowMs);
    }
    this.updateGhost(frame.previewAnchorKey, curr);

    this.timeline.ingest(events, nowMs, { playerPos: pose.pos, playerForward: pose.basis.forward });
    this.effectsView!.update(this.timeline, nowMs, curr, this.handles, { motion: cam.reducedMotion, flashes: cam.reducedMotion }, pose.pos, pose.basis.up);
    for (const p of this.optional) p.update?.(nowMs, pose.pos);

    const easedUp = this.easer.localUp(nowMs, cam);
    const rollUp = this.easer.cameraUp(nowMs, cam);
    const cp = computeCameraPose(pose.pos, pose.basis, easedUp, rollUp, pose.pitch, [...this.plan.staticBoxes, ...dynBoxes]);
    const shake = shakeOffset(this.timeline.live(), nowMs, cam.reducedMotion);
    this.camera.position.set(cp.position[0] + shake[0], cp.position[1] + shake[1], cp.position[2] + shake[2]);
    this.camera.up.set(...cp.up);
    this.camera.lookAt(cp.target[0], cp.target[1], cp.target[2]);
    const fov = Math.min(110, Math.max(40, cam.fovDeg || 62));
    if (fov !== this.camera.fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    try {
      this.handle.render(this.scene, this.camera);
      this.lastInfo = this.handle.info();
    } catch (err) {
      this.handleLost(`render failed on ${this.handle.attempt}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.readinessTracker.afterFrame();

    this.lastCpuMs = now() - t0;
    const gpu = this.handle.gpuFrameMs();
    const decision = this.governor.sample(Math.max(this.lastCpuMs, gpu ?? 0), nowMs);
    if (decision.changed) {
      this.applyEffectsLevel(decision.effectsLevel);
      this.applySize();
    }
  }

  private updateAnchors(curr: Readonly<SimState>): void {
    const mats = this.mats!;
    for (const [key, h] of this.handles!.anchors) {
      const st = curr.anchors.find((a) => a.key === key);
      const inside = curr.player.anchorKey === key;
      const mat = st && !st.enabled ? mats.glyphDisabled : inside ? mats.glyphWhite : mats.glyphIdle;
      h.glyphs.forEach((g, i) => {
        g.material = mat;
        h.activeDots[i]!.visible = (st?.activeSurface ?? h.node.def.initial) === i;
      });
      h.group.children[0]!.visible = inside;
    }
  }

  private updateDynamics(prev: Readonly<SimState>, curr: Readonly<SimState>, alpha: number): Aabb[] {
    const offsets = interpolateDynamics(prev, curr, alpha);
    const boxes: Aabb[] = [];
    for (const def of this.manifest!.geometry.dynamics) {
      const h = this.handles!.dynamics.get(def.key);
      const o = offsets.get(def.key) ?? [0, 0, 0];
      if (h) h.group.position.set(h.base[0] + o[0], h.base[1] + o[1], h.base[2] + o[2]);
      boxes.push(translateBox(def.box, o));
      for (const c of this.manifest!.geometry.colliders) if (c.dynamicKey === def.key) boxes.push(translateBox(c.box, o));
    }
    return boxes;
  }

  private updateGhost(anchorKey: string | null, curr: Readonly<SimState>): void {
    const ghost = this.ghost!;
    const gbox = this.ghostBox!;
    ghost.visible = false;
    gbox.visible = false;
    if (!anchorKey) return;
    const def = this.manifest!.geometry.anchors.find((a) => a.key === anchorKey);
    if (!def) return;
    const st = curr.anchors.find((a) => a.key === anchorKey);
    const other = (1 - (st?.activeSurface ?? def.initial)) as 0 | 1;
    const surface = def.surfaces[other];
    if (def.target === 'player' && surface.landing) {
      const b = surfaceBasis(surface.landing.up, surface.landing.yaw);
      ghost.position.set(...surface.landing.feet);
      orient(ghost, b.up, b.forward);
      ghost.visible = true;
      return;
    }
    const dyn = this.manifest!.geometry.dynamics.find((d) => d.key === def.targetKey);
    if (dyn && surface.dynamicPose !== undefined) {
      const o = dyn.poses[surface.dynamicPose] ?? [0, 0, 0];
      const b = translateBox(dyn.box, o);
      gbox.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      gbox.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      gbox.quaternion.identity();
      gbox.visible = true;
      return;
    }
    const m = curr.machines.find((x) => x.key === def.targetKey);
    if (m) {
      const size = MACHINE_SIZE[m.kind];
      const u = axisToVec(surface.up) as V3;
      gbox.position.set(m.pos[0] + u[0] * size[1] / 2, m.pos[1] + u[1] * size[1] / 2, m.pos[2] + u[2] * size[1] / 2);
      gbox.scale.set(size[0], size[1], size[2]);
      orient(gbox, u, surfaceBasis(surface.up, 0).forward);
      gbox.visible = true;
    }
  }

  private applyEffectsLevel(level: 0 | 1 | 2): void {
    for (const p of this.optional) {
      for (const o of p.objects) o.visible = level >= p.minLevel;
      p.setLevel?.(level);
    }
  }

  private applySize(): void {
    if (!this.handle) return;
    const preset = TIER_PRESETS[this.tier];
    this.handle.setSize(this.size.w, this.size.h);
    this.handle.setPixelRatio(Math.min(this.size.dpr, preset.maxPixelRatio) * this.governor.state().internalScale);
    this.camera.aspect = this.size.w / Math.max(1, this.size.h);
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.size = { w: Math.max(1, Math.floor(width)), h: Math.max(1, Math.floor(height)), dpr: Math.max(0.5, devicePixelRatio || 1) };
    this.governor.resetWindow();
    this.applySize();
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    this.governor = QualityGovernor.forTier(tier);
    this.applyEffectsLevel(this.governor.state().effectsLevel);
    this.applySize();
  }

  readiness(): RenderReadiness {
    return this.readinessTracker.current();
  }

  onDeviceLost(cb: (info: { reason: string }) => void): void {
    this.lostCbs.push(cb);
  }

  stats(): RenderStats {
    return {
      backend: this.backendKind,
      cpuFrameMs: this.lastCpuMs,
      gpuFrameMs: this.handle?.gpuFrameMs() ?? null,
      internalScale: this.governor.state().internalScale,
      quality: this.tier,
      drawCalls: this.lastInfo.drawCalls,
      triangles: this.lastInfo.triangles,
    };
  }

  private handleLost(reason: string): void {
    if (this.lost || this.disposed) return;
    this.lost = true;
    for (const cb of this.lostCbs) {
      try { cb({ reason }); } catch { /* a listener must not block cleanup */ }
    }
    this.releaseGpu();
  }

  private releaseGpu(): void {
    try { this.handle?.dispose(); } catch { /* context already gone */ }
    this.handle = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.optional) p.dispose();
    this.optional = [];
    this.scene.traverse((o) => { if ((o as { isInstancedMesh?: boolean }).isInstancedMesh) (o as unknown as { dispose(): void }).dispose(); });
    this.scene.clear();
    this.scene.fog = null;
    this.player?.capsule.dispose();
    if (this.geo) disposeSharedGeometry(this.geo);
    for (const m of this.mats?.all() ?? []) m.dispose();
    this.releaseGpu();
    this.timeline.clear();
    this.lostCbs.length = 0;
  }
}

export const createRenderer: CreateRenderer = () => new FloodlineRenderer();
