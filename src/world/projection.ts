/**
 * Authored static projection of the level manifest into WorldGraph commands (ADR 0003).
 * Stable IDs come only from the manifest. Scene coordinates map to ENU via the contract's sceneToGraph.
 *
 * Placement is deterministic and labelled per entity:
 *   'authored'  — position/footprint taken directly from manifest geometry for that entity key;
 *   'room-zone' — object anchor placed at its containing room's authored zone centre (confidence 0.5);
 *   'unplaced'  — no authored geometry yet: degenerate footprint / ENU origin (anchors confidence 0).
 * Unplaced entities are a starter-geometry gap (see CONTRACT_PROPOSALS.md), never a claimed location.
 */
import { sceneToGraph, type Aabb, type EntityDef, type LevelManifest, type Vec3 } from '../contracts';
import type { BoundsEnu, Enu, TwinCommand, WgEdge, WgNode } from './commands';

export type Placement = 'authored' | 'room-zone' | 'unplaced';

export interface StaticProjection {
  readonly commands: readonly TwinCommand[];
  readonly placements: Readonly<Record<string, Placement>>;
  readonly idByKey: ReadonlyMap<string, number>;
}

const ORIGIN: Enu = { east_m: 0, north_m: 0, up_m: 0 };
const toEnu = (v: Vec3): Enu => ({ ...sceneToGraph(v) });
const centre = (b: Aabb): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

/** 2D ENU footprint of a scene-space Aabb. north = -z, so the z extremes swap. */
export function footprintOf(box: Aabb): BoundsEnu {
  return { shape: 'rectangle', min_e: box.min[0], max_e: box.max[0], min_n: -box.max[2], max_n: -box.min[2] };
}

function intersect(a: Aabb, b: Aabb): Aabb | null {
  const min: Vec3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const max: Vec3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  return min.every((v, i) => v <= max[i]!) ? { min, max } : null;
}

interface Ctx {
  readonly m: LevelManifest;
  readonly zoneBox: Map<string, Aabb>;
  readonly placements: Record<string, Placement>;
}

function anchorPosition(ctx: Ctx, e: EntityDef): { pos: Enu; confidence: number } {
  const g = ctx.m.geometry;
  const inter = g.interactables.find((i) => i.entityKey === e.key || i.key === e.key);
  const anchor = g.anchors.find((a) => a.entityKey === e.key || a.key === e.key);
  const decor = g.decor.find((d) => d.key === e.key);
  const dyn = g.dynamics.find((d) => d.key === e.key);
  const machine = g.machines.find((d) => d.key === e.key);
  const authored: Vec3 | undefined = inter?.pos ?? (anchor && centre(anchor.volume)) ??
    (decor && centre(decor.box)) ?? (dyn && centre(dyn.box)) ?? machine?.pos;
  if (authored) { ctx.placements[e.key] = 'authored'; return { pos: toEnu(authored), confidence: 1 }; }
  const room = e.roomKey ? ctx.zoneBox.get(e.roomKey) : undefined;
  if (room) { ctx.placements[e.key] = 'room-zone'; return { pos: toEnu(centre(room)), confidence: 0.5 }; }
  ctx.placements[e.key] = 'unplaced';
  return { pos: ORIGIN, confidence: 0 };
}

function doorwayGeometry(ctx: Ctx, e: EntityDef): { center: Enu; width_m: number } {
  const [from, to] = e.key.replace(/^door-/, '').split('--');
  const a = from ? ctx.zoneBox.get(from) : undefined;
  const b = to ? ctx.zoneBox.get(to) : undefined;
  const shared = a && b ? intersect(a, b) : null;
  if (shared) {
    ctx.placements[e.key] = 'authored';
    const width = Math.max(shared.max[0] - shared.min[0], shared.max[2] - shared.min[2]);
    return { center: toEnu([(shared.min[0] + shared.max[0]) / 2, shared.min[1], (shared.min[2] + shared.max[2]) / 2]), width_m: width };
  }
  ctx.placements[e.key] = 'unplaced';
  return { center: ORIGIN, width_m: 0 };
}

