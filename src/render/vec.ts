/**
 * Tiny, allocation-light Vec3 helpers for the render layer. Pure (no three.js) so the
 * interpolation, camera and scene-plan math can be unit tested in node.
 */
import type { Aabb, Vec3 } from '../contracts/math';

export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3, fallback: Vec3 = [0, 1, 0]): V3 {
  const l = length(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [fallback[0], fallback[1], fallback[2]];
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);

export const boxCenter = (b: Aabb): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
export const boxSize = (b: Aabb): V3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const translateBox = (b: Aabb, o: Vec3): Aabb => ({ min: add(b.min, o), max: add(b.max, o) });
export const boxContains = (b: Aabb, p: Vec3, eps = 0): boolean =>
  p[0] > b.min[0] - eps && p[0] < b.max[0] + eps &&
  p[1] > b.min[1] - eps && p[1] < b.max[1] + eps &&
  p[2] > b.min[2] - eps && p[2] < b.max[2] + eps;

/** Rotate `v` about unit axis `k` by `angle` radians (Rodrigues). */
export function rotateAbout(v: Vec3, k: Vec3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross(k, v);
  const kdv = dot(k, v) * (1 - c);
  return [v[0] * c + kxv[0] * s + k[0] * kdv, v[1] * c + kxv[1] * s + k[1] * kdv, v[2] * c + kxv[2] * s + k[2] * kdv];
}

/** Any unit vector perpendicular to unit `a`. */
export function anyPerpendicular(a: Vec3): V3 {
  const ref: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(a, ref));
}

/**
 * Spherical interpolation between unit vectors. When they are (nearly) antipodal the
 * rotation plane is ambiguous, so `hint` (a vector roughly perpendicular to both) picks it.
 */
export function slerpUnit(a: Vec3, b: Vec3, t: number, hint?: Vec3): V3 {
  const d = clamp(dot(a, b), -1, 1);
  if (d > 0.9999) return normalize(lerpV(a, b, t), b);
  let axis: V3;
  if (d < -0.9999) {
    const h = hint ? normalize(sub(hint, scale(a, dot(hint, a))), anyPerpendicular(a)) : anyPerpendicular(a);
    axis = normalize(cross(a, h));
  } else {
    axis = normalize(cross(a, b));
  }
  return normalize(rotateAbout(a, axis, Math.acos(d) * t), b);
}
