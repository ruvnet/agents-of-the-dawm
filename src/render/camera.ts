/**
 * Third-person camera math (pure). Camera easing is render-time only: it never feeds back
 * into the simulation (ADR 0004 "graphics layer can rotate the world for a no roll option").
 */
import type { Aabb, Vec3 } from '../contracts/math';
import type { CameraSettings } from '../contracts/render';
import type { SurfaceBasis } from './interpolate';
import { add, boxContains, clamp01, cross, dot, length, normalize, scale, slerpUnit, sub, type V3 } from './vec';

export const SHIFT_EASE_MS = 650;
export const WORLD_UP: V3 = [0, 1, 0];

/** Smoothstep ease used for the up-vector transition. */
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Eases the camera's local up between gravity states over ~0.65 s.
 * - `noRoll`: the camera's roll reference is always world +y (horizon stays level).
 * - `reducedMotion`: no easing; the target is adopted immediately.
 */
export class CameraUpEaser {
  private from: V3 = [0, 1, 0];
  private to: V3 = [0, 1, 0];
  private hint: V3 | undefined;
  private startMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly durationMs = SHIFT_EASE_MS) {}

  /** Set without transition (spawn, respawn, restore). */
  reset(up: Vec3): void {
    this.from = [up[0], up[1], up[2]];
    this.to = [up[0], up[1], up[2]];
    this.startMs = Number.NEGATIVE_INFINITY;
  }

  /** Begin easing from the currently displayed up toward `target`. */
  begin(target: Vec3, nowMs: number, hint?: Vec3): void {
    this.from = this.localUp(nowMs, { reducedMotion: false });
    this.to = [target[0], target[1], target[2]];
    this.hint = hint ? [hint[0], hint[1], hint[2]] : undefined;
    this.startMs = nowMs;
  }

  target(): V3 {
    return [this.to[0], this.to[1], this.to[2]];
  }

  progress(nowMs: number): number {
    return clamp01((nowMs - this.startMs) / this.durationMs);
  }

  isEasing(nowMs: number): boolean {
    return this.progress(nowMs) < 1;
  }

  /** Eased gravity-local up used to position the camera in the player's frame. */
  localUp(nowMs: number, s: Pick<CameraSettings, 'reducedMotion'>): V3 {
    if (s.reducedMotion) return this.target();
    return slerpUnit(this.from, this.to, easeInOut(this.progress(nowMs)), this.hint);
  }

  /** Up vector handed to the camera's lookAt (roll reference). */
  cameraUp(nowMs: number, s: Pick<CameraSettings, 'noRoll' | 'reducedMotion'>): V3 {
    if (s.noRoll) return [WORLD_UP[0], WORLD_UP[1], WORLD_UP[2]];
    return this.localUp(nowMs, s);
  }
}

export interface CameraRigConfig {
  readonly distance: number;
  readonly height: number;
  readonly lookHeight: number;
  readonly collisionRadius: number;
  readonly minDistance: number;
}

export const DEFAULT_RIG: CameraRigConfig = { distance: 5.2, height: 1.9, lookHeight: 1.45, collisionRadius: 0.3, minDistance: 0.7 };

export interface CameraPose {
  readonly position: V3;
  readonly target: V3;
  readonly up: V3;
  readonly pulledIn: boolean;
}

/** Ray/AABB slab test. Returns entry distance along unit `dir`, or null. Boxes containing the origin are ignored. */
export function rayAabb(origin: Vec3, dir: Vec3, box: Aabb, maxDist: number): number | null {
  let tmin = 0;
  let tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    const o = origin[i]!;
    const d = dir[i]!;
    const lo = box.min[i]!;
    const hi = box.max[i]!;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}

/** Pull the camera toward `target` so it stays in front of the first collider on the boom. */
export function pullIn(target: Vec3, desired: Vec3, boxes: readonly Aabb[], cfg: CameraRigConfig = DEFAULT_RIG): { position: V3; pulledIn: boolean } {
  const boom = sub(desired, target);
  const dist = length(boom);
  if (dist < 1e-6) return { position: [desired[0], desired[1], desired[2]], pulledIn: false };
  const dir = scale(boom, 1 / dist);
  let hit = dist + cfg.collisionRadius;
  for (const b of boxes) {
    if (boxContains(b, target)) continue;
    const t = rayAabb(target, dir, b, hit);
    if (t !== null && t < hit) hit = t;
  }
  if (hit >= dist + cfg.collisionRadius) return { position: [desired[0], desired[1], desired[2]], pulledIn: false };
  const d = Math.max(cfg.minDistance, hit - cfg.collisionRadius);
  return { position: add(target, scale(dir, Math.min(d, dist))), pulledIn: true };
}

/**
 * Behind-and-above the player in its (eased) local frame. `pitch` tilts the boom.
 * `forward` is re-projected onto the eased up plane so the camera turns smoothly mid-shift.
 */
export function computeCameraPose(
  feet: Vec3,
  basis: SurfaceBasis,
  easedUp: Vec3,
  rollUp: Vec3,
  pitch: number,
  boxes: readonly Aabb[],
  cfg: CameraRigConfig = DEFAULT_RIG,
): CameraPose {
  const u = normalize(easedUp);
  let f = sub(basis.forward, scale(u, dot(basis.forward, u)));
  if (length(f) < 1e-3) f = sub(basis.up, scale(u, dot(basis.up, u))); // forward parallel to eased up mid-flip
  f = normalize(f, basis.forward);
  const target = add(feet, scale(u, cfg.lookHeight));
  const p = Math.max(-1.0, Math.min(1.0, pitch));
  const back = add(scale(f, -Math.cos(p) * cfg.distance), scale(u, cfg.height + Math.sin(-p) * cfg.distance * 0.6));
  const desired = add(target, back);
  const { position, pulledIn } = pullIn(target, desired, boxes, cfg);
  return { position, target, up: safeUp(sub(target, position), rollUp, f), pulledIn };
}

/** lookAt degenerates when the view direction is parallel to up; fall back to `alt`. */
export function safeUp(viewDir: Vec3, desiredUp: Vec3, alt: Vec3): V3 {
  const d = normalize(viewDir);
  const u = normalize(desiredUp);
  if (Math.abs(dot(d, u)) < 0.985) return u;
  const side = cross(d, alt);
  return normalize(cross(side, d), u);
}
