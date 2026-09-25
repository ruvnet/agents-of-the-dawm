/**
 * Original procedural sound design as data (ADR 0001: no samples, no third-party assets).
 * Each sound is a list of oscillator or filtered-noise layers with simple envelopes; the Web Audio
 * builder in graph.ts only renders these descriptions. All times are seconds.
 */
import type { MusicStem, SoundEventId } from '../contracts/audio';

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

interface Env {
  readonly gain: number;
  readonly attack: number;
  readonly hold?: number;
  readonly release: number;
  readonly delay?: number;
}
export interface ToneLayer extends Env {
  readonly kind: 'tone';
  readonly wave: Wave;
  readonly f0: number;
  readonly f1?: number;
  readonly detune?: number;
  readonly lowpass?: number;
}
export interface NoiseLayer extends Env {
  readonly kind: 'noise';
  readonly filter: FilterKind;
  readonly f0: number;
  readonly f1?: number;
  readonly q: number;
}
export type Layer = ToneLayer | NoiseLayer;

export type InternalSoundId = SoundEventId | 'comm-open';
export interface Recipe {
  readonly bus: 'effects' | 'speech';
  readonly layers: readonly Layer[];
}

const tone = (wave: Wave, f0: number, o: Partial<ToneLayer> & Env): ToneLayer => ({ kind: 'tone', wave, f0, ...o });
const noise = (filter: FilterKind, f0: number, q: number, o: Partial<NoiseLayer> & Env): NoiseLayer => ({ kind: 'noise', filter, f0, q, ...o });
const fx = (...layers: Layer[]): Recipe => ({ bus: 'effects', layers });

/** Inharmonic partials for a small struck bell. */
const bell = (root: number, delay: number): Layer[] => [
  tone('triangle', root, { gain: 0.16, attack: 0.002, release: 1.4, delay }),
  tone('sine', root * 2.76, { gain: 0.07, attack: 0.002, release: 0.9, delay }),
  tone('sine', root * 5.4, { gain: 0.03, attack: 0.002, release: 0.5, delay }),
];

