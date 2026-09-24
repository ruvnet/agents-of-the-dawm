/**
 * Axis-aligned gravity frames, vector helpers and the player body box.
 * All local ups are world axes (ADR 0004), so nothing is ever rotated by an arbitrary angle:
 * the body is always an AABB and yaw only rotates move input inside the tangent plane.
 */
import type { Aabb, Axis, Vec3 } from '../contracts/math';
import { axisToVec } from '../contracts/math';
import { PLAYER_BODY } from '../contracts/sim';

export type V3 = [number, number, number];

export const v3 = (v: Vec3): V3 => [v[0], v[1], v[2]];
export const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

export function axisIndex(axis: Axis): 0 | 1 | 2 {
  return axis[1] === 'x' ? 0 : axis[1] === 'y' ? 1 : 2;
}
export function axisSign(axis: Axis): 1 | -1 {
  return axis[0] === '+' ? 1 : -1;
}

/** Remove the component along `up` (project onto the tangent plane). */
export function tangential(v: Vec3, up: Axis): V3 {
  const out = v3(v);
  out[axisIndex(up)] = 0;
  return out;
}

/**
 * Yaw convention shared with the renderer (src/render/interpolate.ts surfaceBasis, copied not
 * imported): the yaw-0 reference tangent R is world +x when up is ±y, otherwise world +y (so on a
 * wall yaw 0 walks up it). Forward is R rotated about up by `yaw` with the right-hand rule, so
 * positive yaw turns LEFT. right = forward × up. move2 = [strafe, forward] in this basis.
 */
export function referenceTangent(up: Axis): V3 {
  return up === '+y' || up === '-y' ? [1, 0, 0] : [0, 1, 0];
}

function cross(a: Vec3, b: Vec3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export interface SurfaceBasis {
  readonly up: V3;
  readonly forward: V3;
  readonly right: V3;
}

/** Deterministic tangent frame for a local up and yaw. Exported for camera/render and the autopilot. */
export function surfaceBasis(up: Axis, yaw: number): SurfaceBasis {
  const u = v3(axisToVec(up));
  const r = referenceTangent(up);
  // Rodrigues rotation of r (perpendicular to u) about u: r cos + (u × r) sin.
  const forward = add(scale(r, Math.cos(yaw)), scale(cross(u, r), Math.sin(yaw)));
  return { up: u, forward, right: cross(forward, u) };
}

export interface MutBox { min: V3; max: V3 }

/** Player AABB: 0.6 m on both tangent axes around the feet, 1.8 m along up. */
export function bodyBox(feet: Vec3, up: Axis): MutBox {
  const half = PLAYER_BODY.width / 2;
  const min: V3 = [feet[0] - half, feet[1] - half, feet[2] - half];
  const max: V3 = [feet[0] + half, feet[1] + half, feet[2] + half];
  const i = axisIndex(up);
  if (axisSign(up) > 0) { min[i] = feet[i]; max[i] = feet[i] + PLAYER_BODY.height; }
  else { min[i] = feet[i] - PLAYER_BODY.height; max[i] = feet[i]; }
  return { min, max };
}

export function bodyCenter(feet: Vec3, up: Axis): V3 {
  return add(feet, scale(axisToVec(up), PLAYER_BODY.height / 2));
}

/** Inclusive point containment (anchor volumes, zones, triggers). */
export function contains(box: Aabb, p: Vec3, eps = 1e-6): boolean {
  for (let i = 0; i < 3; i++) {
    if (p[i]! < box.min[i]! - eps || p[i]! > box.max[i]! + eps) return false;
  }
  return true;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}


export const axisToVecV = (a: Axis): V3 => v3(axisToVec(a));
