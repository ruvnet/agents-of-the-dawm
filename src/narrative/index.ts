/**
 * Narrative director (W5): maps simulation WorldEvents to caption cues from the dialogue fixture.
 *
 * Rules (docs/creative/vertical-slice-script.md):
 * - A line fires when an event matches its trigger `${type}:${key}`; fixture cues may use `${type}:*`.
 * - `once` lines never repeat, including after checkpoint retries or snapshot restores; `reset(played)`
 *   restores the played set from a save (see `playedFromState`).
 * - Branch lines (S16U/S16L, S17U/S17L) play only for the chosen branch.
 * - `after` is respected: a line whose prerequisite has not played waits in a queue and is released,
 *   in order, as soon as the prerequisite plays (S14 after S13, D01 after S28, S31 after S30), even
 *   when both arrive in the same tick.
 * - Non-speech cues become CaptionCues with `speaker: null` and are not once-only.
 * - Pure and deterministic: no wall clock, no randomness; durations derive from text length.
 */
import type { CaptionCue, DialogueLine, NarrativeDirector } from '../contracts/narrative';
import type { SimState, WorldEvent } from '../contracts/sim';
import { dialogueEn, type DialogueFixture } from '../contracts/fixtures';
import { t, type LocaleId } from './strings';

export { objectiveFor, objectiveKeyFor } from './objectives';
export { t, BUNDLES, EN_BUNDLE, FR_CA_BUNDLE, OBJECTIVE_KEYS, buildEnglishBundle } from './strings';
export type { LocaleId, ObjectiveKey, StringBundle } from './strings';

export type Branch = 'none' | 'upper' | 'lower';

export const CAPTION_MIN_MS = 1500;
export const CAPTION_MAX_MS = 9000;
/** Reading-time model: a base hold plus ~15 characters per second. */
export const CAPTION_BASE_MS = 1000;
export const CAPTION_MS_PER_CHAR = 65;

/** Caption hold time from text length, clamped to a readable range. Pure. */
export function captionDurationMs(text: string): number {
  const ms = CAPTION_BASE_MS + text.length * CAPTION_MS_PER_CHAR;
  return Math.min(CAPTION_MAX_MS, Math.max(CAPTION_MIN_MS, Math.round(ms)));
}

export interface DirectorOptions {
  readonly locale?: LocaleId;
}

export interface FloodlineNarrativeDirector extends NarrativeDirector {
  /** Line IDs waiting for their `after` prerequisite. */
  pending(): readonly string[];
}

const DIALOGUE_PREFIX = 'DialogueCue:';

function indexByTrigger<T extends { trigger: string }>(items: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const list = m.get(it.trigger);
    if (list) list.push(it);
    else m.set(it.trigger, [it]);
  }
  return m;
}

function matching<T>(index: Map<string, T[]>, e: WorldEvent): T[] {
  return [...(index.get(`${e.type}:${e.key}`) ?? []), ...(index.get(`${e.type}:*`) ?? [])];
}

export function createNarrativeDirector(
  fixture: DialogueFixture = dialogueEn,
  opts: DirectorOptions = {},
): FloodlineNarrativeDirector {
  const locale = opts.locale ?? 'en';
  const lineIndex = indexByTrigger(fixture.lines);
  const cueIndex = indexByTrigger(fixture.cues);
  const known = new Set(fixture.lines.map((l) => l.id));
  let played: string[] = [];
  let playedSet = new Set<string>();
  let queue: DialogueLine[] = [];
  let seenBranch: Branch = 'none';

  const text = (kind: 'line' | 'cue', id: string, fallback: string): string => {
    const s = t(`${kind}.${id}`, locale);
    return s === `${kind}.${id}` ? fallback : s;
  };

  const toCaption = (l: DialogueLine): CaptionCue => {
    const body = text('line', l.id, l.text);
    return { id: l.id, speaker: l.speaker, text: body, durationMs: captionDurationMs(body) };
  };

  function play(l: DialogueLine, out: CaptionCue[]): void {
    if (!playedSet.has(l.id)) {
      playedSet.add(l.id);
      played.push(l.id);
    }
    out.push(toCaption(l));
    releaseQueue(out);
  }

  function releaseQueue(out: CaptionCue[]): void {
    const ready = queue.find((q) => q.after === undefined || playedSet.has(q.after));
    if (!ready) return;
    queue = queue.filter((q) => q !== ready);
    play(ready, out);
  }

  function offer(l: DialogueLine, branch: Branch, out: CaptionCue[]): void {
    if (l.branch && l.branch !== branch) return;
    if (l.once && playedSet.has(l.id)) return;
    if (queue.includes(l)) return;
    if (l.after !== undefined && !playedSet.has(l.after)) {
      queue.push(l);
      return;
    }
    play(l, out);
  }

  return {
    consume(events: readonly WorldEvent[], branch: Branch): readonly CaptionCue[] {
      const out: CaptionCue[] = [];
      for (const e of events) {
        if (e.type === 'RouteChosen' && (e.key === 'upper' || e.key === 'lower')) seenBranch = e.key;
        const eff: Branch = branch !== 'none' ? branch : seenBranch;
        for (const c of matching(cueIndex, e)) {
          const body = text('cue', c.id, c.text);
          out.push({ id: `${c.id}:${e.id}`, speaker: null, text: body, durationMs: captionDurationMs(body) });
        }
        for (const l of matching(lineIndex, e)) offer(l, eff, out);
      }
      return out;
    },
    played: () => [...played],
    reset(ids: readonly string[]): void {
      played = [];
      playedSet = new Set();
      queue = [];
      seenBranch = 'none';
      for (const id of ids) {
        if (!known.has(id) || playedSet.has(id)) continue;
        playedSet.add(id);
        played.push(id);
        const l = fixture.lines.find((x) => x.id === id);
        if (l?.branch) seenBranch = l.branch;
      }
    },
    pending: () => queue.map((l) => l.id),
  };
}

/**
 * Derive the played line IDs from a simulation state. Saves carry `snapshot.state.fired`, where the
 * sim records every once-only dialogue cue as `cue:<key>`; SaveRecord has no dedicated field.
 * Use: `director.reset(playedFromState(snapshot.state))` after loading a save.
 */
export function playedFromState(state: Readonly<Pick<SimState, 'fired' | 'branch'>>, fixture: DialogueFixture = dialogueEn): string[] {
  const fired = new Set(state.fired);
  return fixture.lines
    .filter((l) => l.trigger.startsWith(DIALOGUE_PREFIX))
    .filter((l) => fired.has(`cue:${l.trigger.slice(DIALOGUE_PREFIX.length)}`))
    .filter((l) => !l.branch || l.branch === state.branch)
    .map((l) => l.id);
}
