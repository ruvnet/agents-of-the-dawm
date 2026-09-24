/**
 * Beats, route choice, checkpoints, interactables, pickups, dynamics, falls and scripted cues.
 */
import type { InputCommand } from '../contracts/input';
import type { BeatId, TriggerDef } from '../contracts/manifest';
import { PLAYER_MAX_CHARGE } from '../contracts/sim';
import type { Ctx } from './ctx';
import { RULES, cue, cueFired, emit, once } from './ctx';
import { bodyCenter, contains, dist, len, sub, v3 } from './frame';
import type { V3 } from './frame';
import { engageKeeper } from './keeper';
import { machineInitial } from './state';

const OBJECTIVE: Record<BeatId, string> = {
  'west-approach': 'reach-inspection-anchor',
  'inspection-wall': 'shift-and-climb',
  'maintenance-deck': 'disable-skimmers',
  'floating-gantry': 'bridge-gap-and-inspect-marker',
  'junction': 'choose-route',
  'upper-lattice': 'cross-lattice',
  'lower-conduit': 'redirect-conduit-flow',
  'keeper-arena': 'expose-three-seals',
  'control-room': 'verify-and-authorize',
};

export function updateZone(c: Ctx): void {
  const { m, s } = c;
  const z = m.geometry.zones.find((zz) => contains(zz.box, s.player.pos));
  if (!z || z.beat === s.beat) return;
  s.beat = z.beat;
  emit(c, 'BeatEntered', z.beat, { zone: z.key });
  if (once(s, `objective:${z.beat}`)) emit(c, 'ObjectiveChanged', OBJECTIVE[z.beat], { beat: z.beat });
}

function chooseBranch(c: Ctx, branch: 'upper' | 'lower'): void {
  const { m, s } = c;
  if (s.branch === branch || s.puzzles['route-locked'] === 1) return;
  s.branch = branch;
  s.machines = s.machines.map((ms) => {
    const def = m.geometry.machines.find((d) => d.key === ms.key);
    if (!def?.branch || ms.mode === 'disabled') return ms;
    return def.branch === branch ? { ...machineInitial(def), active: true } : { ...ms, active: false };
  });
  emit(c, 'RouteChosen', branch, { backtrack: s.fired.includes('route-chosen') });
  once(s, 'route-chosen');
  cue(c, `choose-${branch}`);
}

function lockRoute(c: Ctx, why: string): void {
  if (c.s.branch === 'none' || c.s.puzzles['route-locked'] === 1) return;
  c.s.puzzles['route-locked'] = 1;
  emit(c, 'PuzzleChanged', 'route-locked', { branch: c.s.branch, why });
}

function fireTrigger(c: Ctx, t: TriggerDef): void {
  const s = c.s;
  switch (t.event) {
    case 'enter-junction':
      if (once(s, 'trigger:enter-junction')) cue(c, 'enter-junction');
      break;
    case 'choose-upper': chooseBranch(c, 'upper'); break;
    case 'choose-lower': chooseBranch(c, 'lower'); break;
    case 'route-midpoint':
      if (once(s, `trigger:${t.key}`)) lockRoute(c, 'midpoint');
      break;
    case 'converge':
      if (s.branch !== 'none' && once(s, 'trigger:converge')) {
        lockRoute(c, 'converge');
        emit(c, 'PuzzleChanged', 'converged', { branch: s.branch });
        cue(c, `clear-${s.branch}`);
      }
      break;
    case 'enter-arena':
      if (s.keeper.phase === 0) {
        engageKeeper(c);
        cue(c, 'enter-arena');
      }
      break;
  }
}

export function updateTriggers(c: Ctx): void {
  const { m, s } = c;
  for (const t of m.geometry.triggers) if (contains(t.box, s.player.pos)) fireTrigger(c, t);
  if (s.branch !== 'none' && s.puzzles['route-locked'] !== 1) {
    const engaged = s.machines.some((ms) => {
      const def = m.geometry.machines.find((d) => d.key === ms.key);
      return def?.branch === s.branch && ms.active && (ms.mode === 'stunned' || ms.mode === 'pinned' || ms.mode === 'disabled');
    });
    if (engaged) lockRoute(c, 'first-challenge');
  }
  const cps = m.geometry.checkpoints;
  const cur = cps.findIndex((cp) => cp.key === s.checkpointKey);
  for (let i = cur + 1; i < cps.length; i++) {
    const cp = cps[i]!;
    if (!contains(cp.trigger, s.player.pos)) continue;
    if (cp.beat === 'control-room' && s.keeper.phase !== 4) continue;
    s.checkpointKey = cp.key;
    emit(c, 'CheckpointReached', cp.key, { beat: cp.beat });
    break;
  }
}

export function actuateValve(c: Ctx, key: string, cause: string): void {
  const { m, s } = c;
  if (s.puzzles[key] === 1) return;
  s.puzzles[key] = 1;
  emit(c, 'PuzzleChanged', key, { value: 1, cause });
  lockRoute(c, 'valve');
  const valves = m.geometry.interactables.filter((i) => i.kind === 'valve');
  if (valves.every((v) => s.puzzles[v.key] === 1) && once(s, 'conduit-flow')) {
    emit(c, 'PuzzleChanged', 'conduit-flow', { redirected: true });
    const dyn = s.dynamics.find((d) => d.key === 'conduit-platform');
    if (dyn) { dyn.pose = 1; dyn.moving = true; }
  }
}

