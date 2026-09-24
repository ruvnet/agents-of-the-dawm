/**
 * Browser smoke harness for the renderer (not part of the app; the coordinator owns main.ts).
 * Serve with vite and open tests/render/harness/index.html?preferred=auto|webgl2&shift=1.
 * Publishes a result object on window.__renderSmoke for tests/render/harness/smoke.mjs.
 */
import { loadSector01 } from '../../../src/contracts/fixtures';
import type { SimState } from '../../../src/contracts/sim';
import type { RendererOptions } from '../../../src/contracts/render';
import { createRenderer } from '../../../src/render';

declare global { interface Window { __renderSmoke?: unknown } }

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const preferred = (params.get('preferred') ?? 'auto') as RendererOptions['preferred'];
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const manifest = loadSector01();
  const r = createRenderer();
  const res = await r.init(canvas, manifest, { preferred, quality: 'medium', reducedMotion: false });
  if (!res.ok) { window.__renderSmoke = { ok: false, res }; return; }
  const lost: string[] = [];
  r.onDeviceLost((info) => lost.push(info.reason));
  r.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio);
  const g = manifest.geometry;
  const base: SimState = {
    version: 1, seed: 1, rngState: 1, tick: 0, paused: false, beat: 'west-approach', branch: 'none', checkpointKey: 'cp-spawn',
    player: { pos: [...g.spawn.feet], vel: [0, 0, 0], up: g.spawn.up, yaw: g.spawn.yaw, pitch: 0, health: 100, charge: 0, overdrive: 0, grounded: true, anchorKey: null, toolCooldown: 0, invulnerableTicks: 0 },
    anchors: g.anchors.map((a) => ({ key: a.key, activeSurface: a.initial, enabled: true, cooldownTicks: 0 })),
    machines: [], dynamics: [], puzzles: {},
    keeper: { phase: 0, sealsRemaining: 3, sealExposedTicks: 0, surgeTimerTicks: 0, surgeIntervalTicks: 600, freeStunAvailable: true },
    flags: { channelLocated: false, channelSensorVerified: false, channelEdgeRestored: false, playerAuthorized: false, capacitySafe: false, gateOpen: false },
    pressure: { routes: [], panelOpen: false, previewed: [], selectedDestination: null, capacityChecks: {} as SimState['pressure']['capacityChecks'] },
    fired: [], assist: { aimAssist: false, halfDamage: false, extendedExposure: false }, tramCrossed: false,
  };
  const shiftAt = params.get('shift') ? 20 : -1;
  const phases: string[] = [];
  let prev = base;
  for (let i = 0; i < 60; i++) {
    const x = 2 + i * 0.4;
    const shifted = shiftAt >= 0 && i >= shiftAt;
    const curr: SimState = {
      ...prev, tick: i + 1,
      player: shifted
        ? { ...prev.player, pos: [28, 1.5 + (i - shiftAt) * 0.1, 4], up: '-z', anchorKey: 'anchor-a1-inspection' }
        : { ...prev.player, pos: [Math.min(x, 27), 0, 2.5], anchorKey: x > 26 ? 'anchor-a1-inspection' : null },
    };
    const events = shifted && i === shiftAt ? [{ id: `ShiftCommitted:${i}:a1`, tick: i, type: 'ShiftCommitted' as const, key: 'anchor-a1-inspection', payload: {} }] : [];
    r.render({ alpha: 1, prev, curr, events, camera: { noRoll: false, reducedMotion: false, fovDeg: 62, motionBlur: false }, previewAnchorKey: i < shiftAt ? 'anchor-a1-inspection' : null, nowMs: performance.now() });
    phases.push(r.readiness());
    prev = curr;
    await new Promise((res2) => requestAnimationFrame(() => res2(null)));
  }
  const complete = phases.at(-1) === 'complete' && lost.length === 0;
  window.__renderSmoke = { ok: complete, res, lost, phases: [...new Set(phases)], stats: r.stats() };
}

main().catch((err) => { window.__renderSmoke = { ok: false, error: String(err && (err as Error).stack || err) }; });
