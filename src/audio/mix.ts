/**
 * Pure mixing math: bus levels from settings, ducking and crossfade curves.
 * Graph: one-shot/stem voices -> bus (speech | effects | music -> duck) -> master -> limiter -> out.
 */
import type { AudioBusName, AudioSettings, MusicStem } from '../contracts/audio';

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, speech: 1, effects: 0.8, music: 0.6, muted: false };

/** Music level multiplier while a caption is showing. */
export const DUCK_DEPTH = 0.3;
export const DUCK_ATTACK_SEC = 0.08;
export const DUCK_RELEASE_SEC = 0.45;
/** Time constant for stem crossfades (setTargetAtTime), roughly 3 s to settle. */
export const STEM_FADE_SEC = 0.8;
export const STEMS: readonly MusicStem[] = ['explore', 'encounter', 'release'];
export const BUSES: readonly AudioBusName[] = ['speech', 'effects', 'music'];

export const clamp01 = (n: unknown): number =>
  (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Coerce untrusted settings (e.g. from a save) into range. Missing values use defaults. */
export function sanitizeAudioSettings(s: Partial<AudioSettings> | null | undefined): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS;
  const pick = (v: unknown, dv: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : dv);
  return {
    master: pick(s?.master, d.master),
    speech: pick(s?.speech, d.speech),
    effects: pick(s?.effects, d.effects),
    music: pick(s?.music, d.music),
    muted: s?.muted === true,
  };
}

export interface BusLevels {
  readonly master: number;
  readonly speech: number;
  readonly effects: number;
  readonly music: number;
}

/** Node gains for each bus; the mute applies at master so buses keep their slider values. */
export function busLevels(s: AudioSettings): BusLevels {
  const c = sanitizeAudioSettings(s);
  return { master: c.muted ? 0 : c.master, speech: c.speech, effects: c.effects, music: c.music };
}

/** Perceived output level of a bus: master x bus, zero when muted. */
export function effectiveGain(s: AudioSettings, bus: AudioBusName): number {
  const l = busLevels(s);
  return l.master * l[bus];
}

/** Duck multiplier at time `now` given the end of the current caption window. */
export function duckFactor(nowSec: number, duckUntilSec: number, depth = DUCK_DEPTH): number {
  return nowSec < duckUntilSec ? clamp01(depth) : 1;
}

/** Extend (never shorten) a duck window. */
export function extendDuck(nowSec: number, currentUntilSec: number, ms: number): number {
  if (!(ms > 0) || !Number.isFinite(ms)) return currentUntilSec;
  return Math.max(currentUntilSec, nowSec + ms / 1000);
}

/** Final music level at time `now` (master x music x duck). */
export function musicLevel(s: AudioSettings, nowSec: number, duckUntilSec: number): number {
  return effectiveGain(s, 'music') * duckFactor(nowSec, duckUntilSec);
}

/** Target gain per stem: the active stem at 1, the others silent. */
export function stemTargets(active: MusicStem): Record<MusicStem, number> {
  return { explore: active === 'explore' ? 1 : 0, encounter: active === 'encounter' ? 1 : 0, release: active === 'release' ? 1 : 0 };
}

/** Equal-power crossfade at progress t in [0, 1]: [outgoing, incoming]. Sum of squares is 1. */
export function equalPower(t: number): [number, number] {
  const x = clamp01(t) * Math.PI / 2;
  return [Math.cos(x), Math.sin(x)];
}

/** Value of a setTargetAtTime curve after `elapsed` seconds (for tests and scheduling decisions). */
export function targetCurve(from: number, to: number, elapsedSec: number, timeConstant: number): number {
  if (elapsedSec <= 0) return from;
  return to + (from - to) * Math.exp(-elapsedSec / timeConstant);
}
