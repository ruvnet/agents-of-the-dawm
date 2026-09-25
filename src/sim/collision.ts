/**
 * Continuous axis-separated swept AABB collision. Each world axis is swept exactly (face to face),
 * so no displacement can ever cross a collider, whatever its thickness or the speed (no tunnelling).
 * Overlap tests are strict: touching faces do not count as penetration.
 */
import type { LevelManifest } from '../contracts/manifest';
import type { SimState } from '../contracts/sim';
import type { MutBox, V3 } from './frame';
import { v3 } from './frame';

export const EPS = 1e-6;

export function overlaps(a: MutBox, b: MutBox, eps = EPS): boolean {
  for (let i = 0; i < 3; i++) {
    if (!(a.min[i]! < b.max[i]! - eps && a.max[i]! > b.min[i]! + eps)) return false;
  }
  return true;
}

function overlapOnOthers(a: MutBox, b: MutBox, axis: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (i === axis) continue;
    if (!(a.min[i]! < b.max[i]! - EPS && a.max[i]! > b.min[i]! + EPS)) return false;
  }
  return true;
}

/**
 * Largest signed travel <= |d| along `axis` before `body` meets a collider face.
 * Colliders already overlapping the body (e.g. a dynamic that moved into it) are ignored so the
 * player can always walk out; they never pull the body through a wall.
 */
export function sweepAxis(body: MutBox, axis: number, d: number, colliders: readonly MutBox[]): number {
  if (d === 0) return 0;
  let allowed = d;
  for (const c of colliders) {
    if (!overlapOnOthers(body, c, axis)) continue;
    if (d > 0) {
      if (c.min[axis]! >= body.max[axis]! - EPS) allowed = Math.min(allowed, Math.max(0, c.min[axis]! - body.max[axis]!));
    } else if (c.max[axis]! <= body.min[axis]! + EPS) {
      allowed = Math.max(allowed, Math.min(0, c.max[axis]! - body.min[axis]!));
    }
  }
  return allowed;
}

/**
 * Exact test: does a cube of half extent `half` moving in a straight line from p0 to p1 enter
 * the interior of `box`? (Segment vs box expanded by the cube, slab method.)
 */
export function sweptCubeHits(p0: V3, p1: V3, half: number, box: MutBox): boolean {
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    const lo = box.min[i]! - half + EPS;
    const hi = box.max[i]! + half - EPS;
    const d = p1[i]! - p0[i]!;
    if (Math.abs(d) < 1e-12) {
      if (p0[i]! <= lo || p0[i]! >= hi) return false;
      continue;
    }
    let t1 = (lo - p0[i]!) / d;
    let t2 = (hi - p0[i]!) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin >= tmax) return false;
  }
  return tmin < tmax;
}

export function boxOf(b: { min: readonly number[]; max: readonly number[] }): MutBox {
  return { min: [b.min[0]!, b.min[1]!, b.min[2]!], max: [b.max[0]!, b.max[1]!, b.max[2]!] };
}

export function translate(b: MutBox, o: readonly number[]): MutBox {
  return {
    min: [b.min[0] + o[0]!, b.min[1] + o[1]!, b.min[2] + o[2]!],
    max: [b.max[0] + o[0]!, b.max[1] + o[1]!, b.max[2] + o[2]!],
  };
}

/** All colliders at their current positions: static boxes plus dynamic boxes at their live offset. */
export function worldColliders(m: LevelManifest, s: SimState): MutBox[] {
  const out: MutBox[] = [];
  for (const c of m.geometry.colliders) {
    if (c.dynamicKey) {
      const d = s.dynamics.find((x) => x.key === c.dynamicKey);
      out.push(translate(boxOf(c.box), d ? d.offset : [0, 0, 0]));
    } else out.push(boxOf(c.box));
  }
  return out;
}

/** Colliders of one dynamic body translated to a given offset (for shift safety checks). */
export function dynamicCollidersAt(m: LevelManifest, key: string, offset: readonly number[]): MutBox[] {
  return m.geometry.colliders.filter((c) => c.dynamicKey === key).map((c) => translate(boxOf(c.box), offset));
}

export function boxCenter(b: MutBox): V3 {
  return v3([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
}
