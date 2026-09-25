/**
 * WorldGraph `TwinMessage` wire commands (worldgraph-stream protocol.rs, `#[serde(tag = "op")]`) and their
 * pre-WASM validation. Node tag is `kind`, edge tag is `rel` (wifi-densepose-worldgraph model.rs).
 * Only the subset this game projects is typed here; no invented ops or tags.
 */
import { ID_RANGES, MANIFEST_LIMITS } from '../contracts';

export interface Enu { east_m: number; north_m: number; up_m: number }

export type BoundsEnu =
  | { shape: 'rectangle'; min_e: number; min_n: number; max_e: number; max_n: number }
  | { shape: 'polygon'; vertices: [number, number][] };

export type WgNode =
  | { kind: 'room'; id: number; area_id: string | null; name: string; bounds_enu: BoundsEnu; floor: number }
  | { kind: 'zone'; id: number; parent_room: number; name: string; bounds_enu: BoundsEnu }
  | { kind: 'wall'; id: number; a: Enu; b: Enu; rf_attenuation_db: number }
  | { kind: 'doorway'; id: number; center: Enu; width_m: number }
  | { kind: 'object_anchor'; id: number; position: Enu; anchor_kind: 'reflector'; confidence: number }
  | {
      kind: 'semantic_state'; id: number; statement: string; confidence: number;
      provenance: { evidence: string[]; model_version: string; calibration_version: string; privacy_decision: string };
      valid_from_unix_ms: number;
    };

/** The closed subset of WorldEdge relations this game may project. No hydraulic relation exists. */
export type WgEdge =
  | { rel: 'located_in'; since_unix_ms: number }
  | { rel: 'adjacent_to'; via_doorway: number }
  | { rel: 'derived_from'; evidence: string };

export type TwinCommand =
  | { op: 'upsert_node'; node: WgNode }
  | { op: 'upsert_edge'; id: number; from: number; to: number; edge: WgEdge };

export const ALLOWED_NODE_KINDS: readonly WgNode['kind'][] =
  ['room', 'zone', 'wall', 'doorway', 'object_anchor', 'semantic_state'];
export const ALLOWED_RELS: readonly WgEdge['rel'][] = ['located_in', 'adjacent_to', 'derived_from'];
/** Upper bound on commands in one projection (static + derived), mirrors MANIFEST_LIMITS. */
export const MAX_COMMANDS = MANIFEST_LIMITS.maxEntities + MANIFEST_LIMITS.maxEdges + 64;
const MAX_STRING = 512;

const inRange = (id: unknown, range: readonly [number, number]): boolean =>
  Number.isSafeInteger(id) && (id as number) >= range[0] && (id as number) <= range[1];
const nodeRange = (kind: WgNode['kind']) => (kind === 'semantic_state' ? ID_RANGES.derived : ID_RANGES.static);

function checkNumbers(value: unknown, path: string, errors: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path}: non-finite number`);
    else if (Math.abs(value) > 1e15) errors.push(`${path}: magnitude out of range`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) errors.push(`${path}: string too long`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => checkNumbers(v, `${path}[${i}]`, errors)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) checkNumbers(v, `${path}.${k}`, errors);
  }
}

function checkCoords(node: WgNode, path: string, errors: string[]): void {
  const pts: Enu[] = [];
  if (node.kind === 'wall') pts.push(node.a, node.b);
  if (node.kind === 'doorway') pts.push(node.center);
  if (node.kind === 'object_anchor') pts.push(node.position);
  for (const p of pts) {
    for (const c of [p?.east_m, p?.north_m, p?.up_m]) {
      if (typeof c !== 'number' || !Number.isFinite(c) || Math.abs(c) > MANIFEST_LIMITS.maxAbsCoord) {
        errors.push(`${path}: ENU coordinate invalid or out of range`);
        return;
      }
    }
  }
}

/**
 * Validate commands before they reach WASM: safe integer IDs in ID_RANGES, no duplicate
 * node/edge IDs, allowed kinds and relations only, finite bounded coordinates, bounded counts,
 * edge endpoints referencing projected nodes, integral i64 timestamps.
 */
export function validateCommands(commands: readonly TwinCommand[], knownNodeIds: ReadonlySet<number> = new Set()): string[] {
  const errors: string[] = [];
  if (commands.length > MAX_COMMANDS) errors.push(`too many commands (${commands.length} > ${MAX_COMMANDS})`);
  const nodeIds = new Set<number>();
  const hasNode = (id: number) => nodeIds.has(id) || knownNodeIds.has(id);
  const edgeIds = new Set<number>();
  commands.forEach((c, i) => {
    const p = `commands[${i}]`;
    checkNumbers(c, p, errors);
    if (c.op === 'upsert_node') {
      const n = c.node;
      if (!ALLOWED_NODE_KINDS.includes(n.kind)) { errors.push(`${p}: node kind ${String(n.kind)} not allowed`); return; }
      if (!inRange(n.id, nodeRange(n.kind))) errors.push(`${p}: node id ${String(n.id)} outside ${n.kind} range`);
      if (nodeIds.has(n.id)) errors.push(`${p}: duplicate node id ${n.id}`);
      nodeIds.add(n.id);
      checkCoords(n, p, errors);
      if (n.kind === 'semantic_state') {
        const pr = n.provenance;
        if (!pr || !Array.isArray(pr.evidence) || pr.evidence.length === 0 || !pr.model_version ||
            !pr.calibration_version || !pr.privacy_decision) errors.push(`${p}: semantic_state provenance incomplete`);
        if (!Number.isSafeInteger(n.valid_from_unix_ms)) errors.push(`${p}: valid_from_unix_ms must be an integer`);
        if (!(n.confidence >= 0 && n.confidence <= 1)) errors.push(`${p}: confidence outside [0,1]`);
      }
      if (n.kind === 'object_anchor' && !(n.confidence >= 0 && n.confidence <= 1)) errors.push(`${p}: confidence outside [0,1]`);
    } else if (c.op === 'upsert_edge') {
      if (!inRange(c.id, ID_RANGES.edges)) errors.push(`${p}: edge id ${String(c.id)} outside edge range`);
      if (edgeIds.has(c.id)) errors.push(`${p}: duplicate edge id ${c.id}`);
      edgeIds.add(c.id);
      if (!ALLOWED_RELS.includes(c.edge?.rel)) errors.push(`${p}: rel ${String(c.edge?.rel)} not allowed (no hydraulic relation)`);
      if (!hasNode(c.from) || !hasNode(c.to)) errors.push(`${p}: edge ${c.id} endpoint not projected`);
      if (c.edge?.rel === 'located_in' && !Number.isSafeInteger(c.edge.since_unix_ms)) errors.push(`${p}: since_unix_ms must be an integer`);
      if (c.edge?.rel === 'adjacent_to' && !hasNode(c.edge.via_doorway)) errors.push(`${p}: via_doorway not projected`);
    } else {
      errors.push(`${p}: unknown op ${String((c as { op?: unknown }).op)}`);
    }
  });
  return errors;
}