export const RECIPES: Readonly<Record<InternalSoundId, Recipe>> = {
  surf: fx(noise('lowpass', 900, 0.7, { f1: 380, gain: 0.3, attack: 0.7, hold: 0.4, release: 2 })),
  'pump-hum': fx(
    tone('sine', 55, { gain: 0.28, attack: 0.3, hold: 0.9, release: 0.8 }),
    tone('triangle', 110, { gain: 0.08, attack: 0.3, hold: 0.9, release: 0.8, lowpass: 400 }),
  ),
  'gantry-strain': fx(
    tone('sawtooth', 92, { f1: 71, gain: 0.1, attack: 0.2, hold: 0.5, release: 0.5, lowpass: 700 }),
    noise('bandpass', 1300, 9, { f1: 900, gain: 0.14, attack: 0.15, hold: 0.4, release: 0.5 }),
  ),
  'machine-servo': fx(
    tone('square', 320, { f1: 540, gain: 0.06, attack: 0.01, hold: 0.1, release: 0.08, lowpass: 2200 }),
    tone('square', 540, { f1: 300, gain: 0.05, attack: 0.01, hold: 0.08, release: 0.1, delay: 0.2, lowpass: 2200 }),
  ),
  'orientation-chime': fx(
    tone('sine', 880, { gain: 0.2, attack: 0.005, release: 1.1 }),
    tone('sine', 1320, { gain: 0.14, attack: 0.005, release: 0.9, delay: 0.09 }),
    tone('sine', 1760, { gain: 0.09, attack: 0.005, release: 0.8, delay: 0.18 }),
  ),
  'warning-horn': fx(
    tone('sawtooth', 98, { gain: 0.16, attack: 0.15, hold: 1.1, release: 0.5, lowpass: 900 }),
    tone('sawtooth', 98, { detune: 14, gain: 0.12, attack: 0.15, hold: 1.1, release: 0.5, lowpass: 900 }),
    tone('sawtooth', 147, { gain: 0.07, attack: 0.2, hold: 1, release: 0.5, lowpass: 900 }),
  ),
  'water-surge': fx(
    noise('lowpass', 220, 0.8, { f1: 1900, gain: 0.42, attack: 0.25, hold: 0.3, release: 1.6 }),
    tone('sine', 46, { f1: 38, gain: 0.22, attack: 0.1, release: 1.3 }),
  ),
  'tram-bell': fx(...bell(784, 0), ...bell(784, 0.34)),
  'underwater-fall': fx(
    noise('lowpass', 650, 1.2, { f1: 140, gain: 0.38, attack: 0.04, release: 1.3 }),
    tone('sine', 120, { f1: 48, gain: 0.18, attack: 0.02, release: 1.1 }),
  ),
  pulse: fx(
    tone('sine', 220, { f1: 880, gain: 0.2, attack: 0.005, release: 0.25 }),
    noise('highpass', 3200, 0.7, { gain: 0.07, attack: 0.002, release: 0.12 }),
  ),
  spike: fx(
    tone('sawtooth', 1400, { f1: 190, gain: 0.14, attack: 0.002, release: 0.18, lowpass: 5000 }),
    noise('bandpass', 2600, 3, { gain: 0.14, attack: 0.001, release: 0.08 }),
  ),
  'seal-break': fx(
    tone('square', 180, { f1: 58, gain: 0.16, attack: 0.004, release: 0.5, lowpass: 1600 }),
    noise('bandpass', 900, 1, { f1: 300, gain: 0.26, attack: 0.002, release: 0.6 }),
    tone('sine', 1250, { gain: 0.08, attack: 0.004, release: 0.8, delay: 0.05 }),
  ),
  'shift-reject': fx(
    tone('square', 220, { gain: 0.09, attack: 0.004, hold: 0.08, release: 0.05, lowpass: 1500 }),
    tone('square', 165, { gain: 0.09, attack: 0.004, hold: 0.12, release: 0.08, delay: 0.14, lowpass: 1500 }),
  ),
  pickup: fx(
    tone('triangle', 660, { gain: 0.12, attack: 0.004, release: 0.18 }),
    tone('triangle', 990, { gain: 0.12, attack: 0.004, release: 0.18, delay: 0.06 }),
    tone('triangle', 1320, { gain: 0.1, attack: 0.004, release: 0.3, delay: 0.12 }),
  ),
  'ui-confirm': fx(
    tone('sine', 740, { gain: 0.12, attack: 0.004, release: 0.12 }),
    tone('sine', 1110, { gain: 0.1, attack: 0.004, release: 0.2, delay: 0.07 }),
  ),
  'ui-reject': fx(tone('triangle', 300, { f1: 215, gain: 0.13, attack: 0.004, hold: 0.1, release: 0.14 })),
  'gate-open': fx(
    noise('lowpass', 150, 0.9, { f1: 950, gain: 0.3, attack: 0.8, hold: 0.8, release: 2.2 }),
    tone('sawtooth', 55, { gain: 0.14, attack: 0.5, hold: 1.4, release: 1.4, lowpass: 320 }),
  ),
  damage: fx(
    noise('bandpass', 420, 2, { gain: 0.26, attack: 0.002, release: 0.15 }),
    tone('square', 110, { f1: 70, gain: 0.12, attack: 0.002, release: 0.2, lowpass: 900 }),
  ),
  // Radio open click played on the speech bus when a spoken caption starts (no voice samples yet).
  'comm-open': {
    bus: 'speech',
    layers: [
      noise('highpass', 2400, 0.7, { gain: 0.05, attack: 0.002, release: 0.05 }),
      tone('sine', 1760, { gain: 0.05, attack: 0.002, release: 0.06, delay: 0.03 }),
    ],
  },
};

export function layerEnd(l: Layer): number {
  return (l.delay ?? 0) + l.attack + (l.hold ?? 0) + l.release;
}

export function recipeDuration(r: Recipe): number {
  return r.layers.reduce((m, l) => Math.max(m, layerEnd(l)), 0);
}

