/**
 * Procedural Web Audio engine for Floodline (W5). No sample files, no third-party assets (ADR 0001).
 *
 * - `unlock()` must run inside a user gesture. The AudioContext is created lazily there.
 * - Without an AudioContext (node, tests, old browsers) the engine reports 'unavailable' and every
 *   method is a safe no-op; the game never depends on audio.
 * - After an autoplay-policy or OS suspension the state reads 'suspended'; the engine retries
 *   `resume()` on the next event batch and on the next `unlock()` gesture.
 * - Event -> sound mapping, stem choice and mixing math are pure (mapping.ts, mix.ts, recipes.ts).
 */
import type { AudioEngine, AudioSettings, MusicStem, SoundEventId } from '../contracts/audio';
import type { WorldEvent } from '../contracts/sim';
import { buildGraph, playLayer, rampTo, type Graph } from './graph';
import { INITIAL_MUSIC, admitSounds, duckMsForEvents, reduceMusic, soundsForEvent, stemFor, type MusicState } from './mapping';
import { DUCK_ATTACK_SEC, DUCK_DEPTH, DUCK_RELEASE_SEC, STEMS, STEM_FADE_SEC, busLevels, extendDuck, sanitizeAudioSettings, stemTargets } from './mix';
import { RECIPES, STEP_SEC, stemNotes, type InternalSoundId } from './recipes';

export * from './mapping';
export * from './mix';
export { RECIPES, recipeDuration, stemNotes, midiHz, MUSIC_BPM, STEP_SEC, RELEASE_CHORDS } from './recipes';
export type { InternalSoundId, Layer, Recipe } from './recipes';

export type AudioState = ReturnType<AudioEngine['state']>;
type Ctor = new () => AudioContext;

export interface AudioEngineOptions {
  /** Factory for the context (tests inject fakes). Default: window AudioContext / webkitAudioContext. */
  readonly createContext?: (() => AudioContext) | null;
  /** How long unlock() waits for resume() before reporting it as blocked. */
  readonly unlockTimeoutMs?: number;
}

export interface FloodlineAudioEngine extends AudioEngine {
  /** Duck music for `ms` (e.g. the caption durations the narrative director returned). */
  duck(ms: number): void;
  currentStem(): MusicStem;
  settings(): AudioSettings;
}

const LOOKAHEAD_SEC = 0.25;
const SCHEDULER_MS = 60;
/** How long a faded-out stem keeps being scheduled so its tail can crossfade. */
const STEM_TAIL_SEC = STEM_FADE_SEC * 4;

function defaultFactory(): (() => AudioContext) | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const C = g.AudioContext ?? g.webkitAudioContext;
  return C ? () => new C() : null;
}

