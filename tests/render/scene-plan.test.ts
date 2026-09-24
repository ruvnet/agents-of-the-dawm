import { describe, expect, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import { buildScenePlan, criticalSetPresent, glyphPosition, nodesOf } from '../../src/render/scene-plan';
import { deepFreeze, richManifest } from './fixtures';

describe('buildScenePlan (pure, no GL context)', () => {
  it('one node per collider / anchor / machine / interactable / decor / kill volume for bundled sector-01', () => {
    const m = deepFreeze(loadSector01());
    const plan = buildScenePlan(m);
    const g = m.geometry;
    expect(nodesOf(plan, 'collider').map((n) => n.key)).toEqual(g.colliders.map((c) => c.key));
    expect(nodesOf(plan, 'anchor').map((n) => n.key)).toEqual(g.anchors.map((a) => a.key));
    expect(nodesOf(plan, 'machine').map((n) => n.key)).toEqual(g.machines.map((x) => x.key));
    expect(nodesOf(plan, 'interactable')).toHaveLength(g.interactables.length);
    expect(nodesOf(plan, 'decor')).toHaveLength(g.decor.length);
    expect(nodesOf(plan, 'kill-volume')).toHaveLength(g.killVolumes.length);
    expect(nodesOf(plan, 'player')).toHaveLength(1);
    expect(new Set(plan.nodes.map((n) => n.id)).size).toBe(plan.nodes.length);
  });

  it('control set (player, floor, anchor, objective) is critical; atmosphere is optional', () => {
    const m = loadSector01();
    const plan = buildScenePlan(m);
    expect(criticalSetPresent(plan, m.geometry.anchors.length > 0)).toBe(true);
    expect(plan.objectiveKey).toBe('tram');
    const optional = plan.nodes.filter((n) => n.layer === 'optional').map((n) => n.key).sort();
    expect(optional).toEqual(['coast', 'fog', 'ribs', 'sky', 'spray']);
    expect(plan.nodes.filter((n) => n.category !== 'optional').every((n) => n.layer === 'critical')).toBe(true);
  });

  it('handles any valid manifest generically (machines, dynamics, extra decor)', () => {
    const m = deepFreeze(richManifest());
    const plan = buildScenePlan(m);
    const g = m.geometry;
    expect(nodesOf(plan, 'collider')).toHaveLength(g.colliders.length);
    expect(nodesOf(plan, 'machine').map((n) => n.kind)).toEqual(['skimmer', 'hauler', 'keeper']);
    const dyn = nodesOf(plan, 'dynamic');
    expect(dyn).toHaveLength(1);
    expect(dyn[0]!.colliderKeys).toEqual(['gantry-floor']);
    const mesh = nodesOf(plan, 'collider').filter((c) => c.material === 'mesh');
    expect(mesh.every((c) => c.instanceGroup === 'collider:mesh')).toBe(true);
    const gantryFloor = nodesOf(plan, 'collider').find((c) => c.key === 'gantry-floor')!;
    expect(gantryFloor.instanceGroup).toBeNull();
    expect(gantryFloor.dynamicKey).toBe('gantry');
    expect(plan.staticBoxes).toHaveLength(g.colliders.length - 1);
  });

  it('places both crescent glyphs: landing feet for player anchors, opposite face otherwise', () => {
    const m = richManifest();
    const a1 = m.geometry.anchors[0]!;
    const floor = glyphPosition(a1, 0);
    expect(floor[0]).toBe(28);
    expect(floor[1]).toBeCloseTo(0.03);
    const wall = glyphPosition(a1, 1); // up = -z, lifted toward -z
    expect(wall[2]).toBeCloseTo(4 - 0.03);
    const gantryAnchor = m.geometry.anchors[1]!;
    expect(glyphPosition(gantryAnchor, 0)[1]).toBeCloseTo(0.03); // volume min y
    const plan = buildScenePlan(m);
    const glyphs = nodesOf(plan, 'anchor').flatMap((a) => a.glyphs);
    expect(glyphs).toHaveLength(4);
  });

  it('water surface footprint is clamped for huge kill volumes', () => {
    const plan = buildScenePlan(loadSector01());
    const sea = nodesOf(plan, 'kill-volume')[0]!;
    expect(sea.surfaceY).toBe(-3);
    expect(sea.footprintSize[0]).toBeLessThanOrEqual(3000);
  });

  it('does not mutate the manifest', () => {
    const m = richManifest();
    const before = JSON.stringify(m);
    buildScenePlan(deepFreeze(m));
    expect(JSON.stringify(m)).toBe(before);
  });
});
