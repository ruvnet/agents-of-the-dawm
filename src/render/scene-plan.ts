/**
 * Pure scene-graph plan built from ANY valid GeometryManifest. No three.js and no GL context:
 * the plan has exactly one node per collider / dynamic / anchor / interactable / machine /
 * decor / kill volume, plus the player and the optional atmosphere layer. Materialisation
 * (scene-build.ts) may instance repeated nodes, but instancing never changes the plan counts.
 */
import type { Aabb, Axis, Vec3 } from '../contracts/math';
import type {
  AnchorDef, DecorKind, InteractableKind, LevelManifest, MachineKind, SurfaceMaterial,
} from '../contracts/manifest';
import { boxCenter, boxSize, type V3 } from './vec';

export type PlanCategory =
  | 'collider' | 'dynamic' | 'anchor' | 'interactable' | 'machine' | 'decor' | 'kill-volume' | 'player' | 'optional';

/** critical = required before control (player, anchor, floor, objective); optional = atmosphere. */
export type PlanLayer = 'critical' | 'optional';

export type OptionalKind = 'sky' | 'coast' | 'spray' | 'fog' | 'ribs';

interface NodeBase {
  readonly id: string;
  readonly key: string;
  readonly layer: PlanLayer;
}

export interface ColliderNode extends NodeBase {
  readonly category: 'collider';
  readonly material: SurfaceMaterial;
  readonly center: V3;
  readonly size: V3;
  /** Non-dynamic colliders sharing a material are instanced together. */
  readonly instanceGroup: string | null;
  /** Collider moves with a dynamic body. */
  readonly dynamicKey: string | null;
}

export interface DynamicNode extends NodeBase {
  readonly category: 'dynamic';
  readonly kind: 'gantry' | 'panel';
  readonly center: V3;
  readonly size: V3;
  readonly poses: readonly Vec3[];
  /** Keys of colliders that belong to this body (drawn as part of it). */
  readonly colliderKeys: readonly string[];
}

export interface GlyphPlacement {
  readonly surface: 0 | 1;
  readonly up: Axis;
  readonly glyph: string;
  /** Glyph centre, lifted slightly off the surface plane. */
  readonly pos: V3;
}

export interface AnchorNode extends NodeBase {
  readonly category: 'anchor';
  readonly def: AnchorDef;
  readonly center: V3;
  readonly size: V3;
  readonly glyphs: readonly [GlyphPlacement, GlyphPlacement];
}

export interface InteractableNode extends NodeBase {
  readonly category: 'interactable';
  readonly kind: InteractableKind;
  readonly pos: V3;
  readonly radius: number;
}

export interface MachineNode extends NodeBase {
  readonly category: 'machine';
  readonly kind: MachineKind;
  readonly pos: V3;
  readonly up: Axis;
  readonly size: V3;
}

export interface DecorNode extends NodeBase {
  readonly category: 'decor';
  readonly kind: DecorKind;
  readonly center: V3;
  readonly size: V3;
}

export interface KillVolumeNode extends NodeBase {
  readonly category: 'kill-volume';
  /** Water surface: the top face of the volume, footprint clamped to a sane extent. */
  readonly surfaceY: number;
  readonly footprintCenter: readonly [number, number];
  readonly footprintSize: readonly [number, number];
}

export interface PlayerNode extends NodeBase {
  readonly category: 'player';
  readonly spawn: V3;
  readonly up: Axis;
  readonly yaw: number;
}

export interface OptionalNode extends NodeBase {
  readonly category: 'optional';
  readonly kind: OptionalKind;
}

export type PlanNode =
  | ColliderNode | DynamicNode | AnchorNode | InteractableNode | MachineNode | DecorNode | KillVolumeNode | PlayerNode | OptionalNode;

export interface ScenePlan {
  readonly manifestId: string;
  readonly nodes: readonly PlanNode[];
  readonly bounds: Aabb;
  /** Key of the node that represents the current objective (tram → gate → first interactable). */
  readonly objectiveKey: string | null;
  /** Static collider boxes for camera pull-in (dynamics are added at render time). */
  readonly staticBoxes: readonly Aabb[];
}

export const MACHINE_SIZE: Readonly<Record<MachineKind, V3>> = {
  skimmer: [0.9, 0.7, 0.9],
  hauler: [2.2, 1.8, 3.0],
  keeper: [5.0, 6.0, 3.6],
};

export const MAX_WATER_EXTENT = 3000;
const GLYPH_LIFT = 0.03;

/** Glyph sits on the floor plane of that orientation: the volume face opposite `up`. */
export function glyphPosition(def: AnchorDef, surface: 0 | 1): V3 {
  const s = def.surfaces[surface];
  if (s.landing) {
    const f = s.landing.feet;
    return liftAlong([f[0], f[1], f[2]], s.up, GLYPH_LIFT);
  }
  const c = boxCenter(def.volume);
  const axis = s.up[1] === 'x' ? 0 : s.up[1] === 'y' ? 1 : 2;
  const positive = s.up[0] === '+';
  c[axis] = positive ? def.volume.min[axis]! : def.volume.max[axis]!;
  return liftAlong(c, s.up, GLYPH_LIFT);
}

