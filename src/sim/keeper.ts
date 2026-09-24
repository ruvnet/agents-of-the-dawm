/**
 * Gate keeper encounter (script beat 6). Three seal phases; each seal is exposed only by its authored
 * gravity interaction (left anchor, panel anchor, right anchor pin) or by the upper route's single
 * overdrive stun, and is broken by a Spike during the exposure window. Surges repeat every 20 s
 * (30 s after the lower route's valves) with a 3 s SurgeTelegraph. The keeper is disabled, never killed.
 */
import type { Ctx } from './ctx';
import { RULES, cue, emit } from './ctx';
import { bodyCenter, dist, v3 } from './frame';
import { boxCenter, boxOf, translate } from './collision';
import { damagePlayer } from './damage';

const PHASE_ANCHOR: Record<number, string> = { 1: 'anchor-keeper-left', 2: 'anchor-panel', 3: 'anchor-keeper-right' };

export function keeperMachine(c: Ctx) {
  return c.s.machines.find((x) => x.kind === 'keeper');
}

export function exposeWindow(c: Ctx): number {
  return c.s.assist.extendedExposure ? RULES.keeper.exposeTicksAssist : RULES.keeper.exposeTicks;
}

export function exposeSeal(c: Ctx, cause: string): void {
  const k = c.s.keeper;
  k.sealExposedTicks = exposeWindow(c);
  emit(c, 'SealExposed', 'keeper', { phase: k.phase, cause, ticks: k.sealExposedTicks });
}

export function lowerRouteDone(c: Ctx): boolean {
  return c.m.geometry.interactables.filter((i) => i.kind === 'valve').every((v) => c.s.puzzles[v.key] === 1);
}

/** Enter-arena trigger: engage phase one exactly once. */
export function engageKeeper(c: Ctx): void {
  const { s } = c;
  if (s.keeper.phase !== 0) return;
  const km = keeperMachine(c);
  s.keeper.phase = 1;
  s.keeper.surgeIntervalTicks = lowerRouteDone(c) ? RULES.keeper.surgeIntervalLower : RULES.keeper.surgeInterval;
  s.keeper.surgeTimerTicks = s.keeper.surgeIntervalTicks;
  s.keeper.freeStunAvailable = s.player.overdrive > 0;
  if (km) {
    km.active = true;
    km.mode = 'patrol';
    emit(c, 'MachineWoke', km.key, { phase: 1 });
  }
}

export function onKeeperAnchorShift(c: Ctx, anchorKey: string): void {
  const k = c.s.keeper;
  if (k.phase < 1 || k.phase > 3 || PHASE_ANCHOR[k.phase] !== anchorKey) return;
  if (k.phase === 3) {
    const km = keeperMachine(c);
    if (km) {
      km.mode = 'pinned';
      km.modeTicks = RULES.keeper.pinTicks;
      emit(c, 'MachinePinned', km.key, { cause: 'gravity-shift', ticks: km.modeTicks });
    }
  }
  exposeSeal(c, anchorKey);
}

/** Overdrive cell: one free keeper stun through the shield. Returns true when used. */
export function tryOverdriveStun(c: Ctx): boolean {
  const { s } = c;
  const k = s.keeper;
  const km = keeperMachine(c);
  if (!km || s.player.overdrive <= 0 || k.phase < 1 || k.phase > 3 || k.sealExposedTicks > 0) return false;
  if (dist(bodyCenter(s.player.pos, s.player.up), km.pos) > RULES.overdriveRange) return false;
  s.player.overdrive -= 1;
  k.freeStunAvailable = s.player.overdrive > 0;
  emit(c, 'MachineStunned', km.key, { cause: 'overdrive' });
  exposeSeal(c, 'overdrive');
  return true;
}

