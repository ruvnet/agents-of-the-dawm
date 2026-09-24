import { describe, expect, it } from 'vitest';
import { AXES, validateManifest } from '../../src/contracts';
import type { LevelManifest, WorldEvent } from '../../src/contracts';
import { bodyBox } from '../../src/sim/frame';
import { overlaps, sweepAxis, sweptCubeHits, worldColliders } from '../../src/sim/collision';
import { isGrounded } from '../../src/sim/state';
import { manifest, mutate, newSim, step, idleTicks } from './helpers';

const playerAnchors = manifest.geometry.anchors.filter((a) => a.target === 'player');

describe('G01 anchor transitions', () => {
  it('manifest with authored geometry validates and covers every anchor entity', () => {
    expect(validateManifest(manifest).ok).toBe(true);
    const anchorEntities = manifest.entities.filter((e) => e.key.startsWith('anchor-')).map((e) => e.key).sort();
    expect(manifest.geometry.anchors.map((a) => a.entityKey).sort()).toEqual(anchorEntities);
    for (const a of manifest.geometry.anchors) expect(a.surfaces).toHaveLength(2);
    const rooms = manifest.entities.filter((e) => e.kind === 'room').map((e) => e.key).sort();
    expect(manifest.geometry.zones.map((z) => z.key).sort()).toEqual(rooms);
  });

  it('every landing, spawn and checkpoint pose is collision free and grounded', () => {
    const sim = newSim();
    const cols = worldColliders(manifest, sim.state());
    const poses = [
      manifest.geometry.spawn,
      ...manifest.geometry.checkpoints.map((c) => c.pose),
      ...playerAnchors.flatMap((a) => a.surfaces.map((s) => s.landing!)),
    ];
    for (const pose of poses) {
      const body = bodyBox(pose.feet, pose.up);
      expect(cols.some((c) => overlaps(body, c)), JSON.stringify(pose)).toBe(false);
      const s = structuredClone(sim.state());
      s.player.pos = [...pose.feet];
      s.player.up = pose.up;
      expect(isGrounded(manifest, s), JSON.stringify(pose)).toBe(true);
    }
  });

  for (const a of playerAnchors) {
    for (const from of [0, 1] as const) {
      it(`${a.key}: shift from surface ${from} lands on surface ${1 - from}`, () => {
        const sim = newSim();
        const src = a.surfaces[from].landing!;
        const dst = a.surfaces[1 - from]!.landing!;
        mutate(sim, (s) => { s.player.pos = [...src.feet]; s.player.up = src.up; s.player.yaw = src.yaw; });
        expect(sim.state().player.grounded).toBe(true);
        const ev = step(sim, { shiftAnchorId: a.key });
        expect(ev.map((e) => e.type)).toContain('ShiftCommitted');
        const p = sim.state().player;
        expect(p.up).toBe(dst.up);
        expect(AXES).toContain(p.up);
        expect(p.pos).toEqual(dst.feet);
        expect(p.vel).toEqual([0, 0, 0]);
        expect(p.grounded).toBe(true);
        const body = bodyBox(p.pos, p.up);
        expect(worldColliders(manifest, sim.state()).some((c) => overlaps(body, c))).toBe(false);
        // standing still afterwards stays put (no sinking, no drift)
        idleTicks(sim, 40);
        expect(sim.state().player.pos).toEqual(dst.feet);
        // and back again after cooldown
        const back = step(sim, { shiftAnchorId: a.key });
        expect(back.map((e) => e.type)).toContain('ShiftCommitted');
        expect(sim.state().player.up).toBe(src.up);
      });

      it(`${a.key}: blocked landing from surface ${from} is rejected with state intact`, () => {
        const dst = a.surfaces[1 - from]!.landing!;
        const b = bodyBox(dst.feet, dst.up);
        const blocked: LevelManifest = {
          ...manifest,
          geometry: {
            ...manifest.geometry,
            colliders: [...manifest.geometry.colliders, { key: 'blocker', material: 'metal', box: { min: [b.min[0] + 0.1, b.min[1] + 0.1, b.min[2] + 0.1], max: [b.max[0] - 0.1, b.max[1] - 0.1, b.max[2] - 0.1] } }],
          },
        };
        const sim = newSim(1, blocked);
        const src = a.surfaces[from].landing!;
        mutate(sim, (s) => { s.player.pos = [...src.feet]; s.player.up = src.up; });
        step(sim);
        const before = structuredClone(sim.state());
        const ev = step(sim, { shiftAnchorId: a.key });
        expect(ev.find((e) => e.type === 'ShiftRejected')?.payload.reason).toMatch(/landing-blocked|path-blocked/);
        const after = sim.state();
        expect(after.player).toEqual(before.player);
        expect(after.anchors).toEqual(before.anchors);
      });
    }
  }

  it('shift requested outside every anchor volume is rejected and changes nothing', () => {
    const sim = newSim();
    for (const a of manifest.geometry.anchors) {
      const before = structuredClone(sim.state());
      const ev = step(sim, { shiftAnchorId: a.key });
      expect(ev.find((e) => e.type === 'ShiftRejected')?.payload.reason).toBe('outside-volume');
      expect(sim.state().player).toEqual(before.player);
      expect(sim.state().anchors).toEqual(before.anchors);
    }
    expect(step(sim, { shiftAnchorId: 'no-such-anchor' }).find((e) => e.type === 'ShiftRejected')?.payload.reason).toBe('unknown-anchor');
  });

  it('airborne shifts are rejected', () => {
    const sim = newSim();
    const a = playerAnchors[0]!;
    mutate(sim, (s) => { s.player.pos = [...a.surfaces[0].landing!.feet]; });
    step(sim, { jump: true });
    step(sim);
    expect(sim.state().player.grounded).toBe(false);
    expect(step(sim, { shiftAnchorId: a.key }).find((e) => e.type === 'ShiftRejected')?.payload.reason).toBe('airborne');
  });
});