function liftAlong(p: V3, up: Axis, d: number): V3 {
  const axis = up[1] === 'x' ? 0 : up[1] === 'y' ? 1 : 2;
  const out: V3 = [p[0], p[1], p[2]];
  out[axis] += up[0] === '+' ? d : -d;
  return out;
}

function unionBounds(boxes: readonly Aabb[]): Aabb {
  if (!boxes.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  }
  return { min, max };
}

export function buildScenePlan(manifest: LevelManifest): ScenePlan {
  const g = manifest.geometry;
  const nodes: PlanNode[] = [];
  const materialCounts = new Map<SurfaceMaterial, number>();
  for (const c of g.colliders) if (!c.dynamicKey) materialCounts.set(c.material, (materialCounts.get(c.material) ?? 0) + 1);

  for (const c of g.colliders) {
    const instanced = !c.dynamicKey && (materialCounts.get(c.material) ?? 0) >= 2;
    nodes.push({
      id: `collider:${c.key}`, key: c.key, category: 'collider', layer: 'critical', material: c.material,
      center: boxCenter(c.box), size: boxSize(c.box),
      instanceGroup: instanced ? `collider:${c.material}` : null, dynamicKey: c.dynamicKey ?? null,
    });
  }
  for (const d of g.dynamics) {
    nodes.push({
      id: `dynamic:${d.key}`, key: d.key, category: 'dynamic', layer: 'critical', kind: d.kind,
      center: boxCenter(d.box), size: boxSize(d.box), poses: d.poses,
      colliderKeys: g.colliders.filter((c) => c.dynamicKey === d.key).map((c) => c.key),
    });
  }
  for (const a of g.anchors) {
    nodes.push({
      id: `anchor:${a.key}`, key: a.key, category: 'anchor', layer: 'critical', def: a,
      center: boxCenter(a.volume), size: boxSize(a.volume),
      glyphs: [0, 1].map((i) => {
        const s = a.surfaces[i as 0 | 1];
        return { surface: i as 0 | 1, up: s.up, glyph: s.glyph, pos: glyphPosition(a, i as 0 | 1) };
      }) as unknown as readonly [GlyphPlacement, GlyphPlacement],
    });
  }
  for (const it of g.interactables) {
    nodes.push({ id: `interactable:${it.key}`, key: it.key, category: 'interactable', layer: 'critical', kind: it.kind, pos: [...it.pos] as V3, radius: it.radius });
  }
  for (const m of g.machines) {
    nodes.push({ id: `machine:${m.key}`, key: m.key, category: 'machine', layer: 'critical', kind: m.kind, pos: [...m.pos] as V3, up: m.up, size: MACHINE_SIZE[m.kind] });
  }
  for (const d of g.decor) {
    nodes.push({ id: `decor:${d.key}`, key: d.key, category: 'decor', layer: 'critical', kind: d.kind, center: boxCenter(d.box), size: boxSize(d.box) });
  }
  for (const k of g.killVolumes) {
    const c = boxCenter(k.box);
    const s = boxSize(k.box);
    nodes.push({
      id: `kill:${k.key}`, key: k.key, category: 'kill-volume', layer: 'critical', surfaceY: k.box.max[1],
      footprintCenter: [c[0], c[2]], footprintSize: [Math.min(s[0], MAX_WATER_EXTENT), Math.min(s[2], MAX_WATER_EXTENT)],
    });
  }
  nodes.push({ id: 'player', key: 'player', category: 'player', layer: 'critical', spawn: [...g.spawn.feet] as V3, up: g.spawn.up, yaw: g.spawn.yaw });
  for (const kind of ['sky', 'coast', 'fog', 'spray', 'ribs'] as const) {
    nodes.push({ id: `optional:${kind}`, key: kind, category: 'optional', layer: 'optional', kind });
  }

  const tram = g.decor.find((d) => d.kind === 'tram');
  const gate = g.decor.find((d) => d.kind === 'gate');
  const objectiveKey = tram?.key ?? gate?.key ?? g.interactables[0]?.key ?? null;

  const staticBoxes = g.colliders.filter((c) => !c.dynamicKey).map((c) => c.box);
  return { manifestId: manifest.id, nodes, bounds: unionBounds(g.colliders.map((c) => c.box)), objectiveKey, staticBoxes };
}

export function nodesOf<C extends PlanCategory>(plan: ScenePlan, category: C): Extract<PlanNode, { category: C }>[] {
  return plan.nodes.filter((n): n is Extract<PlanNode, { category: C }> => n.category === category);
}

/** The ADR 0002 control set: the plan has a player, a floor, an anchor (if authored) and an objective. */
export function criticalSetPresent(plan: ScenePlan, manifestHasAnchors: boolean): boolean {
  const has = (c: PlanCategory) => plan.nodes.some((n) => n.category === c && n.layer === 'critical');
  return has('player') && has('collider') && (!manifestHasAnchors || has('anchor')) && plan.objectiveKey !== null;
}
