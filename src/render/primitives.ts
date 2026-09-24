/** Shared primitive geometry and the unit-box helper used by every scene builder. */
import {
  BoxGeometry, CylinderGeometry, Mesh, PlaneGeometry, SphereGeometry, TorusGeometry, type Material,
} from 'three';

export interface SharedGeometry {
  readonly box: BoxGeometry;
  readonly plane: PlaneGeometry;
  readonly crescent: TorusGeometry;
  readonly dot: SphereGeometry;
  readonly cylinder: CylinderGeometry;
  readonly sphere: SphereGeometry;
  readonly torus: TorusGeometry;
}

export function createSharedGeometry(): SharedGeometry {
  return {
    box: new BoxGeometry(1, 1, 1),
    plane: new PlaneGeometry(1, 1),
    crescent: new TorusGeometry(0.55, 0.07, 6, 28, Math.PI * 1.3),
    dot: new SphereGeometry(0.09, 10, 8),
    cylinder: new CylinderGeometry(0.5, 0.5, 1, 20),
    sphere: new SphereGeometry(1, 18, 12),
    torus: new TorusGeometry(1, 0.05, 6, 40),
  };
}

export function disposeSharedGeometry(geo: SharedGeometry): void {
  for (const g of Object.values(geo)) g.dispose();
}

/** Unit box scaled to `size` at `center`. */
export function box(geo: SharedGeometry, mat: Material, center: readonly number[], size: readonly number[]): Mesh {
  const m = new Mesh(geo.box, mat);
  m.position.set(center[0]!, center[1]!, center[2]!);
  m.scale.set(Math.max(size[0]!, 1e-3), Math.max(size[1]!, 1e-3), Math.max(size[2]!, 1e-3));
  return m;
}
