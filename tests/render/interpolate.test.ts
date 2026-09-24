import { describe, expect, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import { AXES } from '../../src/contracts/math';
import {
  interpolateDynamics, interpolateMachines, interpolatePlayer, lerpAngle, playerShouldSnap, surfaceBasis,
} from '../../src/render/interpolate';
import { cross, dot, length } from '../../src/render/vec';
import { deepFreeze, ev, makeState, richManifest } from './fixtures';

const m = loadSector01();

describe('surfaceBasis (proposed yaw convention)', () => {
  it('is orthonormal and right-handed on every axis and yaw', () => {
    for (const up of AXES) {
      for (const yaw of [0, 0.7, -2.1, Math.PI]) {
        const b = surfaceBasis(up, yaw);
        expect(length(b.forward)).toBeCloseTo(1);
        expect(length(b.right)).toBeCloseTo(1);
        expect(dot(b.forward, b.up)).toBeCloseTo(0);
        expect(dot(b.right, b.up)).toBeCloseTo(0);
        const r = cross(b.forward, b.up);
        expect(r[0]).toBeCloseTo(b.right[0]);
        expect(r[1]).toBeCloseTo(b.right[1]);
        expect(r[2]).toBeCloseTo(b.right[2]);
      }
    }
  });

  it('spawn (+y, yaw 0) faces +x with the inspection wall (+z) on the right', () => {
    const b = surfaceBasis('+y', 0);
    expect(b.forward.map((x) => Math.round(x))).toEqual([1, 0, 0]);
    expect(b.right.map((x) => Math.round(x))).toEqual([0, 0, 1]);
    expect(surfaceBasis('-z', 0).forward.map((x) => Math.round(x))).toEqual([0, 1, 0]);
    expect(surfaceBasis('+y', Math.PI / 2).forward.map((x) => Math.round(x))).toEqual([0, 0, -1]); // +yaw turns left
  });
});

describe('interpolation', () => {
  it('lerps position and shortest-arc yaw between committed states', () => {
    const prev = deepFreeze(makeState(m));
    const curr = deepFreeze(makeState(m, { tick: 1, player: { ...prev.player, pos: [4, 0, 0], yaw: 0.2 } }));
    const p = interpolatePlayer(prev, curr, 0.5, []);
    expect(p.pos).toEqual([3, 0, 0]);
    expect(p.yaw).toBeCloseTo(0.1);
    expect(p.snapped).toBe(false);
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 5); // wraps through ±π, not through 0
  });

  it('clamps alpha to [0,1]', () => {
    const prev = makeState(m);
    const curr = makeState(m, { player: { ...prev.player, pos: [4, 0, 0] } });
    expect(interpolatePlayer(prev, curr, 7, []).pos).toEqual([4, 0, 0]);
    expect(interpolatePlayer(prev, curr, -1, []).pos).toEqual([2, 0, 0]);
  });

  it('snaps on gravity change, shift, respawn and fall instead of smearing', () => {
    const prev = makeState(m);
    const moved = { ...prev.player, pos: [28, 1.5, 4] as const };
    const shifted = makeState(m, { player: { ...moved, up: '-z' } });
    expect(playerShouldSnap(prev, shifted, [])).toBe(true);
    const p = interpolatePlayer(prev, shifted, 0.25, []);
    expect(p.pos).toEqual([28, 1.5, 4]);
    expect(p.up).toBe('-z');
    const same = makeState(m, { player: moved });
    for (const t of ['ShiftCommitted', 'PlayerRespawned', 'PlayerFell'] as const) {
      expect(interpolatePlayer(prev, same, 0.25, [ev(t, 1)]).snapped).toBe(true);
    }
    expect(interpolatePlayer(prev, same, 0.25, [ev('ToolPulse', 1)]).snapped).toBe(false);
  });

  it('interpolates machines and dynamics by key without mutating frozen state', () => {
    const rm = richManifest();
    const prev = makeState(rm);
    const curr = makeState(rm, {
      machines: prev.machines.map((x) => (x.key === 'skimmer-1' ? { ...x, pos: [42, 0, 0] } : x)),
      dynamics: prev.dynamics.map((d) => ({ ...d, offset: [0, -4, 0] })),
    });
    deepFreeze(prev);
    deepFreeze(curr);
    const before = JSON.stringify([prev, curr]);
    const ms = interpolateMachines(prev, curr, 0.5);
    expect(ms.find((x) => x.key === 'skimmer-1')!.pos).toEqual([41, 0, 0]);
    expect(ms.find((x) => x.key === 'hauler-1')!.visible).toBe(false); // branch machine inactive
    expect(interpolateDynamics(prev, curr, 0.25).get('gantry')).toEqual([0, -1, 0]);
    interpolatePlayer(prev, curr, 0.5, []);
    expect(JSON.stringify([prev, curr])).toBe(before);
  });

  it('does not lerp a machine that just activated (spawn is a teleport)', () => {
    const rm = richManifest();
    const prev = makeState(rm);
    const curr = makeState(rm, { machines: prev.machines.map((x) => (x.key === 'hauler-1' ? { ...x, active: true, pos: [130, 0, 0] } : x)) });
    expect(interpolateMachines(prev, curr, 0.1).find((x) => x.key === 'hauler-1')!.pos).toEqual([130, 0, 0]);
  });
});
