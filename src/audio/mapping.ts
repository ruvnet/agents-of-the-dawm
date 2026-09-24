/**
 * Pure event -> sound and event -> music-stem logic. No Web Audio here, so all of it is unit tested.
 */
import type { MusicStem, SoundEventId } from '../contracts/audio';
import type { WorldEvent } from '../contracts/sim';
import { dialogueEn, type DialogueFixture } from '../contracts/fixtures';
import { captionDurationMs } from '../narrative';

export interface SoundTrigger {
  readonly id: SoundEventId;
  /** Playback-rate multiplier (1 = authored pitch). Used as a direction cue for shifts. */
  readonly rate: number;
}

/**
 * Orientation chime pitch per landing axis, so each shift is audible as a direction even with
 * camera roll disabled (script: "Each shift gives an audio direction cue").
 */
export const AXIS_RATE: Readonly<Record<string, number>> = {
  '+y': 1, '-y': 0.75, '+x': 1.125, '-x': 0.84, '+z': 1.26, '-z': 0.94,
};

const BEAT_AMBIENCE: Readonly<Record<string, SoundEventId>> = {
  'west-approach': 'surf',
  'maintenance-deck': 'pump-hum',
  'lower-conduit': 'pump-hum',
  'control-room': 'pump-hum',
};

const one = (id: SoundEventId, rate = 1): SoundTrigger[] => [{ id, rate }];

/** Map one simulation event to zero or more synthesized one-shots. */
export function soundsForEvent(e: WorldEvent): SoundTrigger[] {
  switch (e.type) {
    case 'ShiftCommitted': {
      const to = typeof e.payload.to === 'string' ? e.payload.to : '+y';
      const out = one('orientation-chime', AXIS_RATE[to] ?? 1);
      if (e.payload.target !== undefined && e.payload.target !== 'player') out.push({ id: 'gantry-strain', rate: 1 });
      return out;
    }
    case 'ShiftRejected': return one('shift-reject');
    case 'SurgeTelegraph': return one('warning-horn');
    case 'Surge': return one('water-surge');
    case 'TramCrossed': return one('tram-bell');
    case 'PlayerFell': return one('underwater-fall');
    case 'PlayerDamaged': return one('damage');
    case 'ToolPulse': return one('pulse');
    case 'ToolSpike': return one('spike');
    case 'SealBroken': return one('seal-break');
    case 'MachineStunned':
    case 'MachineWoke':
    case 'MachinePinned': return one('machine-servo');
    case 'ChargeCollected': return one('pickup');
    case 'TransferRejected': return one('ui-reject');
    case 'GateOpened': return one('gate-open');
    case 'DynamicMoved': return one('gantry-strain', 0.9);
    case 'PanelOpened':
    case 'SensorVerified':
    case 'PreviewShown':
    case 'EdgeRestored':
    case 'TransferAuthorized':
    case 'MapInspected':
    case 'ChannelLocated': return one('ui-confirm');
    case 'PuzzleChanged': return e.key === 'conduit-flow' ? one('water-surge', 1.2) : [];
    case 'BeatEntered': {
      const amb = BEAT_AMBIENCE[e.key];
      return amb ? one(amb) : [];
    }
    case 'DialogueCue': return e.key === 'tram-in-view' ? one('tram-bell', 0.85) : [];
    default: return [];
  }
}

export const MIN_REPEAT_SEC = 0.06;
export const MAX_ONE_SHOTS_PER_BATCH = 8;

/**
 * Voice limiting: drop exact repeats of the same sound within MIN_REPEAT_SEC and cap one batch.
 * `lastStart` is mutated with the start time of each admitted sound.
 */
export function admitSounds(
  triggers: readonly SoundTrigger[], lastStart: Map<SoundEventId, number>, nowSec: number,
): SoundTrigger[] {
  const out: SoundTrigger[] = [];
  for (const tr of triggers) {
    if (out.length >= MAX_ONE_SHOTS_PER_BATCH) break;
    const prev = lastStart.get(tr.id);
    if (prev !== undefined && nowSec - prev < MIN_REPEAT_SEC) continue;
    lastStart.set(tr.id, nowSec);
    out.push(tr);
  }
  return out;
}

// ------------------------------------------------------------------------------------ music

export interface MusicState {
  /** Machines that woke and are not yet disabled. Sorted. */
  readonly awake: readonly string[];
  readonly keeperEngaged: boolean;
  readonly released: boolean;
}

export const INITIAL_MUSIC: MusicState = { awake: [], keeperEngaged: false, released: false };

/** Fold events into the music state (pure). */
export function reduceMusic(state: MusicState, events: readonly WorldEvent[]): MusicState {
  let awake = new Set(state.awake);
  let keeper = state.keeperEngaged;
  let released = state.released;
  for (const e of events) {
    switch (e.type) {
      case 'MachineWoke': awake.add(e.key); break;
      case 'MachineDisabled': awake.delete(e.key); break;
      case 'PlayerRespawned':
        // A retry returns undisabled machines to their start; they wake again on contact.
        if (e.payload.reason !== 'fall') awake = new Set();
        break;
      case 'SealExposed':
      case 'SurgeTelegraph': keeper = true; break;
      case 'DialogueCue': if (e.key === 'enter-arena') keeper = true; break;
      case 'KeeperDisabled': keeper = false; awake = new Set(); break;
      case 'TransferAuthorized':
      case 'GateOpened':
      case 'TramCrossed': released = true; break;
      default: break;
    }
  }
  return { awake: [...awake].sort(), keeperEngaged: keeper, released };
}

export function stemFor(state: MusicState): MusicStem {
  if (state.released) return 'release';
  if (state.keeperEngaged || state.awake.length > 0) return 'encounter';
  return 'explore';
}

// ------------------------------------------------------------------------------------ ducking

/**
 * How long to duck music for the spoken lines these events trigger (sum of caption durations).
 * Branch variants share no trigger with each other, so no branch filter is needed here.
 */
export function duckMsForEvents(events: readonly WorldEvent[], fixture: DialogueFixture = dialogueEn): number {
  let ms = 0;
  for (const e of events) {
    if (e.type !== 'DialogueCue') continue;
    for (const l of fixture.lines) if (l.trigger === `DialogueCue:${e.key}` && !l.display) ms += captionDurationMs(l.text);
  }
  return ms;
}