function withinRadius(center: V3, pos: readonly number[], radius: number): boolean {
  return dist(center, v3([pos[0]!, pos[1]!, pos[2]!])) <= radius;
}

/** Interact with the nearest in-range interactable; proximity pickups; map auto-close. */
export function updateInteractables(c: Ctx, cmd: InputCommand): void {
  const { m, s } = c;
  const center = bodyCenter(s.player.pos, s.player.up);
  for (const it of m.geometry.interactables) {
    if (!withinRadius(center, it.pos, it.radius)) continue;
    if (it.kind === 'charge-cell') {
      const readyAt = s.puzzles[`cell:${it.key}`] ?? 0;
      if (c.tick >= readyAt && s.player.charge < PLAYER_MAX_CHARGE) {
        s.player.charge = PLAYER_MAX_CHARGE;
        s.puzzles[`cell:${it.key}`] = c.tick + RULES.cellRespawnTicks;
        emit(c, 'ChargeCollected', it.key, { charge: s.player.charge });
      }
    } else if (it.kind === 'overdrive-cell' && once(s, `pickup:${it.key}`)) {
      s.player.overdrive += 1;
      s.keeper.freeStunAvailable = true;
      emit(c, 'ChargeCollected', it.key, { overdrive: s.player.overdrive });
    }
  }
  const mapDef = m.geometry.interactables.find((i) => i.kind === 'pressure-map');
  if (mapDef && s.puzzles['map-open'] === 1 && !withinRadius(center, mapDef.pos, mapDef.radius)) closeMap(c);
  if (!cmd.interact) return;
  let best: (typeof m.geometry.interactables)[number] | null = null;
  let bestD = Infinity;
  for (const it of m.geometry.interactables) {
    if (it.kind === 'charge-cell' || it.kind === 'overdrive-cell') continue;
    const d = dist(center, v3(it.pos));
    if (d <= it.radius && d < bestD) { best = it; bestD = d; }
  }
  if (!best) return;
  switch (best.kind) {
    case 'pressure-map':
      if (s.puzzles['map-open'] === 1) closeMap(c);
      else {
        s.puzzles['map-open'] = 1;
        emit(c, 'MapInspected', best.key, { reliefOutline: 'unconnected' });
        cue(c, 'map-inspected');
      }
      break;
    case 'channel-marker':
      if (s.puzzles['gantry-settled'] === 1 && !s.flags.channelLocated) {
        s.flags.channelLocated = true;
        emit(c, 'ChannelLocated', 'channel-marker', { subject: 'relief-channel' });
        cue(c, 'channel-marker');
      }
      break;
    case 'valve':
      actuateValve(c, best.key, 'interact');
      break;
    default:
      break;
  }
}

function closeMap(c: Ctx): void {
  c.s.puzzles['map-open'] = 0;
  emit(c, 'PuzzleChanged', 'pressure-map', { open: false });
  cue(c, 'map-closed');
}

export function tickDynamics(c: Ctx): void {
  const { m, s } = c;
  for (const d of s.dynamics) {
    if (!d.moving) continue;
    const def = m.geometry.dynamics.find((x) => x.key === d.key);
    const target = def?.poses[d.pose];
    if (!def || !target) { d.moving = false; continue; }
    const delta = sub(target, d.offset);
    const l = len(delta);
    const step = RULES.dynamicSpeed * RULES.dt;
    if (l <= step) {
      d.offset = v3(target);
      d.moving = false;
      emit(c, 'DynamicMoved', d.key, { pose: d.pose });
      if (def.kind === 'gantry' && d.pose === 1 && once(s, 'gantry-settled')) {
        s.puzzles['gantry-settled'] = 1;
        cue(c, 'gantry-settled');
      }
    } else {
      d.offset = [d.offset[0] + delta[0] * step / l, d.offset[1] + delta[1] * step / l, d.offset[2] + delta[2] * step / l];
    }
  }
}

/** Returns the kill volume key the player body centre entered, if any. */
export function killVolumeHit(c: Ctx): string | null {
  const center = bodyCenter(c.s.player.pos, c.s.player.up);
  return c.m.geometry.killVolumes.find((k) => contains(k.box, center))?.key ?? null;
}

export function scriptedCues(c: Ctx, cmd: InputCommand): void {
  const { m, s } = c;
  const p = s.player;
  if (cmd.move2[0] !== 0 || cmd.move2[1] !== 0) cue(c, 'first-move');
  if (cueFired(s, 'first-move') && dist(p.pos, m.geometry.spawn.feet) >= RULES.tramInViewDistance) cue(c, 'tram-in-view');
  if (cueFired(s, 'first-shift') && p.up === '-z' && p.grounded && p.pos[1] >= 3) cue(c, 'begin-wall-walk');
}
