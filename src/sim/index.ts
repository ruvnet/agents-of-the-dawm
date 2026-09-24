/**
 * Authoritative deterministic simulation for the Floodline vertical slice (ADR 0003/0004).
 *
 * Tick semantics: `step(cmd)` accepts only `cmd.tick === state.tick` (else returns [] and changes
 * nothing). Every accepted command advances `tick` by exactly one. `cmd.pause` is a level, not a
 * toggle: while it is true the tick still advances (so an input stream stays dense and replayable)
 * but no game action happens: no movement, timers, AI, damage, pickups or story changes.
 * Each tick works on a structured clone, so a state returned by `state()` is never mutated later.
 * No wall clock, no Math.random, no DOM; the only randomness is the seeded mulberry32 in `rngState`.
 */
import type { InputCommand, ControlAction } from '../contracts/input';
import { MAX_LOOK } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import { DESTINATIONS } from '../contracts/pressure';
import type { CreateSimulation, SimOptions, SimSnapshot, SimState, Simulation, WorldEvent } from '../contracts/sim';
import { canonicalHash } from '../contracts/hash';
import type { Ctx } from './ctx';
import { RULES, emit } from './ctx';
import { bodyCenter, clamp } from './frame';
import { applyRetry, createInitialState, checkpointPose, placePlayer } from './state';
import { applyLook, movePlayer } from './player';
import { requestShift, updateAnchorPresence } from './anchors';
import { tickMachines, usePulse, useSpike } from './combat';
import { tickKeeper } from './keeper';
import { killVolumeHit, scriptedCues, tickDynamics, updateInteractables, updateTriggers, updateZone } from './progress';
import { applyControl, nearControlScreen, pressureView, tickEpilogue } from './story';

const CONTROL_KINDS = new Set(['open-panel', 'close-panel', 'scan-sensor', 'preview', 'restore-edge', 'authorize']);

const num = (n: unknown, lo: number, hi: number): number =>
  (typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : 0);

/** Validate and bound an untrusted command (ADR 0004: validate tick order and input bounds). */
export function sanitizeCommand(cmd: InputCommand): InputCommand {
  const mv = Array.isArray(cmd.move2) ? cmd.move2 : [0, 0];
  const lk = Array.isArray(cmd.look2) ? cmd.look2 : [0, 0];
  let control: ControlAction | null = null;
  const ca = cmd.control as ControlAction | null | undefined;
  if (ca && typeof ca === 'object' && CONTROL_KINDS.has(ca.kind)) {
    if (ca.kind === 'preview' || ca.kind === 'authorize') {
      if (DESTINATIONS.includes(ca.destination)) control = { kind: ca.kind, destination: ca.destination };
    } else control = { kind: ca.kind } as ControlAction;
  }
  return {
    tick: cmd.tick,
    move2: [num(mv[0], -1, 1), num(mv[1], -1, 1)],
    look2: [num(lk[0], -MAX_LOOK, MAX_LOOK), num(lk[1], -MAX_LOOK, MAX_LOOK)],
    jump: cmd.jump === true,
    pulse: cmd.pulse === true,
    spike: cmd.spike === true,
    shiftAnchorId: typeof cmd.shiftAnchorId === 'string' && cmd.shiftAnchorId.length > 0 ? cmd.shiftAnchorId.slice(0, 64) : null,
    interact: cmd.interact === true,
    pause: cmd.pause === true,
    control,
  };
}

function handleFall(c: Ctx, volume: string): void {
  const { m, s } = c;
  const dmg = s.assist.halfDamage ? RULES.fallDamage / 2 : RULES.fallDamage;
  s.player.health = Math.max(0, s.player.health - dmg);
  emit(c, 'PlayerFell', volume, { damage: dmg, health: s.player.health, checkpoint: s.checkpointKey });
  placePlayer(m, s, checkpointPose(m, s));
  s.player.invulnerableTicks = RULES.invulnerableTicks;
  if (s.player.health > 0) emit(c, 'PlayerRespawned', s.checkpointKey, { reason: 'fall', health: s.player.health });
}

function gameTick(c: Ctx, cmd: InputCommand): void {
  const s = c.s;
  const p = s.player;
  applyLook(c, cmd);
  updateAnchorPresence(c);
  if (cmd.shiftAnchorId) requestShift(c, cmd.shiftAnchorId);
  movePlayer(c, cmd);
  const kv = killVolumeHit(c);
  if (kv) handleFall(c, kv);
  updateAnchorPresence(c);
  updateZone(c);
  updateTriggers(c);
  updateInteractables(c, cmd);
  if (cmd.control) applyControl(c, cmd.control, nearControlScreen(c, bodyCenter(p.pos, p.up)));
  if (s.pressure.panelOpen && !nearControlScreen(c, bodyCenter(p.pos, p.up))) {
    s.pressure.panelOpen = false;
    emit(c, 'PanelClosed', 'control-screen', { reason: 'left-screen' });
  }
  if (p.toolCooldown > 0) p.toolCooldown -= 1;
  if (cmd.pulse) usePulse(c);
  else if (cmd.spike) useSpike(c);
  tickMachines(c);
  tickKeeper(c);
  tickDynamics(c);
  tickEpilogue(c);
  scriptedCues(c, cmd);
  if (p.invulnerableTicks > 0) p.invulnerableTicks -= 1;
  if (p.health <= 0) {
    emit(c, 'PlayerDefeated', s.checkpointKey, { beat: s.beat, keeperPhase: s.keeper.phase });
    applyRetry(c, 'defeated');
  }
}

export const createSimulation: CreateSimulation = (manifest: LevelManifest, options: SimOptions): Simulation => {
  let cur: SimState = createInitialState(manifest, options);
  let log: WorldEvent[] = [];

  return {
    manifest,
    state: () => cur,
    step(raw: InputCommand): readonly WorldEvent[] {
      if (!raw || raw.tick !== cur.tick) return [];
      const cmd = sanitizeCommand(raw);
      const next = structuredClone(cur);
      const c: Ctx = { m: manifest, s: next, tick: next.tick, events: [] };
      next.paused = cmd.pause;
      if (!next.paused) gameTick(c, cmd);
      next.tick += 1;
      cur = next;
      if (c.events.length) log = log.concat(c.events);
      return c.events;
    },
    eventLog: () => log,
    snapshot: (): SimSnapshot => ({ version: 1, state: structuredClone(cur), eventCount: log.length }),
    restore(snap: SimSnapshot): void {
      if (!snap || snap.version !== 1 || snap.state?.version !== 1) throw new Error('restore: unsupported snapshot');
      cur = structuredClone(snap.state);
      if (log.length > snap.eventCount) log = log.slice(0, snap.eventCount);
    },
    restartFromCheckpoint(): void {
      const next = structuredClone(cur);
      const c: Ctx = { m: manifest, s: next, tick: next.tick, events: [] };
      applyRetry(c, 'manual');
      cur = next;
      log = log.concat(c.events);
    },
    hash: () => canonicalHash(cur),
    pressureView: () => pressureView(manifest, cur),
  };
};

export { surfaceBasis, bodyBox, bodyCenter } from './frame';
export { RULES } from './ctx';
export { pressureView } from './story';
