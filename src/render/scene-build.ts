/**
 * Materialises the critical layer of a ScenePlan into three.js core objects. Primitive,
 * original geometry only. Repeated static colliders are instanced per material.
 * This file is GL-free (three objects construct without a context) but is kept thin; the
 * counting/decision logic lives in scene-plan.ts.
 */
import {
  BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3,
} from 'three';
import { axisToVec, type Axis } from '../contracts/math';
import type { MaterialSet } from './materials';
import {
  nodesOf, type AnchorNode, type ColliderNode, type DecorNode, type InteractableNode, type ScenePlan,
} from './scene-plan';
import { buildMachine, type MachineHandle } from './actors';
import { box, type SharedGeometry } from './primitives';
import type { V3 } from './vec';

export interface AnchorHandle {
  readonly node: AnchorNode;
  readonly group: Group;
  readonly glyphs: readonly [Mesh, Mesh];
  readonly activeDots: readonly [Mesh, Mesh];
}

export interface DynamicHandle {
  readonly key: string;
  readonly group: Group;
  readonly base: V3;
}

export interface GateHandle { readonly obj: Object3D; readonly baseY: number; readonly height: number }
export interface TramHandle { readonly obj: Object3D; readonly base: V3; readonly travel: V3 }

export interface SceneHandles {
  readonly root: Group;
  readonly anchors: Map<string, AnchorHandle>;
  readonly machines: Map<string, MachineHandle>;
  readonly dynamics: Map<string, DynamicHandle>;
  readonly gate: GateHandle | null;
  readonly tram: TramHandle | null;
  readonly seams: InstancedMesh | null;
  readonly geometries: BufferGeometry[];
}

const Z = new Vector3(0, 0, 1);
const tmpM = new Matrix4();
const tmpQ = new Quaternion();

/** Orient an object's +z to the given axis (glyph plane normal = surface up). */
export function faceAxis(obj: Object3D, up: Axis): void {
  const u = axisToVec(up);
  obj.quaternion.setFromUnitVectors(Z, new Vector3(u[0], u[1], u[2]));
}

/** Distinct in-plane rotation per glyph name, so floor/wall crescents read differently. */
export function glyphSpin(glyph: string): number {
  if (glyph === 'crescent-floor') return 0;
  if (glyph === 'crescent-wall') return Math.PI / 2;
  let h = 0;
  for (let i = 0; i < glyph.length; i++) h = (h * 31 + glyph.charCodeAt(i)) >>> 0;
  return (h % 8) * (Math.PI / 4);
}

