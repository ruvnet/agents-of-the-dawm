/** Player look, locomotion, gravity and swept collision on the current axis-aligned surface. */
import type { InputCommand } from '../contracts/input';
import type { Ctx } from './ctx';
import { RULES } from './ctx';
import type { V3 } from './frame';
import { add, axisIndex, bodyBox, clamp, dot, scale, surfaceBasis } from './frame';
import { sweepAxis, worldColliders } from './collision';
import { isGrounded } from './state';

export function applyLook(c: Ctx, cmd: InputCommand): void {
  const p = c.s.player;
  p.yaw = normAngle(p.yaw + cmd.look2[0]);
  p.pitch = clamp(p.pitch + cmd.look2[1], -RULES.pitchLimit, RULES.pitchLimit);
}

function normAngle(a: number): number {
  const tau = Math.PI * 2;
  let r = a % tau;
  if (r > Math.PI) r -= tau;
  if (r <= -Math.PI) r += tau;
  return r;
}

/**
 * Integrate one fixed tick. Tangential velocity follows input directly (full air control keeps
 * scripted traversal deterministic and simple); the up component integrates gravity. Each world
 * axis is then swept against every collider, so the body can never cross one.
 */
export function movePlayer(c: Ctx, cmd: InputCommand): void {
  const { m, s } = c;
  const p = s.player;
  const b = surfaceBasis(p.up, p.yaw);
  let [mx, my] = cmd.move2;
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }
  const tang = add(scale(b.forward, my * RULES.walkSpeed), scale(b.right, mx * RULES.walkSpeed));
  let vUp = dot(p.vel, b.up);
  if (p.grounded && cmd.jump) vUp = RULES.jumpSpeed;
  vUp = Math.max(vUp - RULES.gravity * RULES.dt, -RULES.terminalSpeed);
  const vel: V3 = add(tang, scale(b.up, vUp));
  const colliders = worldColliders(m, s);
  const pos: V3 = [p.pos[0], p.pos[1], p.pos[2]];
  for (let axis = 0; axis < 3; axis++) {
    const want = vel[axis]! * RULES.dt;
    if (want === 0) continue;
    const got = sweepAxis(bodyBox(pos, p.up), axis, want, colliders);
    pos[axis] = pos[axis]! + got;
    if (Math.abs(got - want) > 1e-12) vel[axis] = 0;
  }
  p.pos = pos;
  p.grounded = isGrounded(m, s);
  if (p.grounded && dot(vel, b.up) < 0) vel[axisIndex(p.up)] = 0;
  p.vel = vel;
}
