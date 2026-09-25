/**
 * Player silhouette, machines and preview ghosts: simple, original primitive silhouettes.
 * Models are authored in a local frame with +y = gravity up and +z = facing.
 */
import { CapsuleGeometry, Group, Matrix4, Mesh, Vector3, type Material } from 'three';
import { axisToVec, type Axis, type Vec3 } from '../contracts/math';
import type { KeeperState, MachineState } from '../contracts/sim';
import type { SurfaceBasis } from './interpolate';
import type { MaterialSet } from './materials';
import type { MachineNode } from './scene-plan';
import { box, type SharedGeometry } from './primitives';
import { cross, dot, normalize, scale, sub, anyPerpendicular, type V3 } from './vec';

const basisM = new Matrix4();

/** Orient `obj` so local +y = up and local +z = forward (forward re-orthogonalised). */
export function orient(obj: Group | Mesh, up: Vec3, forward: Vec3): void {
  const u = normalize(up);
  let f = sub(forward, scale(u, dot(forward, u)));
  f = normalize(f, anyPerpendicular(u));
  const x = cross(u, f);
  basisM.makeBasis(new Vector3(...x), new Vector3(...u), new Vector3(...f));
  obj.quaternion.setFromRotationMatrix(basisM);
}

export interface PlayerRig {
  readonly group: Group;
  readonly capsule: CapsuleGeometry;
}

function playerShape(mat: Material, accent: Material, geo: SharedGeometry, capsule: CapsuleGeometry): Group {
  const g = new Group();
  const body = new Mesh(capsule, mat);
  body.position.y = 0.9;
  const visor = box(geo, accent, [0, 1.52, 0.22], [0.34, 0.1, 0.08]);
  const pack = box(geo, mat, [0, 1.15, -0.25], [0.42, 0.55, 0.18]);
  const strap = box(geo, accent, [0, 1.0, 0.27], [0.5, 0.06, 0.04]);
  g.add(body, visor, pack, strap);
  return g;
}

export function buildPlayer(mats: MaterialSet, geo: SharedGeometry): PlayerRig {
  const capsule = new CapsuleGeometry(0.28, 1.24, 6, 12);
  const group = playerShape(mats.player, mats.playerAccent, geo, capsule);
  group.name = 'player';
  return { group, capsule };
}

export function buildPlayerGhost(mats: MaterialSet, geo: SharedGeometry, capsule: CapsuleGeometry): Group {
  const g = playerShape(mats.ghost, mats.ghost, geo, capsule);
  g.name = 'preview-ghost';
  g.visible = false;
  g.renderOrder = 10;
  return g;
}

export interface MachineHandle {
  readonly key: string;
  readonly kind: MachineNode['kind'];
  readonly group: Group;
  readonly body: Mesh[];
  readonly bodyMaterial: Material;
  readonly seals: Mesh[];
  readonly stunBand: Mesh;
}

export function buildMachine(n: MachineNode, mats: MaterialSet, geo: SharedGeometry): MachineHandle {
  const group = new Group();
  group.name = n.id;
  group.position.set(...n.pos);
  const body: Mesh[] = [];
  const seals: Mesh[] = [];
  let stunBand: Mesh;
  switch (n.kind) {
    case 'skimmer': {
      const disc = new Mesh(geo.cylinder, mats.skimmer);
      disc.scale.set(0.9, 0.28, 0.9);
      disc.position.y = 0.42;
      const eye = box(geo, mats.amber, [0, 0.46, 0.44], [0.26, 0.08, 0.06]);
      const finL = box(geo, mats.skimmer, [-0.5, 0.42, -0.1], [0.12, 0.06, 0.5]);
      const finR = box(geo, mats.skimmer, [0.5, 0.42, -0.1], [0.12, 0.06, 0.5]);
      stunBand = box(geo, mats.vermilion, [0, 0.58, 0], [0.7, 0.04, 0.7]);
      body.push(disc, finL, finR);
      group.add(disc, eye, finL, finR, stunBand);
      break;
    }
    case 'hauler': {
      const hull = box(geo, mats.hauler, [0, 0.95, -0.2], [2.2, 1.3, 2.4]);
      const cab = box(geo, mats.hauler, [0, 1.2, 1.2], [1.6, 0.9, 0.7]);
      const lamp = box(geo, mats.amber, [0, 1.35, 1.56], [0.9, 0.12, 0.04]);
      body.push(hull, cab);
      for (const x of [-1.05, 1.05]) for (const z of [-1.0, 0.9]) {
        const w = new Mesh(geo.cylinder, mats.surface.metal);
        w.rotation.z = Math.PI / 2;
        w.scale.set(0.6, 0.3, 0.6);
        w.position.set(x, 0.3, z);
        group.add(w);
      }
      stunBand = box(geo, mats.vermilion, [0, 1.62, -0.2], [2.25, 0.06, 2.45]);
      group.add(hull, cab, lamp, stunBand);
      break;
    }
    case 'keeper': {
      const legs = [-2.1, 2.1].map((x) => box(geo, mats.keeper, [x, 1.6, 0], [0.7, 3.2, 1.2]));
      const hull = box(geo, mats.keeper, [0, 4.1, 0], [5.0, 2.4, 2.6]);
      const beam = box(geo, mats.surface.metal, [0, 2.9, 0], [4.6, 0.4, 0.8]);
      const shield = box(geo, mats.surface.mesh, [0, 4.1, 1.55], [3.6, 2.0, 0.12]);
      body.push(...legs, hull, beam);
      for (let i = 0; i < 3; i++) {
        const seal = new Mesh(geo.sphere, mats.amber);
        seal.scale.setScalar(0.34);
        seal.position.set((i - 1) * 1.3, 4.3, 1.72);
        seal.name = `${n.id}:seal${i}`;
        seals.push(seal);
      }
      stunBand = box(geo, mats.vermilion, [0, 5.35, 0], [5.05, 0.1, 2.65]);
      group.add(...legs, hull, beam, shield, ...seals, stunBand);
      break;
    }
  }
  stunBand.visible = false;
  return { key: n.key, kind: n.kind, group, body, bodyMaterial: body[0]!.material as Material, seals, stunBand };
}

/** Seals darken as sealsRemaining drops (index >= sealsRemaining is broken). */
export function sealLit(keeper: Pick<KeeperState, 'sealsRemaining'>, index: number): boolean {
  return index < keeper.sealsRemaining;
}

export function updateMachine(
  h: MachineHandle, pos: Vec3, up: Axis, visible: boolean, m: Readonly<MachineState>, keeper: Readonly<KeeperState>,
  playerPos: Vec3, mats: MaterialSet, nowMs: number,
): void {
  h.group.visible = visible;
  if (!visible) return;
  h.group.position.set(pos[0], pos[1], pos[2]);
  const u = axisToVec(up) as V3;
  orient(h.group, u, sub(playerPos, pos)); // render-only facing toward the player
  const disabled = m.mode === 'disabled' || (h.kind === 'keeper' && keeper.phase === 4);
  const bodyMat = disabled ? mats.machineDisabled : h.bodyMaterial;
  for (const b of h.body) b.material = bodyMat;
  h.stunBand.visible = m.mode === 'stunned' || m.mode === 'pinned' || (m.mode === 'telegraph' && Math.floor(nowMs / 150) % 2 === 0);
  h.seals.forEach((s, i) => { s.material = sealLit(keeper, i) && !disabled ? mats.amber : mats.amberDark; });
}
