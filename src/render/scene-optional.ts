/**
 * Optional atmosphere layer (ADR 0002): dawn sky, distant coast, fog, storm spray, ceramic ribs
 * and amber working lamps. Built one step per frame after the game is controllable; each step
 * can be hidden by the governor's effects level. Nothing here gates control.
 */
import {
  BackSide, BufferAttribute, Color, ConeGeometry, Fog, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, Scene, SphereGeometry, Vector3, type BufferGeometry, type Material, type Object3D,
} from 'three';
import type { MaterialSet } from './materials';
import { PALETTE } from './palette';
import type { SharedGeometry } from './primitives';
import { nodesOf, type KillVolumeNode, type OptionalKind, type ScenePlan } from './scene-plan';
import type { V3 } from './vec';

export interface OptionalPiece {
  readonly kind: OptionalKind;
  readonly objects: Object3D[];
  /** Minimum effects level at which the piece is shown. */
  readonly minLevel: 0 | 1 | 2;
  update?(nowMs: number, focus: V3): void;
  setLevel?(level: 0 | 1 | 2): void;
  dispose(): void;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

/** Deterministic LCG so the coastline is stable across sessions (no Math.random). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildSky(scene: Scene): OptionalPiece {
  const geo = new SphereGeometry(1800, 32, 16);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const zenith = new Color(PALETTE.skyZenith);
  const horizon = new Color(PALETTE.skyHorizon);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 1800);
    c.copy(horizon).lerp(zenith, Math.pow(h, 0.55));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  const mat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const sky = new Mesh(geo, mat);
  sky.name = 'optional:sky';
  sky.renderOrder = -10;
  const sunMat = new MeshBasicMaterial({ color: PALETTE.sun, fog: false });
  const sun = new Mesh(new SphereGeometry(40, 16, 10), sunMat);
  sun.position.set(1500, 140, -700);
  sky.add(sun);
  scene.background = new Color(PALETTE.skyHorizon);
  return {
    kind: 'sky', objects: [sky], minLevel: 0,
    update(_now, focus) { sky.position.set(focus[0], 0, focus[2]); },
    dispose() { geo.dispose(); mat.dispose(); sun.geometry.dispose(); sunMat.dispose(); },
  };
}

export function buildCoast(plan: ScenePlan): OptionalPiece {
  const rand = lcg(0xf100d);
  const count = 60;
  const geo = new ConeGeometry(1, 1, 5);
  const mat = new MeshBasicMaterial({ color: PALETTE.coast });
  const inst = new InstancedMesh(geo, mat, count);
  inst.name = 'optional:coast';
  const cx = (plan.bounds.min[0] + plan.bounds.max[0]) / 2;
  for (let i = 0; i < count; i++) {
    const x = cx - 1200 + (2400 * i) / count + rand() * 30;
    const h = 30 + rand() * 90;
    const w = 60 + rand() * 90;
    tmpM.compose(tmpP.set(x, h / 2 - 8, -900 - rand() * 200), tmpQ.identity(), tmpS.set(w, h, w * 0.6));
    inst.setMatrixAt(i, tmpM);
  }
  inst.computeBoundingSphere();
  // Distant open sea to the horizon at the lowest authored water level (the gameplay kill
  // volumes stay authoritative; this is backdrop only, slightly below them to avoid z-fight).
  const kills = nodesOf(plan, 'kill-volume');
  const objects: Object3D[] = [inst];
  let seaGeo: BufferGeometry | null = null;
  const seaMat = new MeshBasicMaterial({ color: PALETTE.waterDeep });
  if (kills.length) {
    const y = Math.min(...kills.map((k) => k.surfaceY)) - 0.05;
    seaGeo = new PlaneGeometry(4000, 4000);
    const sea = new Mesh(seaGeo, seaMat);
    sea.name = 'optional:horizon-sea';
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(cx, y, 0);
    objects.push(sea);
  }
  return { kind: 'coast', objects, minLevel: 0, dispose() { geo.dispose(); mat.dispose(); seaGeo?.dispose(); seaMat.dispose(); } };
}

export function buildFog(scene: Scene): OptionalPiece {
  const fog = new Fog(PALETTE.fog, 80, 1500);
  scene.fog = fog;
  return {
    kind: 'fog', objects: [], minLevel: 0,
    setLevel(level) { fog.near = level >= 1 ? 80 : 200; },
    dispose() { if (scene.fog === fog) scene.fog = null; },
  };
}

/** Water surface directly below `focus` (highest kill-volume surface under it), else null. */
export function waterBelow(kills: readonly KillVolumeNode[], focus: V3): number | null {
  let best: number | null = null;
  for (const k of kills) {
    const hx = k.footprintSize[0] / 2;
    const hz = k.footprintSize[1] / 2;
    if (Math.abs(focus[0] - k.footprintCenter[0]) > hx || Math.abs(focus[2] - k.footprintCenter[1]) > hz) continue;
    if (k.surfaceY <= focus[1] && (best === null || k.surfaceY > best)) best = k.surfaceY;
  }
  return best;
}

export function buildSpray(plan: ScenePlan, mats: MaterialSet, geo: SharedGeometry, maxParticles: number): OptionalPiece {
  const kills = nodesOf(plan, 'kill-volume');
  const count = Math.max(1, maxParticles);
  const inst = new InstancedMesh(geo.sphere, mats.spray, count);
  inst.name = 'optional:spray';
  inst.frustumCulled = false;
  const rand = lcg(0x5e4);
  const seeds = Array.from({ length: count }, () => [rand(), rand(), rand(), rand()] as const);
  let active = count;
  return {
    kind: 'spray', objects: [inst], minLevel: 1,
    setLevel(level) { active = level >= 2 ? count : Math.floor(count / 3); inst.count = active; },
    update(nowMs, focus) {
      const y0 = waterBelow(kills, focus);
      inst.visible = y0 !== null && active > 0;
      if (!inst.visible) return;
      const t = nowMs / 1000;
      for (let i = 0; i < active; i++) {
        const s = seeds[i]!;
        const phase = (t * (0.35 + s[2] * 0.4) + s[3]) % 1;
        const ang = s[0] * Math.PI * 2;
        const r = 8 + s[1] * 40;
        const lift = Math.sin(phase * Math.PI) * (1.5 + s[2] * 3.5);
        tmpP.set(focus[0] + Math.cos(ang) * r, (y0 as number) + lift, focus[2] + Math.sin(ang) * r);
        tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(0.05 + (1 - phase) * 0.12));
        inst.setMatrixAt(i, tmpM);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
    dispose() { /* shares geometry + material with the critical set */ },
  };
}

export const MAX_RIBS = 1500;
export const MAX_LAMPS = 200;

/** Ribs across the top of ceramic colliders, plus amber lamps on tall structures. */
export function buildRibsAndLamps(plan: ScenePlan, mats: MaterialSet, geo: SharedGeometry): OptionalPiece {
  const ribs: Matrix4[] = [];
  const lamps: Matrix4[] = [];
  for (const c of nodesOf(plan, 'collider')) {
    if (c.dynamicKey) continue;
    const top = c.center[1] + c.size[1] / 2;
    if (c.material === 'ceramic' && c.size[0] >= 1 && c.size[2] >= 1) {
      const alongX = c.size[0] >= c.size[2];
      const len = alongX ? c.size[0] : c.size[2];
      const n = Math.floor(len / 1.4);
      for (let i = 0; i < n && ribs.length < MAX_RIBS; i++) {
        const t = -len / 2 + (i + 0.5) * (len / n);
        const p = alongX ? tmpP.set(c.center[0] + t, top + 0.03, c.center[2]) : tmpP.set(c.center[0], top + 0.03, c.center[2] + t);
        const s = alongX ? tmpS.set(0.12, 0.06, c.size[2] * 0.98) : tmpS.set(c.size[0] * 0.98, 0.06, 0.12);
        ribs.push(new Matrix4().compose(p, tmpQ.identity(), s));
      }
    }
    if (c.size[1] >= 3 && lamps.length + 2 <= MAX_LAMPS) {
      for (const sx of [-1, 1]) {
        lamps.push(new Matrix4().compose(tmpP.set(c.center[0] + sx * (c.size[0] / 2 - 0.3), top + 0.15, c.center[2]), tmpQ.identity(), tmpS.set(0.25, 0.2, 0.25)));
      }
    }
  }
  const objects: Object3D[] = [];
  const make = (list: Matrix4[], mat: Material, name: string): InstancedMesh | null => {
    if (!list.length) return null;
    const inst = new InstancedMesh(geo.box as BufferGeometry, mat, list.length);
    inst.name = name;
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.computeBoundingSphere();
    objects.push(inst);
    return inst;
  };
  const ribMesh = make(ribs, mats.rib, 'optional:ribs');
  make(lamps, mats.amberLamp, 'optional:lamps');
  return {
    kind: 'ribs', objects, minLevel: 1,
    setLevel(level) { if (ribMesh) ribMesh.visible = level >= 2; },
    dispose() { /* shared geometry + materials */ },
  };
}
