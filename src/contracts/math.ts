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