export function createAudioEngine(opts: AudioEngineOptions = {}): FloodlineAudioEngine {
  const factory = opts.createContext === undefined ? defaultFactory() : opts.createContext;
  const unlockTimeout = opts.unlockTimeoutMs ?? 1500;
  let unavailable = factory === null;
  let ctx: AudioContext | null = null;
  let graph: Graph | null = null;
  let everRunning = false;
  let settings = sanitizeAudioSettings(null);
  let music: MusicState = INITIAL_MUSIC;
  let stem: MusicStem = 'explore';
  const stemFadeOut: Partial<Record<MusicStem, number>> = {};
  let duckUntil = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextStepTime = 0;
  let step = 0;
  const lastStart = new Map<SoundEventId, number>();

  const running = (): boolean => !!ctx && !!graph && ctx.state === 'running';

  function applySettings(): void {
    if (!graph || !ctx) return;
    const l = busLevels(settings);
    const now = ctx.currentTime;
    rampTo(graph.master.gain, l.master, now, 0.03);
    rampTo(graph.buses.speech.gain, l.speech, now, 0.03);
    rampTo(graph.buses.effects.gain, l.effects, now, 0.03);
    rampTo(graph.buses.music.gain, l.music, now, 0.03);
  }

  function applyStem(): void {
    if (!graph || !ctx) return;
    const targets = stemTargets(stem);
    const now = ctx.currentTime;
    for (const s of STEMS) rampTo(graph.stems[s].gain, targets[s], now, STEM_FADE_SEC);
  }

  function schedule(): void {
    if (!graph || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (nextStepTime < now) nextStepTime = now + 0.05;
    while (nextStepTime < now + LOOKAHEAD_SEC) {
      for (const s of STEMS) {
        const tail = stemFadeOut[s];
        if (s !== stem && (tail === undefined || tail < nextStepTime)) continue;
        for (const l of stemNotes(s, step)) playLayer(graph, l, graph.stems[s], nextStepTime);
      }
      nextStepTime += STEP_SEC;
      step += 1;
    }
  }

  function startScheduler(): void {
    if (timer !== null) return;
    schedule();
    timer = setInterval(() => { try { schedule(); } catch { /* keep the game running */ } }, SCHEDULER_MS);
  }

  function stopScheduler(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function play(id: InternalSoundId, rate: number): void {
    if (!graph || !ctx) return;
    const r = RECIPES[id];
    const dest = graph.buses[r.bus];
    const when = ctx.currentTime + 0.01;
    for (const l of r.layers) playLayer(graph, l, dest, when, rate);
  }

  function duck(ms: number): void {
    if (!graph || !ctx) return;
    const now = ctx.currentTime;
    const until = extendDuck(now, duckUntil, ms);
    if (until === duckUntil) return;
    duckUntil = until;
    const p = graph.duck.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(DUCK_DEPTH, now, DUCK_ATTACK_SEC);
    p.setTargetAtTime(1, duckUntil, DUCK_RELEASE_SEC);
  }

  function setStemInternal(next: MusicStem): void {
    if (next === stem) return;
    if (ctx) stemFadeOut[stem] = ctx.currentTime + STEM_TAIL_SEC;
    delete stemFadeOut[next];
    stem = next;
    applyStem();
  }

  function tryResume(): void {
    if (ctx && everRunning && ctx.state !== 'running' && ctx.state !== 'closed') {
      ctx.resume().catch(() => { /* needs a gesture; unlock() will retry */ });
    }
  }

  function onStateChange(): void {
    if (!ctx) return;
    if (ctx.state === 'running') { everRunning = true; startScheduler(); }
    else stopScheduler();
    if (ctx.state === 'closed') unavailable = true;
  }

  return {
    async unlock(): Promise<boolean> {
      if (unavailable || !factory) return false;
      try {
        if (!ctx) {
          ctx = factory();
          graph = buildGraph(ctx);
          ctx.addEventListener?.('statechange', onStateChange);
          applySettings();
          applyStem();
        }
        if (ctx.state !== 'running') {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<void>((res) => { timeoutId = setTimeout(res, unlockTimeout); });
          await Promise.race([ctx.resume(), timeout]).finally(() => clearTimeout(timeoutId));
        }
        if (ctx.state === 'running') {
          everRunning = true;
          startScheduler();
          return true;
        }
        return false;
      } catch {
        if (!graph) { unavailable = true; ctx = null; }
        return false;
      }
    },

    handleEvents(events: readonly WorldEvent[]): void {
      if (unavailable || events.length === 0) return;
      try {
        music = reduceMusic(music, events);
        setStemInternal(stemFor(music));
        if (!running()) { tryResume(); return; }
        const triggers = events.flatMap(soundsForEvent);
        for (const tr of admitSounds(triggers, lastStart, ctx!.currentTime)) play(tr.id, tr.rate);
        const ms = duckMsForEvents(events);
        if (ms > 0) { duck(ms); play('comm-open', 1); }
      } catch { /* audio must never break the game loop */ }
    },

    setStem(next: MusicStem): void {
      if (!STEMS.includes(next)) return;
      try { setStemInternal(next); } catch { /* ignore */ }
    },

    setSettings(s: AudioSettings): void {
      settings = sanitizeAudioSettings(s);
      try { applySettings(); } catch { /* ignore */ }
    },

    state(): AudioState {
      if (unavailable) return 'unavailable';
      if (!ctx) return 'locked';
      if (ctx.state === 'running') return 'running';
      if (ctx.state === 'closed') return 'unavailable';
      return everRunning ? 'suspended' : 'locked';
    },

    dispose(): void {
      stopScheduler();
      if (ctx) {
        ctx.removeEventListener?.('statechange', onStateChange);
        ctx.close().catch(() => { /* ignore */ });
      }
      ctx = null;
      graph = null;
      unavailable = true;
    },

    duck(ms: number): void {
      try { duck(ms); } catch { /* ignore */ }
    },
    currentStem: () => stem,
    settings: () => ({ ...settings }),
  };
}
