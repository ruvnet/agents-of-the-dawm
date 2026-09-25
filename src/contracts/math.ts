/** Scene coordinates are right handed, metres, Y up. WorldGraph stores local ENU. */
export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

/** Gravity-local up directions are restricted to world axes (anchor-bounded gravity, ADR 0004). */
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const AXES: readonly Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function axisToVec(axis: Axis): Vec3 {
  switch (axis) {
    case '+x': return [1, 0, 0];
    case '-x': return [-1, 0, 0];
    case '+y': return [0, 1, 0];
    case '-y': return [0, -1, 0];
    case '+z': return [0, 0, 1];
    case '-z': return [0, 0, -1];
  }
}

/**
 * v1.1 frozen yaw convention (W1 P2 / W2 P1). On a surface with up axis U the yaw-0 reference
 * tangent is world +x when U is ±y, otherwise world +y. Forward is that tangent rotated about U by
 * yaw (right-handed: positive yaw turns left). Right = forward × up. move2 = [strafe, forward].
 */
export function referenceTangent(up: Axis): Vec3 {
  return up === '+y' || up === '-y' ? [1, 0, 0] : [0, 1, 0];
}

export function surfaceBasis(up: Axis, yaw: number): { up: Vec3; forward: Vec3; right: Vec3 } {
  const u = axisToVec(up);
  const r = referenceTangent(up);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Rodrigues rotation of r about unit u (r ⟂ u, so the u(u·r) term vanishes).
  const uxr: Vec3 = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]];
  const f: Vec3 = [r[0] * c + uxr[0] * s, r[1] * c + uxr[1] * s, r[2] * c + uxr[2] * s];
  const right: Vec3 = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  return { up: u, forward: f, right };
}

export interface EnuPoint {
  readonly east_m: number;
  readonly north_m: number;
  readonly up_m: number;
}

/** ADR 0003 mapping, verbatim. Apply the same linear map to offsets, velocities, normals. */
export const graphToScene = ({ east_m, north_m, up_m }: EnuPoint) =>
  [east_m, up_m, -north_m] as const; // scene x, y, z

export const sceneToGraph = ([x, y, z]: readonly [number, number, number]): EnuPoint =>
  ({ east_m: x, north_m: -z, up_m: y });