function buildColliders(plan: ScenePlan, mats: MaterialSet, geo: SharedGeometry, root: Group, dynamics: Map<string, DynamicHandle>): void {
  const colliders = nodesOf(plan, 'collider');
  const groups = new Map<string, ColliderNode[]>();
  for (const c of colliders) {
    if (c.dynamicKey) {
      const d = dynamics.get(c.dynamicKey);
      const mesh = box(geo, mats.surface[c.material], [c.center[0] - (d?.base[0] ?? 0), c.center[1] - (d?.base[1] ?? 0), c.center[2] - (d?.base[2] ?? 0)], c.size);
      mesh.name = c.id;
      (d?.group ?? root).add(mesh);
      continue;
    }
    if (!c.instanceGroup) {
      const mesh = box(geo, mats.surface[c.material], c.center, c.size);
      mesh.name = c.id;
      root.add(mesh);
      if (c.material === 'mesh') root.add(Object.assign(box(geo, mats.meshLattice, c.center, c.size), { name: `${c.id}:lattice` }));
      continue;
    }
    const list = groups.get(c.instanceGroup) ?? [];
    list.push(c);
    groups.set(c.instanceGroup, list);
  }
  for (const [name, list] of groups) {
    const material = mats.surface[list[0]!.material];
    const inst = new InstancedMesh(geo.box, material, list.length);
    inst.name = name;
    list.forEach((c, i) => {
      tmpM.compose(new Vector3(...c.center), tmpQ.identity(), new Vector3(...c.size));
      inst.setMatrixAt(i, tmpM);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    root.add(inst);
    if (list[0]!.material === 'mesh') {
      const lattice = new InstancedMesh(geo.box, mats.meshLattice, list.length);
      lattice.name = `${name}:lattice`;
      for (let i = 0; i < list.length; i++) { inst.getMatrixAt(i, tmpM); lattice.setMatrixAt(i, tmpM); }
      lattice.computeBoundingSphere();
      root.add(lattice);
    }
  }
}

/** Floor seams: thin strips on the top face of floor-like static colliders (surge telegraph). */
function buildSeams(plan: ScenePlan, mats: MaterialSet, geo: SharedGeometry): InstancedMesh | null {
  const floors = nodesOf(plan, 'collider').filter((c) => !c.dynamicKey && c.size[0] >= 1 && c.size[2] >= 1 && c.size[1] <= Math.max(c.size[0], c.size[2]));
  if (!floors.length) return null;
  const inst = new InstancedMesh(geo.box, mats.seam, floors.length * 2);
  inst.name = 'floor-seams';
  floors.forEach((c, i) => {
    const alongX = c.size[0] >= c.size[2];
    const top = c.center[1] + c.size[1] / 2 + 0.012;
    for (const side of [0, 1]) {
      const off = (side ? 0.3 : -0.3) * (alongX ? c.size[2] : c.size[0]);
      const pos = alongX ? new Vector3(c.center[0], top, c.center[2] + off) : new Vector3(c.center[0] + off, top, c.center[2]);
      const size = alongX ? new Vector3(c.size[0] * 0.94, 0.02, 0.08) : new Vector3(0.08, 0.02, c.size[2] * 0.94);
      inst.setMatrixAt(i * 2 + side, tmpM.compose(pos, tmpQ.identity(), size));
    }
  });
  inst.computeBoundingSphere();
  return inst;
}

function buildAnchor(node: AnchorNode, mats: MaterialSet, geo: SharedGeometry): AnchorHandle {
  const group = new Group();
  group.name = node.id;
  const field = box(geo, mats.anchorField, node.center, node.size);
  field.name = `${node.id}:field`;
  group.add(field);
  const glyphs: Mesh[] = [];
  const dots: Mesh[] = [];
  for (const g of node.glyphs) {
    const holder = new Group();
    holder.position.set(...g.pos);
    faceAxis(holder, g.up);
    const plate = new Mesh(geo.cylinder, mats.anchorBase);
    plate.rotation.x = Math.PI / 2;
    plate.scale.set(1.5, 0.03, 1.5);
    plate.position.z = -0.02;
    const glyph = new Mesh(geo.crescent, mats.glyphIdle);
    glyph.rotation.z = glyphSpin(g.glyph);
    glyph.name = `${node.id}:glyph${g.surface}`;
    const dot = new Mesh(geo.dot, mats.glyphWhite);
    dot.visible = false;
    holder.add(plate, glyph, dot);
    group.add(holder);
    glyphs.push(glyph);
    dots.push(dot);
  }
  return { node, group, glyphs: glyphs as unknown as [Mesh, Mesh], activeDots: dots as unknown as [Mesh, Mesh] };
}

function buildInteractable(n: InteractableNode, mats: MaterialSet, geo: SharedGeometry): Group {
  const g = new Group();
  g.name = n.id;
  g.position.set(...n.pos);
  switch (n.kind) {
    case 'pressure-map':
      g.add(box(geo, mats.surface.metal, [0, -0.4, 0], [0.8, 1.1, 0.4]), box(geo, mats.amber, [0, 0.2, 0], [0.7, 0.45, 0.05]));
      break;
    case 'channel-marker':
      g.add(box(geo, mats.vermilion, [0, -0.2, 0], [0.14, 1.6, 0.14]), box(geo, mats.glyphWhite, [0, 0.62, 0], [0.4, 0.4, 0.04]));
      break;
    case 'valve': {
      const wheel = new Mesh(geo.torus, mats.amberDark);
      wheel.scale.setScalar(0.35);
      g.add(wheel, box(geo, mats.surface.metal, [0, 0, -0.25], [0.12, 0.12, 0.5]));
      break;
    }
    case 'control-screen':
      g.add(box(geo, mats.surface.metal, [0, 0, 0], [1.6, 1.1, 0.2]), box(geo, mats.amber, [0, 0, 0.11], [1.4, 0.9, 0.02]));
      break;
    case 'charge-cell':
      g.add(box(geo, mats.amber, [0, 0, 0], [0.3, 0.5, 0.3]));
      break;
    case 'overdrive-cell':
      g.add(box(geo, mats.vermilion, [0, 0, 0], [0.3, 0.5, 0.3]));
      break;
  }
  return g;
}

function longAxis(size: V3): 0 | 2 {
  return size[0] >= size[2] ? 0 : 2;
}

function buildDecor(n: DecorNode, mats: MaterialSet, geo: SharedGeometry, handles: { gate: GateHandle | null; tram: TramHandle | null }): Object3D {
  const g = new Group();
  g.name = n.id;
  g.position.set(...n.center);
  const s = n.size;
  switch (n.kind) {
    case 'tram': {
      g.add(box(geo, mats.surface.ceramic, [0, 0, 0], s), box(geo, mats.vermilion, [0, -s[1] * 0.38, 0], [s[0] * 1.001, s[1] * 0.08, s[2] * 1.001]));
      const ax = longAxis(s);
      const len = s[ax];
      for (let i = 0; i < 4; i++) {
        const t = -len / 2 + (len * (i + 0.5)) / 4;
        for (const side of [-1, 1]) {
          const pos: V3 = ax === 0 ? [t, s[1] * 0.12, side * (s[2] / 2 + 0.02)] : [side * (s[0] / 2 + 0.02), s[1] * 0.12, t];
          const size: V3 = ax === 0 ? [len / 6, s[1] * 0.35, 0.04] : [0.04, s[1] * 0.35, len / 6];
          g.add(box(geo, mats.amber, pos, size));
        }
      }
      handles.tram = { obj: g, base: [...n.center] as V3, travel: [0, 0, 0] };
      break;
    }
    case 'gate':
      g.add(box(geo, mats.surface.metal, [0, 0, 0], s), box(geo, mats.vermilion, [0, s[1] * 0.1, 0], [s[0] * 1.02, s[1] * 0.06, s[2] * 0.6]));
      handles.gate = { obj: g, baseY: n.center[1], height: s[1] };
      break;
    case 'sea': {
      const p = new Mesh(geo.plane, mats.water);
      p.rotation.x = -Math.PI / 2;
      p.position.y = s[1] / 2;
      p.scale.set(Math.min(s[0], 3000), Math.min(s[2], 3000), 1);
      g.add(p);
      break;
    }
    case 'pump': {
      const c = new Mesh(geo.cylinder, mats.surface.metal);
      c.scale.set(Math.min(s[0], s[2]), s[1], Math.min(s[0], s[2]));
      g.add(c, box(geo, mats.amber, [0, s[1] / 2 + 0.1, 0], [0.3, 0.2, 0.3]));
      break;
    }
    case 'reservoir': {
      const w = 0.4;
      g.add(
        box(geo, mats.surface.concrete, [0, -s[1] / 2 + w / 2, 0], [s[0], w, s[2]]),
        box(geo, mats.surface.concrete, [-s[0] / 2 + w / 2, 0, 0], [w, s[1], s[2]]),
        box(geo, mats.surface.concrete, [s[0] / 2 - w / 2, 0, 0], [w, s[1], s[2]]),
        box(geo, mats.surface.concrete, [0, 0, -s[2] / 2 + w / 2], [s[0], s[1], w]),
        box(geo, mats.surface.concrete, [0, 0, s[2] / 2 - w / 2], [s[0], s[1], w]),
        box(geo, mats.water, [0, s[1] * 0.3, 0], [s[0] - 2 * w, 0.02, s[2] - 2 * w]),
      );
      break;
    }
    case 'relief-channel': {
      const ax = longAxis(s);
      const w = 0.35;
      const wall = (side: number): Mesh => ax === 0
        ? box(geo, mats.surface.concrete, [0, 0, side * (s[2] / 2 - w / 2)], [s[0], s[1], w])
        : box(geo, mats.surface.concrete, [side * (s[0] / 2 - w / 2), 0, 0], [w, s[1], s[2]]);
      g.add(box(geo, mats.surface.concrete, [0, -s[1] / 2 + 0.1, 0], [s[0], 0.2, s[2]]), wall(-1), wall(1));
      break;
    }
    case 'street':
      g.add(box(geo, mats.street, [0, 0, 0], s));
      break;
    case 'pipe': {
      const c = new Mesh(geo.cylinder, mats.surface.metal);
      const dims = [...s].sort((a, b) => b - a);
      const r = Math.min(dims[1]!, dims[2]!);
      c.scale.set(r, dims[0]!, r);
      if (s[0] === dims[0]) c.rotation.z = Math.PI / 2;
      else if (s[2] === dims[0]) c.rotation.x = Math.PI / 2;
      g.add(c);
      break;
    }
    case 'sign':
      g.add(box(geo, mats.vermilion, [0, 0, 0], s));
      break;
    case 'rail':
      g.add(box(geo, mats.surface.metal, [0, 0, 0], s));
      break;
  }
  return g;
}

export function buildCriticalScene(plan: ScenePlan, mats: MaterialSet, geo: SharedGeometry): SceneHandles {
  const root = new Group();
  root.name = `floodline:${plan.manifestId}`;
  const dynamics = new Map<string, DynamicHandle>();
  for (const d of nodesOf(plan, 'dynamic')) {
    const group = new Group();
    group.name = d.id;
    group.position.set(...d.center);
    const frame = box(geo, d.kind === 'gantry' ? mats.surface.mesh : mats.surface.ceramic, [0, 0, 0], d.size);
    frame.name = `${d.id}:body`;
    group.add(frame);
    if (d.kind === 'gantry') group.add(box(geo, mats.meshLattice, [0, 0, 0], d.size));
    root.add(group);
    dynamics.set(d.key, { key: d.key, group, base: [...d.center] as V3 });
  }
  buildColliders(plan, mats, geo, root, dynamics);
  const seams = buildSeams(plan, mats, geo);
  if (seams) root.add(seams);

  for (const k of nodesOf(plan, 'kill-volume')) {
    const p = new Mesh(geo.plane, mats.water);
    p.name = k.id;
    p.rotation.x = -Math.PI / 2;
    p.position.set(k.footprintCenter[0], k.surfaceY, k.footprintCenter[1]);
    p.scale.set(k.footprintSize[0], k.footprintSize[1], 1);
    root.add(p);
  }
  const anchors = new Map<string, AnchorHandle>();
  for (const a of nodesOf(plan, 'anchor')) {
    const h = buildAnchor(a, mats, geo);
    anchors.set(a.key, h);
    root.add(h.group);
  }
  for (const it of nodesOf(plan, 'interactable')) root.add(buildInteractable(it, mats, geo));
  const machines = new Map<string, MachineHandle>();
  for (const m of nodesOf(plan, 'machine')) {
    const h = buildMachine(m, mats, geo);
    machines.set(m.key, h);
    root.add(h.group);
  }
  const special: { gate: GateHandle | null; tram: TramHandle | null } = { gate: null, tram: null };
  for (const d of nodesOf(plan, 'decor')) root.add(buildDecor(d, mats, geo, special));
  if (special.tram) {
    const t = special.tram;
    const size = nodesOf(plan, 'decor').find((d) => d.kind === 'tram')!.size;
    const toGate: V3 = special.gate ? [special.gate.obj.position.x - t.base[0], 0, special.gate.obj.position.z - t.base[2]] : [0, 0, 0];
    const dist = Math.hypot(toGate[0], toGate[2]);
    const travel: V3 = dist > 1e-3
      ? [toGate[0] * 2 + (toGate[0] / dist) * size[longAxis(size)], 0, toGate[2] * 2 + (toGate[2] / dist) * size[longAxis(size)]]
      : longAxis(size) === 0 ? [size[0] * 4, 0, 0] : [0, 0, size[2] * 4];
    special.tram = { ...t, travel };
  }
  return { root, anchors, machines, dynamics, gate: special.gate, tram: special.tram, seams, geometries: [] };
}
