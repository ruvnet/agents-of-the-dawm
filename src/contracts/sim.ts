import type { Axis, Vec3 } from './math';
import type { InputCommand } from './input';
import type { BeatId, LevelManifest, MachineKind } from './manifest';
import type { CapacityChecks, Destination, PressureRoute, PressureView } from './pressure';

export const SIM_HZ = 60;
export const TICK_MS = 1000 / SIM_HZ;
/** Maximum simulation ticks advanced per rendered frame before the accumulator is clamped. */
export const MAX_CATCHUP_TICKS = 5;

/** Player body extents in its local frame: [side, height along up, side]. */
export const PLAYER_BODY = { width: 0.6, height: 1.8 } as const;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_CHARGE = 3;

export interface StoryFlags {
  channelLocated: boolean;
  channelSensorVerified: boolean;
  channelEdgeRestored: boolean;
  playerAuthorized: boolean;
  capacitySafe: boolean;
  gateOpen: boolean;
}

export interface PlayerState {
  /** Feet point (contact point on the current surface). */
  pos: Vec3;
  vel: Vec3;
  up: Axis;
  yaw: number;
  pitch: number;
  health: number;
  charge: number;
  overdrive: number;
  grounded: boolean;
  /** Anchor whose volume the player is inside, if any. */
  anchorKey: string | null;
  /** Ticks remaining on the pulse/spike cooldown. */
  toolCooldown: number;
  invulnerableTicks: number;
}

export interface AnchorState {
  key: string;
  activeSurface: 0 | 1;
  enabled: boolean;
  cooldownTicks: number;
}

export type MachineMode = 'dormant' | 'patrol' | 'telegraph' | 'attack' | 'stunned' | 'pinned' | 'disabled';

export interface MachineState {
  key: string;
  kind: MachineKind;
  pos: Vec3;
  up: Axis;
  health: number;
  mode: MachineMode;
  modeTicks: number;
  patrolIndex: number;
  active: boolean;   // false until its branch/beat spawns it
}

export interface DynamicState {
  key: string;
  pose: number;
  /** Current translation from the authored box (interpolated between poses while moving). */
  offset: Vec3;
  moving: boolean;
}

export interface KeeperState {
  phase: 0 | 1 | 2 | 3 | 4;   // 0 = not engaged, 1..3 = seal phases, 4 = disabled
  sealsRemaining: number;
  sealExposedTicks: number;
  surgeTimerTicks: number;
  surgeIntervalTicks: number;
  freeStunAvailable: boolean;
}

export interface PressureState {
  routes: PressureRoute[];
  panelOpen: boolean;
  previewed: Destination[];
  selectedDestination: Destination | null;
  capacityChecks: CapacityChecks;
}

export interface AssistSettings {
  aimAssist: boolean;
  halfDamage: boolean;
  extendedExposure: boolean;
}

export interface SimState {
  version: 1;
  seed: number;
  rngState: number;
  tick: number;
  paused: boolean;
  beat: BeatId;
  branch: 'none' | 'upper' | 'lower';
  checkpointKey: string;
  player: PlayerState;
  anchors: AnchorState[];
  machines: MachineState[];
  dynamics: DynamicState[];
  /**
   * Named puzzle/pickup counters. Documented keys (v1.1): `cell:<interactableKey>` = tick at which a
   * collected charge cell is available again (collected while > tick); valve/gantry state by key.
   */
  puzzles: Record<string, number>;
  keeper: KeeperState;
  flags: StoryFlags;
  pressure: PressureState;
  /** Once-only keys already fired (dialogue cues, rewards). Sorted for canonical hashing. */
  fired: string[];
  assist: AssistSettings;
  tramCrossed: boolean;
}

export type WorldEventType =
  | 'BeatEntered' | 'CheckpointReached' | 'ObjectiveChanged'
  | 'ShiftPreviewed' | 'ShiftCommitted' | 'ShiftRejected'
  | 'PlayerFell' | 'PlayerDamaged' | 'PlayerDefeated' | 'PlayerRespawned' | 'ChargeCollected'
  | 'ToolPulse' | 'ToolSpike'
  | 'MachineWoke' | 'MachineStunned' | 'MachinePinned' | 'MachineDisabled'
  | 'DynamicMoved' | 'PuzzleChanged' | 'RouteChosen'
  | 'SurgeTelegraph' | 'Surge' | 'SealExposed' | 'SealBroken' | 'KeeperDisabled'
  | 'MapInspected' | 'ChannelLocated' | 'PanelOpened' | 'PanelClosed'
  | 'SensorVerified' | 'PreviewShown' | 'EdgeRestored' | 'TransferRejected' | 'TransferAuthorized'
  | 'GateOpened' | 'TramCrossed'
  | 'DialogueCue';

export interface WorldEvent {
  /** Stable, replay-safe: `${type}:${tick}:${key}`. */
  readonly id: string;
  readonly tick: number;
  readonly type: WorldEventType;
  /** Entity/anchor/machine/dialogue key the event concerns. */
  readonly key: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export interface Replay {
  readonly version: 1;
  readonly manifestId: string;
  readonly seed: number;
  readonly initialStateHash: string;
  readonly commands: readonly InputCommand[];
  /** Checkpoint hashes observed while recording: tick -> hash. */
  readonly checkpoints: Readonly<Record<string, string>>;
}

export interface SimSnapshot {
  readonly version: 1;
  readonly state: SimState;
  readonly eventCount: number;
}

export interface SimOptions {
  seed: number;
  assist?: Partial<AssistSettings>;
}

/** The game simulation is the sole authority for movement, collision, combat, progression (ADR 0003/0004). */
export interface Simulation {
  readonly manifest: LevelManifest;
  state(): Readonly<SimState>;
  /** Advance exactly one tick. cmd.tick must equal state().tick; otherwise the command is rejected (returns []). */
  step(cmd: InputCommand): readonly WorldEvent[];
  eventLog(): readonly WorldEvent[];
  snapshot(): SimSnapshot;
  restore(snapshot: SimSnapshot): void;
  /** Return to the current checkpoint with the ADR 0004 retry rules. */
  restartFromCheckpoint(): void;
  /** Canonical state hash (see contracts/hash.ts). */
  hash(): string;
  /** Pressure portion of the final control screen, derived from simulation state only. */
  pressureView(): PressureView;
}

export type CreateSimulation = (manifest: LevelManifest, options: SimOptions) => Simulation;