function wallSegment(ctx: Ctx, e: EntityDef): { a: Enu; b: Enu } {
  const collider = ctx.m.geometry.colliders.find((c) => c.key === e.key || c.key === e.key.replace(/-face$/, ''));
  if (!collider) { ctx.placements[e.key] = 'unplaced'; return { a: ORIGIN, b: ORIGIN }; }
  ctx.placements[e.key] = 'authored';
  const { min, max } = collider.box;
  const alongX = max[0] - min[0] >= max[2] - min[2];
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;
  return alongX
    ? { a: toEnu([min[0], min[1], midZ]), b: toEnu([max[0], min[1], midZ]) }
    : { a: toEnu([midX, min[1], min[2]]), b: toEnu([midX, min[1], max[2]]) };
}

function nodeFor(ctx: Ctx, e: EntityDef, idByKey: ReadonlyMap<string, number>): WgNode {
  const box = ctx.zoneBox.get(e.key);
  const bounds: BoundsEnu = box ? footprintOf(box) : { shape: 'polygon', vertices: [] };
  switch (e.kind) {
    case 'room':
      ctx.placements[e.key] = box ? 'authored' : 'unplaced';
      return { kind: 'room', id: e.id, area_id: `${ctx.m.id}:${e.key}`, name: e.label, bounds_enu: bounds, floor: 0 };
    case 'zone': {
      const parent = e.roomKey ? idByKey.get(e.roomKey) : undefined;
      const parentDef = ctx.m.entities.find((x) => x.key === e.roomKey);
      if (parent === undefined || parentDef?.kind !== 'room') throw new Error(`zone ${e.key} needs a room roomKey`);
      ctx.placements[e.key] = box ? 'authored' : 'unplaced';
      return { kind: 'zone', id: e.id, parent_room: parent, name: e.label, bounds_enu: bounds };
    }
    case 'doorway':
      return { kind: 'doorway', id: e.id, ...doorwayGeometry(ctx, e) };
    case 'wall':
      // rf_attenuation_db is an RF concept with no meaning in this fictional scene: 0 = not modelled.
      return { kind: 'wall', id: e.id, ...wallSegment(ctx, e), rf_attenuation_db: 0 };
    case 'object_anchor': {
      const { pos, confidence } = anchorPosition(ctx, e);
      // WorldGraph AnchorKind is closed (reflector|furniture|uwb_beacon); authored anchors use 'reflector' as RuLab does.
      return { kind: 'object_anchor', id: e.id, position: pos, anchor_kind: 'reflector', confidence };
    }
    default:
      throw new Error(`entity ${(e as EntityDef).key}: kind ${String((e as EntityDef).kind)} not projectable`);
  }
}

/** Build the ordered static projection: all nodes (manifest order), then manifest semantic edges. */
export function buildStaticProjection(m: LevelManifest): StaticProjection {
  const zoneBox = new Map<string, Aabb>(m.geometry.zones.map((z) => [z.key, z.box]));
  const placements: Record<string, Placement> = {};
  const ctx: Ctx = { m, zoneBox, placements };
  const idByKey = new Map<string, number>(m.entities.map((e) => [e.key, e.id]));
  const commands: TwinCommand[] = m.entities.map((e) => ({ op: 'upsert_node', node: nodeFor(ctx, e, idByKey) }));
  const epoch = m.provenance.syntheticEpochMs;
  for (const se of m.semanticEdges) {
    const from = idByKey.get(se.from);
    const to = idByKey.get(se.to);
    if (from === undefined || to === undefined) throw new Error(`edge ${se.id}: unknown endpoint`);
    let edge: WgEdge;
    if (se.rel === 'located_in') edge = { rel: 'located_in', since_unix_ms: epoch };
    else if (se.rel === 'adjacent_to') {
      const via = idByKey.get(`door-${se.from}--${se.to}`) ?? idByKey.get(`door-${se.to}--${se.from}`);
      if (via === undefined) throw new Error(`adjacent_to edge ${se.id}: no authored doorway door-${se.from}--${se.to}`);
      edge = { rel: 'adjacent_to', via_doorway: via };
    } else if (se.rel === 'derived_from') edge = { rel: 'derived_from', evidence: m.provenance.source };
    else throw new Error(`edge ${se.id}: rel ${String(se.rel)} not allowed`);
    commands.push({ op: 'upsert_edge', id: se.id, from, to, edge });
  }
  return { commands, placements, idByKey };
}
