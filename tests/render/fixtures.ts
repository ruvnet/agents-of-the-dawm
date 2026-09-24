/** Test-only builders for render tests: SimState from a manifest and a richer synthetic manifest. */
import { loadSector01 } from '../../src/contracts/fixtures';
import type { GeometryManifest, LevelManifest } from '../../src/contracts/manifest';
import type { SimState, WorldEvent, WorldEventType } from '../../src/contracts/sim';
import type { RenderFrame } from '../../src/contracts/render';

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export function makeState(m: LevelManifest, patch: Partial<SimState> = {}): SimState {
  const g = m.geometry;
  return {
    version: 1, seed: 1, rngState: 1, tick: 0, paused: false, beat: 'west-approach', branch: 'none', checkpointKey: 'cp-spawn',
    player: {
      pos: [...g.spawn.feet], vel: [0, 0, 0], up: g.spawn.up, yaw: g.spawn.yaw, pitch: 0, health: 100, charge: 0, overdrive: 0,
      grounded: true, anchorKey: null, toolCooldown: 0, invulnerableTicks: 0,
    },
    anchors: g.anchors.map((a) => ({ key: a.key, activeSurface: a.initial, enabled: true, cooldownTicks: 0 })),
    machines: g.machines.map((d) => ({
      key: d.key, kind: d.kind, pos: [...d.pos], up: d.up, health: 100, mode: 'dormant', modeTicks: 0, patrolIndex: 0, active: !d.branch,
    })),
    dynamics: g.dynamics.map((d) => ({ key: d.key, pose: d.initialPose, offset: [...(d.poses[d.initialPose] ?? [0, 0, 0])], moving: false })),
    puzzles: {},
    keeper: { phase: 0, sealsRemaining: 3, sealExposedTicks: 0, surgeTimerTicks: 0, surgeIntervalTicks: 600, freeStunAvailable: true },
    flags: { channelLocated: false, channelSensorVerified: false, channelEdgeRestored: false, playerAuthorized: false, capacitySafe: false, gateOpen: false },
    pressure: {
      routes: [], panelOpen: false, previewed: [], selectedDestination: null,
      capacityChecks: {} as SimState['pressure']['capacityChecks'],
    },
    fired: [], assist: { aimAssist: false, halfDamage: false, extendedExposure: false }, tramCrossed: false,
    ...patch,
  };
}

export function ev(type: WorldEventType, tick: number, key = ''): WorldEvent {
  return { id: `${type}:${tick}:${key}`, tick, type, key, payload: {} };
}

export function frame(prev: SimState, curr: SimState, patch: Partial<RenderFrame> = {}): RenderFrame {
  return {
    alpha: 0.5, prev, curr, events: [], previewAnchorKey: null, nowMs: 0,
    camera: { noRoll: false, reducedMotion: false, fovDeg: 62, motionBlur: false },
    ...patch,
  };
}

/** sector-01 plus machines, dynamics, more decor and a second anchor: exercises every builder. */
export function richManifest(): LevelManifest {
  const base = loadSector01();
  const g = base.geometry;
  const geometry: GeometryManifest = {
    ...g,
    colliders: [
      ...g.colliders,
      { key: 'deck-mesh-a', box: { min: [34, -1, -4], max: [50, 0, 4] }, material: 'mesh' },
      { key: 'deck-mesh-b', box: { min: [50, -1, -4], max: [60, 0, 4] }, material: 'mesh' },
      { key: 'gantry-floor', box: { min: [62, 0, -2], max: [66, 0.3, 2] }, material: 'metal', dynamicKey: 'gantry' },
    ],
    dynamics: [{ key: 'gantry', kind: 'gantry', box: { min: [62, 0, -2], max: [66, 3, 2] }, poses: [[0, 0, 0], [0, -4, 0]], initialPose: 0 }],
    anchors: [
      ...g.anchors,
      {
        key: 'anchor-gantry', entityKey: g.anchors[0]!.entityKey, beat: 'floating-gantry',
        volume: { min: [58, 0, -1], max: [60, 2.5, 1] },
        surfaces: [{ up: '+y', glyph: 'crescent-floor', dynamicPose: 0 }, { up: '+y', glyph: 'crescent-lower', dynamicPose: 1 }],
        initial: 0, target: 'gantry', targetKey: 'gantry',
      },
    ],
    machines: [
      { key: 'skimmer-1', kind: 'skimmer', pos: [40, 0, 0], up: '+y', beat: 'maintenance-deck', dormant: true },
      { key: 'hauler-1', kind: 'hauler', pos: [120, 0, 0], up: '+y', beat: 'lower-conduit', dormant: false, branch: 'lower' },
      { key: 'keeper', kind: 'keeper', pos: [200, 0, 0], up: '+y', beat: 'keeper-arena', dormant: false },
    ],
    interactables: [
      ...g.interactables,
      { key: 'valve-1', kind: 'valve', pos: [45, 1, 3], radius: 1 },
      { key: 'cell-1', kind: 'charge-cell', pos: [30, 15, 9.5], radius: 0.8 },
    ],
    decor: [
      ...g.decor,
      { key: 'pump', kind: 'pump', box: { min: [210, 0, 8], max: [214, 6, 12] } },
      { key: 'reservoir', kind: 'reservoir', box: { min: [150, 0, 20], max: [180, 8, 40] } },
      { key: 'relief', kind: 'relief-channel', box: { min: [150, -3, -20], max: [200, 0, -16] } },
      { key: 'street', kind: 'street', box: { min: [236, -0.2, -10], max: [300, 0, 10] } },
      { key: 'sea', kind: 'sea', box: { min: [-500, -4, -500], max: [800, -3, -20] } },
      { key: 'pipe', kind: 'pipe', box: { min: [150, 1, -14], max: [200, 2, -13] } },
    ],
  };
  return { ...base, geometry };
}
