/** Initial state construction and the ADR 0004 checkpoint/retry rules. */
import type { LevelManifest, MachineDef, LandingPose } from '../contracts/manifest';
import type { AssistSettings, MachineState, SimOptions, SimState } from '../contracts/sim';
import { PLAYER_MAX_HEALTH } from '../contracts/sim';
import type { Ctx } from './ctx';
import { RULES, emit } from './ctx';
import { bodyBox, v3 } from './frame';
import { sweepAxis, worldColliders } from './collision';
import { axisIndex, axisSign } from './frame';

export const DEFAULT_ASSIST: AssistSettings = { aimAssist: false, halfDamage: false, extendedExposure: false };

export function machineHealth(def: MachineDef): number {
  if (def.kind === 'keeper') return RULES.keeper.seals;
  return RULES.machine[def.kind].health;
}

/** Machines tied to a branch or to a later keeper phase spawn inactive. */
export function machineInitial(def: MachineDef): MachineState {
  const reinforcement = def.beat === 'keeper-arena' && def.kind !== 'keeper';
  return {
    key: def.key,
    kind: def.kind,
    pos: v3(def.pos),
    up: def.up,
    health: machineHealth(def),
    mode: def.dormant ? 'dormant' : 'patrol',
    modeTicks: 0,
    patrolIndex: 0,
    active: !def.branch && !reinforcement && def.kind !== 'keeper',
  };
}

export function isGrounded(m: LevelManifest, s: SimState): boolean {
  const p = s.player;
  const i = axisIndex(p.up);
  const d = -axisSign(p.up) * RULES.groundProbe;
  const allowed = sweepAxis(bodyBox(p.pos, p.up), i, d, worldColliders(m, s));
  return Math.abs(allowed) < Math.abs(d) - 1e-9;
}

export function createInitialState(m: LevelManifest, opts: SimOptions): SimState {
  const g = m.geometry;
  const seed = opts.seed >>> 0;
  const s: SimState = {
    version: 1,
    seed,
    rngState: seed,
    tick: 0,
    paused: false,
    beat: 'west-approach',
    branch: 'none',
    checkpointKey: g.checkpoints[0]?.key ?? 'spawn',
    player: {
      pos: v3(g.spawn.feet),
      vel: [0, 0, 0],
      up: g.spawn.up,
      yaw: g.spawn.yaw,
      pitch: 0,
      health: PLAYER_MAX_HEALTH,
      charge: RULES.startCharge,
      overdrive: 0,
      grounded: false,
      anchorKey: null,
      toolCooldown: 0,
      invulnerableTicks: 0,
    },
    anchors: g.anchors.map((a) => ({ key: a.key, activeSurface: a.initial, enabled: a.target === 'player', cooldownTicks: 0 })),
    machines: g.machines.map(machineInitial),
    dynamics: g.dynamics.map((d) => ({ key: d.key, pose: d.initialPose, offset: v3(d.poses[d.initialPose] ?? [0, 0, 0]), moving: false })),
    puzzles: {},
    keeper: {
      phase: 0,
      sealsRemaining: RULES.keeper.seals,
      sealExposedTicks: 0,
      surgeTimerTicks: 0,
      surgeIntervalTicks: RULES.keeper.surgeInterval,
      freeStunAvailable: false,
    },
    flags: {
      channelLocated: false,
      channelSensorVerified: false,
      channelEdgeRestored: false,
      playerAuthorized: false,
      capacitySafe: false,
      gateOpen: false,
    },
    pressure: {
      routes: m.pressure.routes.map((r) => ({ ...r })),
      panelOpen: false,
      previewed: [],
      selectedDestination: null,
      capacityChecks: { pumpWithinTolerance: false, streetUnoccupiedByFlow: false, reliefWithinTolerance: false },
    },
    fired: [],
    assist: { ...DEFAULT_ASSIST, ...(opts.assist ?? {}) },
    tramCrossed: false,
  };
  const zone = g.zones.find((z) => z.key === 'west-approach');
  if (zone) s.beat = zone.beat;
  s.player.grounded = isGrounded(m, s);
  return s;
}

export function checkpointPose(m: LevelManifest, s: SimState): LandingPose {
  return m.geometry.checkpoints.find((c) => c.key === s.checkpointKey)?.pose ?? m.geometry.spawn;
}

export function placePlayer(m: LevelManifest, s: SimState, pose: LandingPose): void {
  s.player.pos = v3(pose.feet);
  s.player.up = pose.up;
  s.player.yaw = pose.yaw;
  s.player.pitch = 0;
  s.player.vel = [0, 0, 0];
  s.player.anchorKey = null;
  s.player.grounded = isGrounded(m, s);
}

/**
 * Retry rules (ADR 0004 invariant 4, script beats 3/6): back to the checkpoint pose with full health
 * and standard charge. Active, not-yet-disabled machines return to their authored start (the first
 * machine again waits for input). Keeper seals, dynamics, story flags, pressure and fired keys are
 * retained, so a retry can never produce a second reward nor an open gate.
 */
export function applyRetry(c: Ctx, reason: string): void {
  const { m, s } = c;
  placePlayer(m, s, checkpointPose(m, s));
  s.player.health = PLAYER_MAX_HEALTH;
  s.player.charge = Math.max(s.player.charge, RULES.standardCharge);
  s.player.invulnerableTicks = RULES.invulnerableTicks;
  s.player.toolCooldown = 0;
  s.machines = s.machines.map((ms) => {
    const def = m.geometry.machines.find((d) => d.key === ms.key);
    if (!def || ms.mode === 'disabled' || ms.kind === 'keeper') return ms;
    return { ...machineInitial(def), active: ms.active };
  });
  const k = s.keeper;
  if (k.phase >= 1 && k.phase <= 3) {
    k.sealExposedTicks = 0;
    k.surgeTimerTicks = k.surgeIntervalTicks;
    const keeper = s.machines.find((x) => x.kind === 'keeper');
    const def = m.geometry.machines.find((d) => d.kind === 'keeper');
    if (keeper && def) {
      keeper.pos = v3(def.pos);
      keeper.up = def.up;
      keeper.mode = 'patrol';
      keeper.modeTicks = k.phase === 3 ? RULES.keeper.chargeWindup : 0;
    }
  }
  emit(c, 'PlayerRespawned', s.checkpointKey, { reason, health: s.player.health, charge: s.player.charge });
}
