import type { WorldEvent } from './sim';

export type AudioBusName = 'speech' | 'effects' | 'music';
export type MusicStem = 'explore' | 'encounter' | 'release';

export type SoundEventId =
  | 'surf' | 'pump-hum' | 'gantry-strain' | 'machine-servo' | 'orientation-chime' | 'warning-horn'
  | 'water-surge' | 'tram-bell' | 'underwater-fall' | 'pulse' | 'spike' | 'seal-break'
  | 'shift-reject' | 'pickup' | 'ui-confirm' | 'ui-reject' | 'gate-open' | 'damage';

export interface AudioSettings {
  master: number;
  speech: number;
  effects: number;
  music: number;
  muted: boolean;
}

/** Procedural/original audio only; no third-party assets without provenance (ADR 0001). */
export interface AudioEngine {
  /** Must be called from a user gesture to satisfy autoplay policy; resolves false if blocked. */
  unlock(): Promise<boolean>;
  handleEvents(events: readonly WorldEvent[]): void;
  setStem(stem: MusicStem): void;
  setSettings(s: AudioSettings): void;
  state(): 'locked' | 'running' | 'suspended' | 'unavailable';
  dispose(): void;
}
