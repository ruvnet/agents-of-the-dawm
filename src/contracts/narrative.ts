import type { WorldEvent } from './sim';

export type Speaker = 'Kest' | 'Tala' | 'DAWM';

export interface DialogueLine {
  readonly id: string;              // S01..S31, S16U/S16L, S17U/S17L, D01
  readonly speaker: Speaker;
  readonly text: string;            // exact English subtitle
  /** Trigger: `${WorldEventType}:${key}` fired by the simulation. */
  readonly trigger: string;
  readonly once: boolean;
  readonly branch?: 'upper' | 'lower';
  /** Line that must have played first (e.g. S14 after S13). */
  readonly after?: string;
  readonly display?: boolean;       // DAWM on-screen display rather than voice
}

export interface CaptionCue {
  readonly id: string;
  readonly speaker: Speaker | null; // null for non-speech cues like [surge horn]
  readonly text: string;
  readonly durationMs: number;
}

export interface NarrativeDirector {
  /** Consume simulation events, return captions to display now. Pure; no wall clock. */
  consume(events: readonly WorldEvent[], branch: 'none' | 'upper' | 'lower'): readonly CaptionCue[];
  played(): readonly string[];
  reset(played: readonly string[]): void;
}

export interface Objective {
  readonly key: string;
  readonly text: string;
}