// ------------------------------------------------------------------------------------ music

export const MUSIC_BPM = 72;
export const STEPS_PER_BAR = 16;
export const STEP_SEC = 60 / MUSIC_BPM / 4;

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Four-bar progression for the release stem (MIDI notes): Dadd9, Bm7, Gmaj7, Asus4 -> A. */
export const RELEASE_CHORDS: readonly (readonly number[])[] = [
  [50, 54, 57, 64],
  [47, 50, 54, 57],
  [43, 47, 50, 54],
  [45, 50, 52, 57],
];

function explore(step: number): Layer[] {
  const s = step % STEPS_PER_BAR;
  const out: Layer[] = [];
  // Slow pump pulse: a paired low thump, like a pump stroke and its return.
  if (s === 0) out.push(tone('sine', 52, { f1: 40, gain: 0.5, attack: 0.02, release: 0.7 }));
  if (s === 3) out.push(tone('sine', 46, { f1: 38, gain: 0.28, attack: 0.02, release: 0.5 }));
  if (s === 8) out.push(noise('lowpass', 380, 0.8, { f1: 180, gain: 0.07, attack: 0.4, release: 0.9 }));
  if (step % (STEPS_PER_BAR * 2) === 0) {
    out.push(tone('triangle', midiHz(38), { gain: 0.08, attack: 1.2, hold: 3.5, release: 2, lowpass: 320 }));
    out.push(tone('triangle', midiHz(45), { detune: 6, gain: 0.05, attack: 1.5, hold: 3, release: 2, lowpass: 320 }));
  }
  return out;
}

function encounter(step: number): Layer[] {
  const s = step % STEPS_PER_BAR;
  const out: Layer[] = [];
  // Processed hull percussion: body thuds, ringing plate strikes and tight ticks.
  if (s === 0 || s === 6 || s === 10) out.push(tone('sine', 70, { f1: 42, gain: 0.45, attack: 0.003, release: 0.28 }));
  if (s === 4 || s === 12) out.push(noise('bandpass', 1850, 14, { gain: 0.35, attack: 0.001, release: 0.35 }));
  if (s === 14) out.push(noise('bandpass', 2600, 18, { gain: 0.2, attack: 0.001, release: 0.25 }));
  if (s % 2 === 1) out.push(noise('highpass', 6000, 0.7, { gain: 0.035, attack: 0.001, release: 0.04 }));
  if (s === 0 || s === 3 || s === 7 || s === 11) {
    out.push(tone('square', midiHz(s === 11 ? 41 : 38), { gain: 0.05, attack: 0.005, hold: 0.1, release: 0.15, lowpass: 480 }));
  }
  return out;
}

function release(step: number): Layer[] {
  const s = step % STEPS_PER_BAR;
  const chord = RELEASE_CHORDS[Math.floor(step / STEPS_PER_BAR) % RELEASE_CHORDS.length]!;
  const out: Layer[] = [];
  if (s === 0) {
    for (const n of chord) {
      out.push(tone('sawtooth', midiHz(n), { gain: 0.035, attack: 0.9, hold: 1.6, release: 1.4, lowpass: 1100 }));
      out.push(tone('sawtooth', midiHz(n), { detune: 7, gain: 0.03, attack: 0.9, hold: 1.6, release: 1.4, lowpass: 1100 }));
    }
    out.push(tone('sine', midiHz(chord[0]! - 12), { gain: 0.12, attack: 0.4, hold: 2, release: 1 }));
  }
  if (s % 4 === 2) {
    const n = chord[(s / 4 | 0) % chord.length]! + 12;
    out.push(tone('sine', midiHz(n), { gain: 0.05, attack: 0.01, release: 0.9 }));
  }
  return out;
}

/** Notes a stem plays on a global 16th-note step. Pure and deterministic. */
export function stemNotes(stem: MusicStem, step: number): Layer[] {
  if (stem === 'explore') return explore(step);
  if (stem === 'encounter') return encounter(step);
  return release(step);
}
