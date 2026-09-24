/**
 * Rescue tools and maintenance machines. Deterministic, explainable rules:
 * - Pulse (no charge, short range) wakes and stuns every machine in range for 3 s.
 * - Spike (1 charge, only spent on a hit) breaks an exposed keeper seal, else pins the nearest stunned
 *   machine for 5 s, else actuates the nearest marked mechanism (valve). A pinned machine whose
 *   integrity reaches zero powers down (disabled, amber light) when the pin ends. Never killed.
 * - Machines wake on proximity or a Pulse, chase inside their own beat, telegraph, then strike once.
 */
import type { MachineDef } from '../contracts/manifest';
import type { MachineState } from '../contracts/sim';
import type { Ctx } from './ctx';
import { RULES, cue, emit } from './ctx';
import type { V3 } from './frame';
import { add, axisToVecV, bodyCenter, dist, len, scale, sub, tangential, v3 } from './frame';
import { damagePlayer } from './damage';
import { breakSeal, keeperMachine, tryOverdriveStun } from './keeper';
import { actuateValve } from './progress';

function machineCenter(ms: MachineState): V3 {
  return add(ms.pos, scale(axisToVecV(ms.up), 0.5));
}

function nextRandom(c: Ctx): number {
  const t = (c.s.rngState + 0x6d2b79f5) >>> 0;
  c.s.rngState = t;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

const defOf = (c: Ctx, key: string): MachineDef | undefined => c.m.geometry.machines.find((d) => d.key === key);

function wake(c: Ctx, ms: MachineState, cause: string): void {
  ms.mode = 'patrol';
  ms.modeTicks = 0;
  emit(c, 'MachineWoke', ms.key, { cause });
  if (ms.kind === 'skimmer') cue(c, 'first-skimmer-wakes');
}

function targetable(ms: MachineState): boolean {
  return ms.active && ms.kind !== 'keeper' && ms.mode !== 'disabled';
}

export function usePulse(c: Ctx): void {
  const { s } = c;
  const p = s.player;
  if (p.toolCooldown > 0) return;
  p.toolCooldown = RULES.toolCooldown;
  const center = bodyCenter(p.pos, p.up);
  const range = s.assist.aimAssist ? RULES.pulseRangeAssist : RULES.pulseRange;
  let hits = 0;
  for (const ms of s.machines) {
    if (!targetable(ms) || ms.mode === 'pinned') continue;
    if (dist(center, machineCenter(ms)) > range) continue;
    if (ms.mode === 'dormant') wake(c, ms, 'pulse');
    ms.mode = 'stunned';
    ms.modeTicks = RULES.stunTicks;
    hits += 1;
    emit(c, 'MachineStunned', ms.key, { cause: 'pulse', ticks: RULES.stunTicks });
  }
  const overdrive = tryOverdriveStun(c);
  emit(c, 'ToolPulse', 'player', { hits, overdrive });
}

export function useSpike(c: Ctx): void {
  const { s } = c;
  const p = s.player;
  if (p.toolCooldown > 0) return;
  p.toolCooldown = RULES.toolCooldown;
  if (p.charge < 1) { emit(c, 'ToolSpike', 'player', { hit: false, reason: 'no-charge' }); return; }
  const center = bodyCenter(p.pos, p.up);
  const km = keeperMachine(c);
  if (km && s.keeper.sealExposedTicks > 0 && s.keeper.phase >= 1 && s.keeper.phase <= 3
    && dist(center, machineCenter(km)) <= RULES.keeperSpikeRange) {
    p.charge -= 1;
    emit(c, 'ToolSpike', km.key, { hit: true, target: 'seal' });
    breakSeal(c);
    return;
  }
  const range = s.assist.aimAssist ? RULES.spikeRangeAssist : RULES.spikeRange;
  let best: MachineState | null = null;
  let bestD = Infinity;
  for (const ms of s.machines) {
    if (!targetable(ms) || ms.mode !== 'stunned') continue;
    const d = dist(center, machineCenter(ms));
    if (d <= range && d < bestD) { best = ms; bestD = d; }
  }
  if (best) {
    p.charge -= 1;
    best.health -= 1;
    best.mode = 'pinned';
    best.modeTicks = RULES.pinTicks;
    emit(c, 'ToolSpike', best.key, { hit: true, target: 'machine' });
    emit(c, 'MachinePinned', best.key, { ticks: RULES.pinTicks, integrity: best.health });
    return;
  }
  let valve: string | null = null;
  let valveD = Infinity;
  for (const it of c.m.geometry.interactables) {
    if (it.kind !== 'valve' || s.puzzles[it.key] === 1) continue;
    const d = dist(center, it.pos);
    if (d <= range && d < valveD) { valve = it.key; valveD = d; }
  }
  if (valve) {
    p.charge -= 1;
    emit(c, 'ToolSpike', valve, { hit: true, target: 'mechanism' });
    actuateValve(c, valve, 'spike');
    return;
  }
  emit(c, 'ToolSpike', 'player', { hit: false, reason: 'no-target' });
}

function disable(c: Ctx, ms: MachineState): void {
  ms.mode = 'disabled';
  ms.modeTicks = 0;
  emit(c, 'MachineDisabled', ms.key, { cause: 'pin' });
  if (ms.kind === 'skimmer') cue(c, 'first-skimmer-disabled');
  const deck = c.m.geometry.machines.filter((d) => d.beat === 'maintenance-deck');
  if (deck.length && deck.every((d) => c.s.machines.find((x) => x.key === d.key)?.mode === 'disabled')) cue(c, 'deck-cleared');
}

function moveToward(ms: MachineState, target: V3, speed: number): number {
  const delta = tangential(sub(target, ms.pos), ms.up);
  const d = len(delta);
  const step = speed * RULES.dt;
  ms.pos = d <= step ? add(ms.pos, delta) : add(ms.pos, scale(delta, step / d));
  return Math.max(0, d - step);
}

export function tickMachines(c: Ctx): void {
  const { s } = c;
  const center = bodyCenter(s.player.pos, s.player.up);
  for (const ms of s.machines) {
    if (!ms.active || ms.kind === 'keeper' || ms.mode === 'disabled') continue;
    const def = defOf(c, ms.key);
    if (!def) continue;
    const r = RULES.machine[ms.kind === 'hauler' ? 'hauler' : 'skimmer'];
    const d = dist(center, machineCenter(ms));
    const sameBeat = s.beat === def.beat;
    switch (ms.mode) {
      case 'dormant':
        if (sameBeat && d <= r.wake) wake(c, ms, 'proximity');
        break;
      case 'stunned':
        if (--ms.modeTicks <= 0) { ms.mode = 'patrol'; ms.modeTicks = r.recover; }
        break;
      case 'pinned':
        if (--ms.modeTicks <= 0) {
          if (ms.health <= 0) disable(c, ms);
          else { ms.mode = 'patrol'; ms.modeTicks = r.recover; }
        }
        break;
      case 'telegraph':
        if (--ms.modeTicks <= 0) {
          ms.mode = 'attack';
          ms.modeTicks = r.recover;
          if (d <= r.attackRange + 0.6) damagePlayer(c, r.damage, ms.key);
        }
        break;
      case 'attack':
        if (--ms.modeTicks <= 0) { ms.mode = 'patrol'; ms.modeTicks = 0; }
        break;
      case 'patrol': {
        if (ms.modeTicks > 0) { ms.modeTicks -= 1; break; }
        if (sameBeat && d <= r.aggro && s.player.health > 0) {
          const remaining = moveToward(ms, v3(s.player.pos), r.speed);
          if (remaining <= r.attackRange) { ms.mode = 'telegraph'; ms.modeTicks = r.windup; }
          break;
        }
        const pts = def.patrol;
        if (!pts || pts.length === 0) break;
        const target = pts[ms.patrolIndex % pts.length]!;
        if (moveToward(ms, v3(target), r.speed) <= 1e-6) {
          ms.patrolIndex = (ms.patrolIndex + 1) % pts.length;
          ms.modeTicks = 10 + Math.floor(nextRandom(c) * 20);
        }
        break;
      }
    }
  }
}
