/**
 * Procedural materials only (no textures, no external assets). Uses three core materials so the
 * same scene renders under WebGPURenderer (auto node conversion), its WebGL2 backend, and the
 * classic WebGLRenderer. No onBeforeCompile / GLSL / TSL so backends stay interchangeable.
 */
import {
  Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Material,
} from 'three';
import type { SurfaceMaterial } from '../contracts/manifest';
import { PALETTE } from './palette';

export interface MaterialSet {
  readonly surface: Readonly<Record<SurfaceMaterial, MeshStandardMaterial>>;
  readonly meshLattice: MeshBasicMaterial;
  readonly rib: MeshStandardMaterial;
  readonly seam: MeshStandardMaterial;
  readonly amberLamp: MeshBasicMaterial;
  readonly water: MeshStandardMaterial;
  readonly glyphWhite: MeshBasicMaterial;
  readonly glyphIdle: MeshBasicMaterial;
  readonly glyphDisabled: MeshBasicMaterial;
  readonly anchorBase: MeshStandardMaterial;
  readonly anchorField: MeshBasicMaterial;
  readonly vermilion: MeshStandardMaterial;
  readonly amber: MeshStandardMaterial;
  readonly amberDark: MeshStandardMaterial;
  readonly player: MeshStandardMaterial;
  readonly playerAccent: MeshStandardMaterial;
  readonly ghost: MeshBasicMaterial;
  readonly skimmer: MeshStandardMaterial;
  readonly hauler: MeshStandardMaterial;
  readonly keeper: MeshStandardMaterial;
  readonly machineDisabled: MeshStandardMaterial;
  readonly street: MeshStandardMaterial;
  readonly flash: MeshBasicMaterial;
  readonly pulse: MeshBasicMaterial;
  readonly spike: MeshBasicMaterial;
  readonly spark: MeshBasicMaterial;
  readonly spray: MeshBasicMaterial;
  all(): Material[];
}

const std = (color: number, roughness: number, metalness: number, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  Object.assign(m, extra);
  return m;
};

const basic = (color: number, opacity = 1, extra: Partial<MeshBasicMaterial> = {}): MeshBasicMaterial => {
  const m = new MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  Object.assign(m, extra);
  return m;
};

export function createMaterials(): MaterialSet {
  const surface: Record<SurfaceMaterial, MeshStandardMaterial> = {
    ceramic: std(PALETTE.ceramic, 0.62, 0.02),
    mesh: std(PALETTE.mesh, 0.5, 0.45, { transparent: true, opacity: 0.82 }),
    metal: std(PALETTE.metal, 0.38, 0.75),
    concrete: std(PALETTE.concrete, 0.9, 0.0),
    glass: std(PALETTE.glass, 0.1, 0.1, { transparent: true, opacity: 0.35 }),
  };
  const set = {
    surface,
    meshLattice: basic(PALETTE.meshLattice, 0.9, { wireframe: true }),
    rib: std(PALETTE.ceramicRib, 0.7, 0.02),
    seam: std(PALETTE.glyphIdle, 0.4, 0.1, { emissive: new Color(PALETTE.amber), emissiveIntensity: 0.05 }),
    amberLamp: basic(PALETTE.amber),
    water: std(PALETTE.water, 0.22, 0.15, { transparent: true, opacity: 0.94 }),
    glyphWhite: basic(PALETTE.glyphWhite, 1, { side: DoubleSide }),
    glyphIdle: basic(PALETTE.glyphIdle, 1, { side: DoubleSide }),
    glyphDisabled: basic(PALETTE.glyphDisabled, 1, { side: DoubleSide }),
    anchorBase: std(PALETTE.metal, 0.45, 0.6),
    anchorField: basic(PALETTE.glyphWhite, 0.07, { depthWrite: false }),
    vermilion: std(PALETTE.vermilion, 0.5, 0.1, { emissive: new Color(PALETTE.vermilion), emissiveIntensity: 0.35 }),
    amber: std(PALETTE.amber, 0.4, 0.1, { emissive: new Color(PALETTE.amber), emissiveIntensity: 0.9 }),
    amberDark: std(PALETTE.amberDim, 0.7, 0.2),
    player: std(PALETTE.player, 0.55, 0.05),
    playerAccent: std(PALETTE.playerAccent, 0.4, 0.2, { emissive: new Color(PALETTE.amber), emissiveIntensity: 0.0 }),
    ghost: basic(PALETTE.ghost, 0.32, { depthWrite: false }),
    skimmer: std(PALETTE.skimmer, 0.35, 0.7),
    hauler: std(PALETTE.hauler, 0.6, 0.5),
    keeper: std(PALETTE.keeper, 0.5, 0.65),
    machineDisabled: std(PALETTE.machineDisabled, 0.9, 0.3),
    street: std(PALETTE.street, 0.95, 0.0),
    flash: basic(PALETTE.glyphWhite, 0, { depthWrite: false, side: DoubleSide }),
    pulse: basic(PALETTE.glyphWhite, 0, { depthWrite: false, side: DoubleSide }),
    spike: basic(PALETTE.amber, 0, { depthWrite: false }),
    spark: basic(PALETTE.amber, 1),
    spray: basic(PALETTE.spray, 0.55, { depthWrite: false }),
  };
  return {
    ...set,
    all(): Material[] {
      const list: Material[] = Object.values(surface);
      for (const [k, v] of Object.entries(set)) if (k !== 'surface') list.push(v as Material);
      return list;
    },
  };
}
