/**
 * Floodline renderer (W2.RENDER.01) — public API.
 *
 * Main entry:
 *   const r = createRenderer();                         // RendererAdapter (src/contracts/render.ts)
 *   const res = await r.init(canvas, manifest, { preferred: 'auto', quality: 'medium', reducedMotion });
 *   if (!res.ok) showCompatibilityMessage(res.reason);  // actionable text; never a blank canvas
 *   r.onDeviceLost(({ reason }) => offerReload(reason)); // GPU resources are already released
 *   r.resize(w, h, devicePixelRatio);                   // canvas CSS size is left to the app
 *   each frame: r.render({ alpha, prev, curr, events, camera, previewAnchorKey, nowMs });
 *   r.readiness(): 'initializing' → 'controllable' → 'optional-loading' → 'complete'
 *   r.stats(), r.setQuality('low' | 'medium' | 'high'), r.dispose()
 *
 * Backend chain (ADR 0002): three WebGPURenderer (WebGPU) → WebGPURenderer forceWebGL (WebGL2)
 * → classic WebGLRenderer (strict exit). `three/webgpu` is lazy-loaded.
 *
 * Guarantees: the renderer only reads RenderFrame (never mutates SimState); quality, backend
 * and camera easing are render-only and cannot change simulation ticks.
 *
 * Pure, node-testable building blocks are exported too: selectBackend, QualityGovernor,
 * buildScenePlan, interpolatePlayer/Machines/Dynamics, surfaceBasis (proposed yaw convention,
 * see CONTRACT_PROPOSALS.md), CameraUpEaser, computeCameraPose, EffectTimeline, ReadinessTracker.
 */
export { createRenderer, FloodlineRenderer } from './renderer';
export {
  selectBackend, noBackendMessage, probeCapabilities, ATTEMPT_BACKEND,
  type BackendAttempt, type BackendCapabilities, type BackendSelection,
} from './backend-select';
export {
  QualityGovernor, TIER_PRESETS, DEFAULT_GOVERNOR,
  type GovernorConfig, type GovernorDecision, type GovernorState, type TierPreset,
} from './quality';
export { ReadinessTracker } from './readiness';
export {
  buildScenePlan, criticalSetPresent, glyphPosition, nodesOf, MACHINE_SIZE,
  type ScenePlan, type PlanNode, type PlanCategory, type PlanLayer,
} from './scene-plan';
export {
  interpolatePlayer, interpolateMachines, interpolateDynamics, playerShouldSnap, lerpAngle,
  surfaceBasis, referenceTangent, type PlayerPose, type SurfaceBasis,
} from './interpolate';
export {
  CameraUpEaser, computeCameraPose, pullIn, rayAabb, safeUp, easeInOut, SHIFT_EASE_MS, DEFAULT_RIG,
  type CameraPose, type CameraRigConfig,
} from './camera';
export {
  EffectTimeline, EFFECT_FOR_EVENT, effectProgress, seamIntensity, flashOpacity, gateOpenAmount, tramTravel, shakeOffset,
  type ActiveEffect, type EffectKind,
} from './effects';
export { PALETTE } from './palette';
