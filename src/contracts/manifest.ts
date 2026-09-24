import type { Aabb, Axis, Vec3 } from './math';
import { AXES } from './math';
import type { Destination, PreviewFixture, PressureRoute } from './pressure';
import { DESTINATIONS } from './pressure';

export type BeatId =
  | 'west-approach' | 'inspection-wall' | 'maintenance-deck' | 'floating-gantry'
  | 'junction' | 'upper-lattice' | 'lower-conduit' | 'keeper-arena' | 'control-room';
export const BEATS: readonly BeatId[] = [
  'west-approach', 'inspection-wall', 'maintenance-deck', 'floating-gantry',
  'junction', 'upper-lattice', 'lower-conduit', 'keeper-arena', 'control-room',
];

/** Semantic entity kinds projected into WorldGraph (ADR 0003 table). */
export type SemanticKind = 'room' | 'zone' | 'doorway' | 'wall' | 'object_anchor';
export type SemanticRel = 'located_in' | 'adjacent_to' | 'derived_from';

export const ID_RANGES = {
  static: [1, 9_999],
  derived: [10_000, 19_999],
  edges: [20_000, 29_999],
} as const;

export interface EntityDef {
  /** Stable authored WorldGraph ID in ID_RANGES.static. Never derived from array order. */
  readonly id: number;
  readonly key: string;
  readonly kind: SemanticKind;
  readonly label: string;
  /** Room key this entity is located in (for located_in edges). Rooms omit it. */
  readonly roomKey?: string;
}

export interface SemanticEdgeDef {
  readonly id: number;          // ID_RANGES.edges
  readonly from: string;        // entity key
  readonly to: string;          // entity key
  readonly rel: SemanticRel;
}

/** Derived semantic_state IDs reserved per story event (ID_RANGES.derived). */
export interface DerivedStateDef {
  readonly id: number;
  readonly key: 'channel-located' | 'sensor-verified' | 'edge-restored' | 'transfer-authorized' | 'gate-opened';
  readonly subjectKey: string;  // entity key the state is derived_from
  readonly edgeId: number;      // reserved derived_from edge ID
  readonly statement: string;
}

export interface ManifestProvenance {
  readonly source: string;              // ruv://agents-of-the-dawm/level/sector-01/manifest-v1
  readonly modelVersion: string;        // authored simulation schema
  readonly calibrationVersion: 'fictional-scene-enu-v1';
  readonly privacyDecision: 'synthetic:no-personal-data';
  /** Deterministic synthetic epoch; simulated tick t maps to epoch + t*1000/60. Never wall clock. */
  readonly syntheticEpochMs: number;
}

export interface PressureNodeDef {
  readonly key: 'reservoir' | 'protected-pump' | 'locked-gate' | 'tram' | 'occupied-street' | 'relief-channel';
  readonly label: string;
  readonly entityKey: string;
}

