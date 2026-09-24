/**
 * Pure prev→curr interpolation of committed simulation states (ADR 0004: render holds no
 * authority). Nothing here writes to the SimState objects it reads.
 */
import { axisToVec, type Axis, type Vec3 } from '../contracts/math';
import type { DynamicState, MachineState, SimState, WorldEvent } from '../contracts/sim';
import { clamp01, cross, lerp, lerpV, normalize, rotateAbout, type V3 } from './vec';

/**
 * PROPOSED yaw convention (see CONTRACT_PROPOSALS.md, P1). On a surface with up axis U the
 * yaw-0 reference tangent R is world +x when U is ±y, otherwise world +y. Forward is R rotated
 * about U by `yaw` (right-handed, so positive yaw turns left). Right = forward × up.
 * Rationale: spawn yaw 0 on +y faces +x along the district, putting the inspection wall (+z)
 * on the right as the script's west-approach view describes; on a wall, yaw 0 walks "up" it.
 */
export function referenceTangent(up: Axis): V3 {
  return up === '+y' || up === '-y' ? [1, 0, 0] : [0, 1, 0];
}

export interface SurfaceBasis {
  readonly up: V3;
  readonly forward: V3;
  readonly right: V3;
}

export function surfaceBasis(up: Axis, yaw: number): SurfaceBasis {
  const u = axisToVec(up) as V3;
  const forward = normalize(rotateAbout(referenceTangent(up), u, yaw));
  const right = normalize(cross(forward, u));
  return { up: [u[0], u[1], u[2]], forward, right };
}

/** Shortest-arc angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const TELEPORT_EVENTS = new Set(['ShiftCommitted', 'PlayerRespawned', 'PlayerFell']);

/**
 * A teleport (shift, respawn, fall) must not be smeared across the interpolation window:
 * snap to the current state instead.
 */
export function playerShouldSnap(prev: Readonly<SimState>, curr: Readonly<SimState>, events: readonly WorldEvent[]): boolean {
  if (prev.player.up !== curr.player.up) return true;
  return events.some((e) => TELEPORT_EVENTS.has(e.type));
}

export interface PlayerPose {
  readonly pos: V3;
  readonly up: Axis;
  readonly yaw: number;
  readonly pitch: number;
  readonly basis: SurfaceBasis;
  readonly snapped: boolean;
}

export function interpolatePlayer(prev: Readonly<SimState>, curr: Readonly<SimState>, alpha: number, events: readonly WorldEvent[]): PlayerPose {
  const snapped = playerShouldSnap(prev, curr, events);
  const t = snapped ? 1 : clamp01(alpha);
  const p = prev.player;
  const c = curr.player;
  const yaw = lerpAngle(p.yaw, c.yaw, t);
  const pitch = lerp(p.pitch, c.pitch, t);
  return { pos: lerpV(p.pos, c.pos, t), up: c.up, yaw, pitch, basis: surfaceBasis(c.up, yaw), snapped };
}

export interface MachinePose {
  readonly key: string;
  readonly pos: V3;
  readonly up: Axis;
  readonly visible: boolean;
  readonly state: Readonly<MachineState>;
}

export function interpolateMachines(prev: Readonly<SimState>, curr: Readonly<SimState>, alpha: number): MachinePose[] {
  const before = new Map(prev.machines.map((m) => [m.key, m] as const));
  const t = clamp01(alpha);
  return curr.machines.map((m) => {
    const p = before.get(m.key);
    const lerpable = p !== undefined && p.active === m.active && p.up === m.up;
    const pos: Vec3 = lerpable ? lerpV(p.pos, m.pos, t) : m.pos;
    return { key: m.key, pos: [pos[0], pos[1], pos[2]], up: m.up, visible: m.active, state: m };
  });
}

export function interpolateDynamics(prev: Readonly<SimState>, curr: Readonly<SimState>, alpha: number): Map<string, V3> {
  const before = new Map(prev.dynamics.map((d) => [d.key, d] as const));
  const t = clamp01(alpha);
  const out = new Map<string, V3>();
  for (const d of curr.dynamics as readonly DynamicState[]) {
    const p = before.get(d.key);
    out.set(d.key, p ? lerpV(p.offset, d.offset, t) : [d.offset[0], d.offset[1], d.offset[2]]);
  }
  return out;
}