describe('collision', () => {
  it('swept axis never crosses a thin collider at any speed', () => {
    const body = bodyBox([0, 10, 0], '+y');
    const thin = { min: [-5, 4.99, -5] as [number, number, number], max: [5, 5, 5] as [number, number, number] };
    expect(sweepAxis(body, 1, -1000, [thin])).toBeCloseTo(-5, 9);
    expect(sweptCubeHits([0, 10, 0], [0, 0, 0], 0.3, thin)).toBe(true);
    expect(sweptCubeHits([0, 10, 0], [20, 10, 0], 0.3, thin)).toBe(false);
  });

  it('walking into the inspection wall stops at its face', () => {
    const sim = newSim();
    mutate(sim, (s) => { s.player.pos = [28, 0, 2]; });
    for (let i = 0; i < 120; i++) step(sim, { move2: [1, 0] }); // yaw 0 on +y: right = +z
    const p = sim.state().player;
    expect(p.pos[2]).toBeCloseTo(3.7, 6);
    expect(p.grounded).toBe(true);
  });

  it('a long fall lands on the thin gantry deck instead of tunnelling', () => {
    const sim = newSim();
    mutate(sim, (s) => {
      const g = s.dynamics.find((d) => d.key === 'gantry')!;
      g.pose = 1; g.offset = [0, 0, 0];
      s.player.pos = [56, 58, 5.5];
    });
    idleTicks(sim, 400);
    const p = sim.state().player;
    expect(p.pos[1]).toBeCloseTo(14, 6);
    expect(p.grounded).toBe(true);
  });
});

describe('falls', () => {
  it('walking off the barrier into the sea respawns at the checkpoint with bounded damage', () => {
    const sim = newSim();
    mutate(sim, (s) => { s.player.pos = [33, 0, 0]; });
    const events: WorldEvent[] = [];
    for (let i = 0; i < 200 && !events.some((e) => e.type === 'PlayerFell'); i++) events.push(...step(sim, { move2: [0, 1] }));
    const fell = events.find((e) => e.type === 'PlayerFell');
    expect(fell?.key).toBe('sea');
    const p = sim.state().player;
    expect(p.pos).toEqual(manifest.geometry.spawn.feet);
    expect(p.health).toBe(80);
    expect(events.map((e) => e.type)).toContain('PlayerRespawned');
  });
});