export interface PressureManifest {
  readonly fixtureId: string;
  readonly unit: 'kPa';
  readonly nodes: readonly PressureNodeDef[];
  /** Initial routes. reservoir-to-relief MUST start physicalPipePresent=true, approved=false. */
  readonly routes: readonly PressureRoute[];
  readonly previews: readonly PreviewFixture[];
  /** Localised reason copy keyed by reasonKey (English master). */
  readonly reasons: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- geometry (owned by W1 data file)

export type SurfaceMaterial = 'ceramic' | 'mesh' | 'metal' | 'concrete' | 'glass';

export interface ColliderDef {
  readonly key: string;
  readonly box: Aabb;
  readonly material: SurfaceMaterial;
  /** Optional: this collider belongs to a dynamic body and moves with it (see DynamicDef). */
  readonly dynamicKey?: string;
}

export interface LandingPose {
  readonly up: Axis;
  /** Player feet point when standing on this surface. */
  readonly feet: Vec3;
  readonly yaw: number;
}

export interface AnchorSurface {
  readonly up: Axis;
  readonly glyph: string;         // e.g. 'crescent-floor', 'crescent-wall'
  /** Player landing pose; required when target === 'player'. */
  readonly landing?: LandingPose;
  /** Dynamic body pose index for non-player targets. */
  readonly dynamicPose?: number;
}

export type AnchorTarget = 'player' | 'gantry' | 'panel' | 'keeper' | 'hauler';

export interface AnchorDef {
  readonly key: string;
  readonly entityKey: string;
  /** Player must stand inside this volume to shift. */
  readonly volume: Aabb;
  readonly surfaces: readonly [AnchorSurface, AnchorSurface];
  readonly initial: 0 | 1;
  readonly target: AnchorTarget;
  /** For non-player targets: the dynamic body or machine key moved by the shift. */
  readonly targetKey?: string;
  readonly beat: BeatId;
}

export interface ZoneDef {
  readonly key: string;           // matches a room entity key
  readonly beat: BeatId;
  readonly box: Aabb;             // 3D trigger; WorldGraph gets its 2D ENU footprint
}

export interface CheckpointDef {
  readonly key: string;
  readonly beat: BeatId;
  readonly trigger: Aabb;
  readonly pose: LandingPose;
}

export type InteractableKind =
  | 'pressure-map' | 'channel-marker' | 'valve' | 'control-screen' | 'charge-cell' | 'overdrive-cell';

export interface InteractableDef {
  readonly key: string;
  readonly kind: InteractableKind;
  readonly pos: Vec3;
  readonly radius: number;
  readonly entityKey?: string;
}

export type MachineKind = 'skimmer' | 'hauler' | 'keeper';

export interface MachineDef {
  readonly key: string;
  readonly kind: MachineKind;
  readonly pos: Vec3;
  readonly up: Axis;
  readonly beat: BeatId;
  /** Starts dormant until the player acts or enters its wake radius. */
  readonly dormant: boolean;
  readonly patrol?: readonly Vec3[];
  /** Route-specific machines only spawn when that branch is chosen. */
  readonly branch?: 'upper' | 'lower';
}

export interface DynamicDef {
  readonly key: string;
  readonly kind: 'gantry' | 'panel';
  /** Box at pose 0; poses are translations applied to it. */
  readonly box: Aabb;
  readonly poses: readonly Vec3[];
  readonly initialPose: number;
}

export type TriggerEvent = 'enter-junction' | 'choose-upper' | 'choose-lower' | 'route-midpoint' | 'converge' | 'enter-arena';

export interface TriggerDef {
  readonly key: string;
  readonly box: Aabb;
  readonly event: TriggerEvent;
}

export type DecorKind = 'tram' | 'gate' | 'sea' | 'pump' | 'reservoir' | 'relief-channel' | 'street' | 'pipe' | 'sign' | 'rail';

export interface DecorDef {
  readonly key: string;
  readonly kind: DecorKind;
  readonly box: Aabb;
}

export interface GeometryManifest {
  readonly version: 1;
  readonly spawn: LandingPose;
  readonly colliders: readonly ColliderDef[];
  /** Water or void. Entering one = fall: return to checkpoint with bounded damage. */
  readonly killVolumes: readonly { key: string; box: Aabb }[];
  readonly zones: readonly ZoneDef[];
  readonly anchors: readonly AnchorDef[];
  readonly checkpoints: readonly CheckpointDef[];
  readonly interactables: readonly InteractableDef[];
  readonly machines: readonly MachineDef[];
  readonly dynamics: readonly DynamicDef[];
  readonly triggers: readonly TriggerDef[];
  readonly decor: readonly DecorDef[];
}

export interface LevelManifest {
  readonly version: 1;
  readonly id: string;
  readonly provenance: ManifestProvenance;
  readonly entities: readonly EntityDef[];
  readonly semanticEdges: readonly SemanticEdgeDef[];
  readonly derivedStates: readonly DerivedStateDef[];
  readonly pressure: PressureManifest;
  readonly geometry: GeometryManifest;
}

// ---------------------------------------------------------------- validation (untrusted input)

export const MANIFEST_LIMITS = {
  maxBytes: 512 * 1024,
  maxEntities: 400,
  maxEdges: 600,
  maxColliders: 800,
  maxAbsCoord: 10_000,
} as const;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function checkVec(v: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) {
    errors.push(`${path}: expected finite Vec3`);
    return;
  }
  if (v.some((n) => Math.abs(n) > MANIFEST_LIMITS.maxAbsCoord)) errors.push(`${path}: coordinate out of range`);
}

function checkBox(b: unknown, path: string, errors: string[]): void {
  if (!isObj(b)) { errors.push(`${path}: expected Aabb`); return; }
  checkVec(b.min, `${path}.min`, errors);
  checkVec(b.max, `${path}.max`, errors);
  if (Array.isArray(b.min) && Array.isArray(b.max)) {
    for (let i = 0; i < 3; i++) {
      if ((b.min as number[])[i]! > (b.max as number[])[i]!) errors.push(`${path}: min > max on axis ${i}`);
    }
  }
}

function checkId(id: unknown, range: readonly [number, number], path: string, errors: string[]): void {
  if (!Number.isSafeInteger(id) || (id as number) < 1 || (id as number) > Number.MAX_SAFE_INTEGER) {
    errors.push(`${path}: id must be a safe positive integer`);
    return;
  }
  if ((id as number) < range[0] || (id as number) > range[1]) errors.push(`${path}: id ${id} outside range ${range[0]}..${range[1]}`);
}

