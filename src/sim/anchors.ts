/**
 * Anchor-bounded gravity (ADR 0004). A shift is an authored transition between exactly two surfaces.
 * Player anchors sweep a 0.6 m core cube from the current body centre to the landing body centre and
 * require the whole landing body to be free; any failure emits ShiftRejected and changes nothing.
 * Non-player anchors move their target dynamic body or machine between authored poses.
 */
import type { AnchorDef } from '../contracts/manifest';
import type { SimState } from '../contracts/sim';
import type { Ctx } from './ctx';
import { RULES, cue, emit } from './ctx';
import { bodyBox, bodyCenter, contains, v3 } from './frame';
import { dynamicCollidersAt, overlaps, sweptCubeHits, worldColliders } from './collision';
import { isGrounded } from './state';
import { onKeeperAnchorShift } from './keeper';

const PREVIEW_CUE: Record<string, string> = {
  'anchor-a1-inspection': 'enter-anchor-a1',
  'anchor-gantry': 'preview-gantry',
  'anchor-keeper-left': 'first-keeper-preview',
  'anchor-keeper-right': 'first-keeper-preview',
  'anchor-panel': 'first-keeper-preview',
};

export function anchorEnabled(s: SimState, def: AnchorDef, deckMachines: readonly string[]): boolean {
  switch (def.target) {
    case 'player': return true;
    case 'gantry': return deckMachines.every((k) => s.machines.find((x) => x.key === k)?.mode === 'disabled');
    case 'keeper':
    case 'panel': return s.keeper.phase >= 1 && s.keeper.phase <= 3;
    case 'hauler': {
      const h = s.machines.find((x) => x.key === def.targetKey);
      return !!h && h.active && h.mode !== 'disabled';
    }
  }
}

/** Refresh enabled flags, cooldowns, the anchor the player stands in, and preview events. */
export function updateAnchorPresence(c: Ctx): void {
  const { m, s } = c;
  const deck = m.geometry.machines.filter((x) => x.beat === 'maintenance-deck').map((x) => x.key);
  for (const a of s.anchors) {
    const def = m.geometry.anchors.find((d) => d.key === a.key);
    if (!def) continue;
    a.enabled = anchorEnabled(s, def, deck);
    if (a.cooldownTicks > 0) a.cooldownTicks -= 1;
  }
  const inside = m.geometry.anchors.find((d) => contains(d.volume, s.player.pos));
  const key = inside?.key ?? null;
  if (s.player.anchorKey && s.player.anchorKey !== key) delete s.puzzles[`preview:${s.player.anchorKey}`];
  s.player.anchorKey = key;
  if (!inside) return;
  const st = s.anchors.find((a) => a.key === inside.key);
  if (st?.enabled && s.puzzles[`preview:${inside.key}`] === undefined) {
    s.puzzles[`preview:${inside.key}`] = 1;
    emit(c, 'ShiftPreviewed', inside.key, { target: inside.target, to: inside.surfaces[1 - st.activeSurface]!.up });
    const cueKey = PREVIEW_CUE[inside.key];
    if (cueKey) cue(c, cueKey);
  }
}

function reject(c: Ctx, key: string, reason: string): void {
  emit(c, 'ShiftRejected', key, { reason });
}

/** Handle a shift request. Returns true when committed. Rejection leaves state untouched. */
export function requestShift(c: Ctx, key: string): boolean {
  const { m, s } = c;
  const def = m.geometry.anchors.find((a) => a.key === key);
  const st = s.anchors.find((a) => a.key === key);
  if (!def || !st) { reject(c, key.slice(0, 64), 'unknown-anchor'); return false; }
  const p = s.player;
  if (!contains(def.volume, p.pos)) { reject(c, key, 'outside-volume'); return false; }
  if (!p.grounded) { reject(c, key, 'airborne'); return false; }
  if (!st.enabled) { reject(c, key, 'disabled'); return false; }
  if (st.cooldownTicks > 0) { reject(c, key, 'cooldown'); return false; }
  return def.target === 'player' ? shiftPlayer(c, def, st.activeSurface) : shiftTarget(c, def);
}

function shiftPlayer(c: Ctx, def: AnchorDef, _active: 0 | 1): boolean {
  const { m, s } = c;
  const p = s.player;
  const cur = def.surfaces.findIndex((sf) => sf.up === p.up);
  if (cur < 0) { reject(c, def.key, 'orientation-mismatch'); return false; }
  const target = (1 - cur) as 0 | 1;
  const landing = def.surfaces[target]!.landing;
  if (!landing) { reject(c, def.key, 'no-landing'); return false; }
  const colliders = worldColliders(m, s);
  const landBody = bodyBox(landing.feet, landing.up);
  if (colliders.some((col) => overlaps(landBody, col))) { reject(c, def.key, 'landing-blocked'); return false; }
  const from = bodyCenter(p.pos, p.up);
  const to = bodyCenter(landing.feet, landing.up);
  if (colliders.some((col) => sweptCubeHits(from, to, RULES.coreCubeHalf, col))) { reject(c, def.key, 'path-blocked'); return false; }
  const fromUp = p.up;
  p.pos = v3(landing.feet);
  p.up = landing.up;
  p.yaw = landing.yaw;
  p.vel = [0, 0, 0];
  p.grounded = isGrounded(m, s);
  const st = s.anchors.find((a) => a.key === def.key)!;
  st.activeSurface = target;
  st.cooldownTicks = RULES.anchorCooldown;
  emit(c, 'ShiftCommitted', def.key, { target: 'player', from: fromUp, to: landing.up, surface: target });
  cue(c, 'first-shift');
  return true;
}

function shiftTarget(c: Ctx, def: AnchorDef): boolean {
  const { m, s } = c;
  const st = s.anchors.find((a) => a.key === def.key)!;
  const target = (1 - st.activeSurface) as 0 | 1;
  const surface = def.surfaces[target]!;
  const pose = surface.dynamicPose ?? target;
  if (def.target === 'gantry' || def.target === 'panel') {
    const dyn = s.dynamics.find((d) => d.key === def.targetKey);
    const ddef = m.geometry.dynamics.find((d) => d.key === def.targetKey);
    const offset = ddef?.poses[pose];
    if (!dyn || !ddef || !offset) { reject(c, def.key, 'no-target'); return false; }
    const body = bodyBox(s.player.pos, s.player.up);
    if (dynamicCollidersAt(m, ddef.key, offset).some((b) => overlaps(body, b))) { reject(c, def.key, 'landing-blocked'); return false; }
    dyn.pose = pose;
    dyn.moving = true;
  } else {
    const mach = s.machines.find((x) => x.key === def.targetKey);
    const mdef = m.geometry.machines.find((x) => x.key === def.targetKey);
    if (!mach || !mdef) { reject(c, def.key, 'no-target'); return false; }
    mach.up = surface.up;
    const pt = mdef.patrol?.[pose];
    if (pt) mach.pos = v3(pt);
    if (def.target === 'hauler' && mach.mode !== 'disabled') {
      mach.mode = 'stunned';
      mach.modeTicks = RULES.stunTicks;
      emit(c, 'MachineStunned', mach.key, { cause: 'gravity-shift' });
    }
  }
  st.activeSurface = target;
  st.cooldownTicks = RULES.anchorCooldown;
  emit(c, 'ShiftCommitted', def.key, { target: def.target, to: surface.up, surface: target, pose });
  if (def.target === 'keeper' || def.target === 'panel') onKeeperAnchorShift(c, def.key);
  return true;
}
