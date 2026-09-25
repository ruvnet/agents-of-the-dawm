import type { ControlAction, InputCommand } from './input';
import type { LevelManifest } from './manifest';
import type { FinalGraphView } from './pressure';
import type { CameraSettings, QualityTier, RenderBackend, RenderReadiness, RenderStats } from './render';
import type { AssistSettings, SimState, WorldEvent } from './sim';
import type { AudioSettings } from './audio';
import type { CaptionCue, Objective } from './narrative';
import type { SemanticStatus } from './semantic';

/** v1.1 (wave 2). UI, input and save contracts shared by src/app (coordinator), src/ui (W4), src/storage (W5). */

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';
export type ActionName =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'pulse' | 'spike' | 'shift'
  | 'interact' | 'pause' | 'lookLeft' | 'lookRight' | 'lookUp' | 'lookDown';

/** Remappable bindings: action -> list of KeyboardEvent.code values / standard-gamepad button indices. */
export interface Bindings {
  keyboard: Record<ActionName, string[]>;
  gamepad: Partial<Record<ActionName, number[]>>;
}

export interface UiSettings {
  version: 1;
  camera: CameraSettings;
  quality: QualityTier | 'auto';
  renderer: 'auto' | 'webgpu' | 'webgl2';
  captions: boolean;
  /** Caption and UI text scale; 2 = 200 percent (P06). */
  textScale: 1 | 1.5 | 2;
  audio: AudioSettings;
  assist: AssistSettings;
  lookSensitivity: number;
  invertY: boolean;
  bindings: Bindings;
  showTutorials: boolean;
  locale: 'en';
}

export interface InputSampleContext {
  readonly tick: number;
  readonly state: Readonly<SimState>;
  readonly manifest: LevelManifest;
  /** True while a modal UI (menu, settings, control screen) owns input; movement must be idle. */
  readonly uiCapturing: boolean;
  readonly settings: Readonly<UiSettings>;
}

/**
 * Normalises keyboard, gamepad and touch into one InputCommand per simulation tick (G03).
 * Edge-triggered actions (jump/pulse/spike/interact/shift) fire exactly once per press.
 */
export interface InputSource {
  attach(target: HTMLElement): void;
  sample(ctx: InputSampleContext): InputCommand;
  /** Discrete control-screen actions from the UI are merged into the next sampled command. */
  queueControl(action: ControlAction): void;
  /** Anchor the player is previewing (holding shift / hovering), for the render ghost. */
  previewAnchorKey(): string | null;
  activeDevice(): InputDevice;
  dispose(): void;
}

export interface UiFrame {
  readonly state: Readonly<SimState>;
  readonly events: readonly WorldEvent[];
  readonly graph: FinalGraphView;
  readonly captions: readonly CaptionCue[];
  readonly objective: Objective | null;
  readonly backend: RenderBackend;
  readonly readiness: RenderReadiness;
  readonly renderStats: RenderStats | null;
  readonly semanticStatus: SemanticStatus;
  readonly device: InputDevice;
  readonly paused: boolean;
}

export interface UiHooks {
  /** Start or continue from the start state (must be a user gesture: audio unlock happens here). */
  onStart(mode: 'new' | 'continue'): void;
  onControl(action: ControlAction): void;
  onSettings(settings: UiSettings): void;
  onPause(paused: boolean): void;
  onRestartCheckpoint(): void;
  onResetSave(): void;
}

export interface GameUi {
  mount(root: HTMLElement, hooks: UiHooks, settings: UiSettings, opts: { hasSave: boolean }): void;
  update(frame: UiFrame): void;
  /** Loader shows control readiness, not a fake asset percentage (ADR 0002). */
  setReadiness(readiness: RenderReadiness, backend: RenderBackend): void;
  /** Actionable compatibility / error state; never a blank canvas (R05). */
  showFatal(title: string, detail: string, actions?: { label: string; run: () => void }[]): void;
  /** v1.1 (VR5): dismiss the fatal overlay after a later renderer init succeeds. */
  clearFatal?(): void;
  /** True while a modal owns input (menu, settings, control screen). */
  capturing(): boolean;
  /** v1.1 (C1): the app started play without the UI Play button (demo, autostart). No hook re-entry. */
  markStarted?(mode: 'new' | 'continue'): void;
  dispose(): void;
}

// ---------------------------------------------------------------- local saves (ADR 0001/0004)

export const SAVE_SCHEMA_VERSION = 1;

/** Versioned local save. Stores replay/checkpoint data only, never a WASM handle. */
export interface SaveRecord {
  readonly schema: 1;
  readonly manifestId: string;
  readonly seed: number;
  readonly savedAtTick: number;
  readonly checkpointKey: string;
  /** Snapshot of the simulation at the last checkpoint. */
  readonly snapshot: unknown;
  readonly stateHash: string;
  readonly settings: UiSettings;
}

export interface SaveStore {
  /** Returns null when storage is unavailable; the game must remain playable without saves. */
  load(): Promise<SaveRecord | null>;
  save(record: SaveRecord): Promise<boolean>;
  reset(): Promise<void>;
  loadSettings(): Promise<UiSettings | null>;
  saveSettings(s: UiSettings): Promise<boolean>;
  available(): boolean;
}