/**
 * Validates an untrusted manifest (ADR 0003: version, shape, byte count, finite coordinates,
 * allowed kinds, ID ranges, maximum counts, provenance, pressure fixture invariants).
 */
export function validateManifest(input: unknown, byteLength?: number): ValidationResult<LevelManifest> {
  const errors: string[] = [];
  if (byteLength !== undefined && byteLength > MANIFEST_LIMITS.maxBytes) errors.push(`manifest exceeds ${MANIFEST_LIMITS.maxBytes} bytes`);
  if (!isObj(input)) return { ok: false, errors: ['manifest must be an object'] };
  if (input.version !== 1) errors.push(`unsupported manifest version ${String(input.version)}`);
  if (typeof input.id !== 'string' || !input.id) errors.push('id missing');

  const prov = input.provenance;
  if (!isObj(prov)) errors.push('provenance missing');
  else {
    for (const k of ['source', 'modelVersion', 'calibrationVersion', 'privacyDecision'] as const) {
      if (typeof prov[k] !== 'string' || !(prov[k] as string)) errors.push(`provenance.${k} missing`);
    }
    if (prov.calibrationVersion !== 'fictional-scene-enu-v1') errors.push('provenance.calibrationVersion must be fictional-scene-enu-v1');
    if (prov.privacyDecision !== 'synthetic:no-personal-data') errors.push('provenance.privacyDecision must be synthetic:no-personal-data');
    if (!Number.isSafeInteger(prov.syntheticEpochMs)) errors.push('provenance.syntheticEpochMs must be a safe integer');
  }

  const allIds = new Set<number>();
  const keys = new Set<string>();
  const kinds: readonly SemanticKind[] = ['room', 'zone', 'doorway', 'wall', 'object_anchor'];
  const entities = Array.isArray(input.entities) ? input.entities : (errors.push('entities must be an array'), []);
  if (entities.length > MANIFEST_LIMITS.maxEntities) errors.push('too many entities');
  entities.forEach((e: unknown, i: number) => {
    const p = `entities[${i}]`;
    if (!isObj(e)) { errors.push(`${p}: not an object`); return; }
    checkId(e.id, ID_RANGES.static, p, errors);
    if (allIds.has(e.id as number)) errors.push(`${p}: duplicate id ${String(e.id)}`);
    allIds.add(e.id as number);
    if (typeof e.key !== 'string' || !e.key) errors.push(`${p}: key missing`);
    else if (keys.has(e.key)) errors.push(`${p}: duplicate key ${e.key}`);
    else keys.add(e.key);
    if (!kinds.includes(e.kind as SemanticKind)) errors.push(`${p}: kind ${String(e.kind)} not allowed`);
  });
  for (const e of entities as EntityDef[]) {
    if (e.roomKey !== undefined && !keys.has(e.roomKey)) errors.push(`entity ${e.key}: unknown roomKey ${e.roomKey}`);
  }

  const edges = Array.isArray(input.semanticEdges) ? input.semanticEdges : (errors.push('semanticEdges must be an array'), []);
  if (edges.length > MANIFEST_LIMITS.maxEdges) errors.push('too many edges');
  const rels: readonly SemanticRel[] = ['located_in', 'adjacent_to', 'derived_from'];
  edges.forEach((e: unknown, i: number) => {
    const p = `semanticEdges[${i}]`;
    if (!isObj(e)) { errors.push(`${p}: not an object`); return; }
    checkId(e.id, ID_RANGES.edges, p, errors);
    if (allIds.has(e.id as number)) errors.push(`${p}: duplicate id ${String(e.id)}`);
    allIds.add(e.id as number);
    if (!rels.includes(e.rel as SemanticRel)) errors.push(`${p}: rel ${String(e.rel)} not allowed (no hydraulic relation exists in WorldGraph)`);
    if (!keys.has(e.from as string)) errors.push(`${p}: unknown from ${String(e.from)}`);
    if (!keys.has(e.to as string)) errors.push(`${p}: unknown to ${String(e.to)}`);
  });

  const derived = Array.isArray(input.derivedStates) ? input.derivedStates : (errors.push('derivedStates must be an array'), []);
  derived.forEach((d: unknown, i: number) => {
    const p = `derivedStates[${i}]`;
    if (!isObj(d)) { errors.push(`${p}: not an object`); return; }
    checkId(d.id, ID_RANGES.derived, p, errors);
    checkId(d.edgeId, ID_RANGES.edges, `${p}.edgeId`, errors);
    for (const id of [d.id, d.edgeId]) {
      if (allIds.has(id as number)) errors.push(`${p}: duplicate id ${String(id)}`);
      allIds.add(id as number);
    }
    if (!keys.has(d.subjectKey as string)) errors.push(`${p}: unknown subjectKey`);
    if (typeof d.statement !== 'string' || !d.statement) errors.push(`${p}: statement missing`);
  });

  const pressure = input.pressure;
  if (!isObj(pressure)) errors.push('pressure missing');
  else {
    if (pressure.unit !== 'kPa') errors.push('pressure.unit must be kPa');
    if (typeof pressure.fixtureId !== 'string' || !pressure.fixtureId) errors.push('pressure.fixtureId missing');
    const routes = Array.isArray(pressure.routes) ? (pressure.routes as PressureRoute[]) : [];
    const relief = routes.find((r) => r.id === 'reservoir-to-relief');
    if (!relief) errors.push('pressure.routes must contain reservoir-to-relief');
    else {
      if (relief.physicalPipePresent !== true) errors.push('reservoir-to-relief must start with physicalPipePresent=true');
      if (relief.approved !== false) errors.push('reservoir-to-relief must start approved=false (W01)');
    }
    const previews = Array.isArray(pressure.previews) ? (pressure.previews as PreviewFixture[]) : [];
    const dests = new Set<Destination>();
    for (const pv of previews) {
      if (!DESTINATIONS.includes(pv.destination)) errors.push(`pressure.previews: unknown destination ${String(pv.destination)}`);
      if (dests.has(pv.destination)) errors.push(`pressure.previews: duplicate ${pv.destination}`);
      dests.add(pv.destination);
      for (const k of ['projectedLoad', 'safeThreshold', 'pumpLoadAfter', 'pumpThreshold'] as const) {
        if (!finite(pv[k]) || pv[k] < 0) errors.push(`pressure.previews.${pv.destination}.${k} must be finite and nonnegative`);
      }
      const reasons = isObj(pressure.reasons) ? pressure.reasons : {};
      if (typeof reasons[pv.reasonKey] !== 'string') errors.push(`pressure.previews.${pv.destination}: missing reason copy ${pv.reasonKey}`);
    }
    if (dests.size !== 3) errors.push('pressure.previews must contain exactly one fixture per destination');
  }

  const g = input.geometry;
  if (!isObj(g)) errors.push('geometry missing');
  else {
    if (g.version !== 1) errors.push('geometry.version must be 1');
    const colliders = Array.isArray(g.colliders) ? g.colliders : (errors.push('geometry.colliders must be an array'), []);
    if (colliders.length > MANIFEST_LIMITS.maxColliders) errors.push('too many colliders');
    colliders.forEach((c: unknown, i: number) => { if (isObj(c)) checkBox(c.box, `geometry.colliders[${i}].box`, errors); else errors.push(`geometry.colliders[${i}] invalid`); });
    for (const list of ['killVolumes', 'zones', 'anchors', 'checkpoints', 'interactables', 'machines', 'dynamics', 'triggers', 'decor'] as const) {
      if (!Array.isArray(g[list])) errors.push(`geometry.${list} must be an array`);
    }
    const anchors = Array.isArray(g.anchors) ? g.anchors : [];
    anchors.forEach((a: unknown, i: number) => {
      const p = `geometry.anchors[${i}]`;
      if (!isObj(a)) { errors.push(`${p} invalid`); return; }
      checkBox(a.volume, `${p}.volume`, errors);
      if (!Array.isArray(a.surfaces) || a.surfaces.length !== 2) { errors.push(`${p}: exactly two surfaces required`); return; }
      for (const [si, s] of (a.surfaces as unknown[]).entries()) {
        if (!isObj(s) || !AXES.includes(s.up as Axis)) errors.push(`${p}.surfaces[${si}]: invalid up`);
        else if (a.target === 'player') {
          if (!isObj(s.landing)) errors.push(`${p}.surfaces[${si}]: player anchor needs landing`);
          else checkVec(s.landing.feet, `${p}.surfaces[${si}].landing.feet`, errors);
        }
      }
      if (typeof a.entityKey === 'string' && !keys.has(a.entityKey)) errors.push(`${p}: unknown entityKey ${a.entityKey}`);
    });
    const zones = Array.isArray(g.zones) ? g.zones : [];
    zones.forEach((z: unknown, i: number) => {
      if (isObj(z)) {
        checkBox(z.box, `geometry.zones[${i}].box`, errors);
        if (!keys.has(z.key as string)) errors.push(`geometry.zones[${i}]: key must match a room entity`);
      }
    });
    if (isObj(g.spawn)) checkVec(g.spawn.feet, 'geometry.spawn.feet', errors); else errors.push('geometry.spawn missing');
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as LevelManifest };
}

/** Compose the coordinator-owned core manifest with the W1-owned geometry file. */
export function composeManifest(core: Omit<LevelManifest, 'geometry'>, geometry: GeometryManifest): LevelManifest {
  return { ...core, geometry };
}
