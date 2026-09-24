import { describe, expect, it } from 'vitest';
import {
  CameraUpEaser, computeCameraPose, easeInOut, pullIn, rayAabb, safeUp, SHIFT_EASE_MS,
} from '../../src/render/camera';
import { surfaceBasis } from '../../src/render/interpolate';
import { dot, length, sub } from '../../src/render/vec';

const on = { noRoll: false, reducedMotion: false };

describe('CameraUpEaser', () => {
  it('eases from the old up to the new up over ~0.65 s', () => {
    expect(SHIFT_EASE_MS).toBe(650);
    const e = new CameraUpEaser();
    e.reset([0, 1, 0]);
    e.begin([0, 0, -1], 1000);
    const start = e.localUp(1000, on);
    expect(start[1]).toBeCloseTo(1);
    const mid = e.localUp(1325, on);
    expect(length(mid)).toBeCloseTo(1);
    expect(dot(mid, [0, 1, 0])).toBeCloseTo(Math.SQRT1_2, 5); // halfway angle (smoothstep(0.5)=0.5)
    const end = e.localUp(1650, on);
    expect(end[2]).toBeCloseTo(-1);
    expect(e.isEasing(1600)).toBe(true);
    expect(e.isEasing(1650)).toBe(false);
    let last = -1;
    for (let t = 1000; t <= 1650; t += 25) {
      const d = dot(e.localUp(t, on), [0, 0, -1]);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
  });

  it('reducedMotion adopts the target immediately (no easing)', () => {
    const e = new CameraUpEaser();
    e.reset([0, 1, 0]);
    e.begin([1, 0, 0], 0);
    expect(e.localUp(1, { reducedMotion: true })).toEqual([1, 0, 0]);
    expect(e.cameraUp(1, { noRoll: false, reducedMotion: true })).toEqual([1, 0, 0]);
  });

  it('noRoll keeps the horizon level (camera up is always world +y)', () => {
    const e = new CameraUpEaser();
    e.reset([0, 1, 0]);
    e.begin([0, 0, -1], 0);
    for (const t of [0, 100, 325, 650, 2000]) {
      expect(e.cameraUp(t, { noRoll: true, reducedMotion: false })).toEqual([0, 1, 0]);
      expect(e.cameraUp(t, { noRoll: true, reducedMotion: true })).toEqual([0, 1, 0]);
    }
    // camera still repositions into the new frame
    expect(e.localUp(650, on)[2]).toBeCloseTo(-1);
  });

  it('antipodal flips rotate through the hint plane and stay unit length', () => {
    const e = new CameraUpEaser();
    e.reset([0, 1, 0]);
    e.begin([0, -1, 0], 0, [1, 0, 0]);
    const mid = e.localUp(325, on);
    expect(length(mid)).toBeCloseTo(1);
    expect(Math.abs(mid[0])).toBeCloseTo(1, 3); // passes through ±x
    expect(e.localUp(650, on)[1]).toBeCloseTo(-1);
  });

  it('easeInOut is clamped smoothstep', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('camera boom', () => {
  const wall = { min: [-10, -1, 3] as const, max: [10, 10, 4] as const };

  it('rayAabb hits the near face, ignores misses', () => {
    expect(rayAabb([0, 1, 0], [0, 0, 1], wall, 100)).toBeCloseTo(3);
    expect(rayAabb([0, 1, 0], [0, 0, -1], wall, 100)).toBeNull();
    expect(rayAabb([0, 1, 0], [0, 0, 1], wall, 2)).toBeNull();
  });

  it('pulls the camera in front of a collider on the boom', () => {
    const r = pullIn([0, 1, 0], [0, 1, 6], [wall]);
    expect(r.pulledIn).toBe(true);
    expect(r.position[2]).toBeLessThan(3);
    expect(r.position[2]).toBeGreaterThan(0);
    expect(pullIn([0, 1, 0], [0, 1, -6], [wall]).pulledIn).toBe(false);
  });

  it('places the camera behind and above the player in its local frame', () => {
    const b = surfaceBasis('+y', 0); // facing +x
    const cp = computeCameraPose([2, 0, 0], b, b.up, b.up, 0, []);
    expect(cp.position[0]).toBeLessThan(2);
    expect(cp.position[1]).toBeGreaterThan(1);
    expect(dot(sub(cp.target, cp.position), b.forward)).toBeGreaterThan(0);
    expect(cp.up).toEqual([0, 1, 0]);
  });

  it('on a wall (up -z) the camera sits off the wall surface, behind along -forward', () => {
    const b = surfaceBasis('-z', 0); // forward +y (up the wall)
    const cp = computeCameraPose([28, 1.5, 4], b, b.up, b.up, 0, []);
    expect(cp.position[2]).toBeLessThan(4); // lifted off the wall toward -z
    expect(cp.position[1]).toBeLessThan(1.5 + 1e-6);
  });

  it('safeUp avoids a degenerate lookAt', () => {
    const u = safeUp([0, 1, 0], [0, 1, 0], [0, 0, 1]);
    expect(Math.abs(dot(u, [0, 1, 0]))).toBeLessThan(0.5);
    expect(length(u)).toBeCloseTo(1);
    expect(safeUp([1, 0, 0], [0, 1, 0], [0, 0, 1])).toEqual([0, 1, 0]);
  });
});