export function breakSeal(c: Ctx): void {
  const { m, s } = c;
  const k = s.keeper;
  k.sealsRemaining -= 1;
  k.sealExposedTicks = 0;
  const n = RULES.keeper.seals - k.sealsRemaining;
  emit(c, 'SealBroken', `seal-${n}`, { remaining: k.sealsRemaining });
  const km = keeperMachine(c);
  if (k.sealsRemaining <= 0) {
    k.phase = 4;
    k.surgeTimerTicks = 0;
    if (km) {
      km.mode = 'disabled';
      km.health = 0;
      emit(c, 'MachineDisabled', km.key, { cause: 'seals' });
    }
    for (const x of s.machines) {
      if (x.kind !== 'keeper' && x.active && x.mode !== 'disabled' && m.geometry.machines.find((d) => d.key === x.key)?.beat === 'keeper-arena') {
        x.mode = 'disabled';
        emit(c, 'MachineDisabled', x.key, { cause: 'lock-released' });
      }
    }
    emit(c, 'KeeperDisabled', 'keeper', {});
    cue(c, 'keeper-disabled');
  } else {
    k.phase = (k.phase + 1) as 2 | 3;
    if (km) {
      km.health = k.sealsRemaining;
      km.mode = k.phase === 3 ? 'telegraph' : 'patrol';
      km.modeTicks = k.phase === 3 ? RULES.keeper.chargeWindup : 0;
    }
    cue(c, `seal-${n}`);
    if (k.phase === 2) {
      for (const x of s.machines) {
        const def = m.geometry.machines.find((d) => d.key === x.key);
        if (def && def.beat === 'keeper-arena' && def.kind !== 'keeper' && !x.active) {
          x.active = true;
          emit(c, 'MachineWoke', x.key, { cause: 'reinforcement' });
        }
      }
    }
  }
  emit(c, 'CheckpointReached', s.checkpointKey, { seal: n });
}

function inCover(c: Ctx): boolean {
  const ddef = c.m.geometry.dynamics.find((d) => d.key === 'panel');
  const dyn = c.s.dynamics.find((d) => d.key === 'panel');
  if (!ddef || !dyn) return false;
  const center = boxCenter(translate(boxOf(ddef.box), dyn.offset));
  const p = c.s.player.pos;
  return Math.hypot(p[0] - center[0], p[2] - center[2]) <= RULES.keeper.coverRadius && p[1] < center[1] + 2;
}

export function tickKeeper(c: Ctx): void {
  const { s } = c;
  const k = s.keeper;
  if (k.phase < 1 || k.phase > 3) return;
  const km = keeperMachine(c);
  if (k.sealExposedTicks > 0) k.sealExposedTicks -= 1;
  if (km) {
    if (km.mode === 'pinned') {
      km.modeTicks -= 1;
      if (km.modeTicks <= 0) { km.mode = k.phase === 3 ? 'telegraph' : 'patrol'; km.modeTicks = RULES.keeper.chargeWindup; }
    } else if (k.phase === 3) {
      km.mode = 'telegraph';
      km.modeTicks -= 1;
      if (km.modeTicks <= 0) {
        km.modeTicks = RULES.keeper.chargeWindup;
        if (s.beat === 'keeper-arena' && dist(bodyCenter(s.player.pos, s.player.up), v3(km.pos)) <= RULES.keeper.chargeRange) {
          damagePlayer(c, RULES.keeper.chargeDamage, 'keeper-charge');
        }
      }
    }
  }
  k.surgeTimerTicks -= 1;
  if (k.surgeTimerTicks === RULES.keeper.surgeTelegraph) {
    emit(c, 'SurgeTelegraph', 'surge', { ticks: RULES.keeper.surgeTelegraph });
  }
  if (k.surgeTimerTicks <= 0) {
    k.surgeTimerTicks = k.surgeIntervalTicks;
    const hit = s.beat === 'keeper-arena' && s.player.grounded && !inCover(c);
    emit(c, 'Surge', 'surge', { hit });
    if (hit) damagePlayer(c, RULES.keeper.surgeDamage, 'surge');
  }
}

export { PHASE_ANCHOR };
