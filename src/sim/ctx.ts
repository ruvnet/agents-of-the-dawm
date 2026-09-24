/**
 * Per-tick mutation context plus tunable, explainable rule constants.
 * Every rule number used by the simulation lives here so behaviour stays auditable.
 */
import type { LevelManifest } from '../contracts/manifest';
import type { SimState, WorldEvent, WorldEventType } from '../contracts/sim';

export const RULES = {
  dt: 1 / 60,
  walkSpeed: 6,
  gravity: 20,
  jumpSpeed: 7,
  terminalSpeed: 30,
  groundProbe: 0.05,
  coreCubeHalf: 0.3,
  anchorCooldown: 30,
  pitchLimit: 1.4,
  startCharge: 1,
  /** "Standard charge" granted on a retry (ADR 0004 invariant 4). */
  standardCharge: 3,
  fallDamage: 20,
  invulnerableTicks: 60,
  toolCooldown: 20,
  pulseRange: 3.2,
  pulseRangeAssist: 4.2,
  spikeRange: 14,
  spikeRangeAssist: 18,
  keeperSpikeRange: 26,
  overdriveRange: 7,
  stunTicks: 180,
  pinTicks: 300,
  cellRespawnTicks: 900,
  dynamicSpeed: 6,
  machine: {
    skimmer: { health: 1, speed: 2.5, aggro: 7, attackRange: 1.8, windup: 40, damage: 10, recover: 60, wake: 2.5 },
    hauler: { health: 2, speed: 1, aggro: 6, attackRange: 2.2, windup: 70, damage: 20, recover: 90, wake: 2.5 },
  },
  keeper: {
    seals: 3,
    exposeTicks: 180,
    exposeTicksAssist: 300,
    surgeInterval: 1200,
    surgeIntervalLower: 1800,
    surgeTelegraph: 180,
    surgeDamage: 25,
    coverRadius: 2.5,
    chargeWindup: 300,
    chargeRange: 8,
    chargeDamage: 30,
    pinTicks: 180,
  },
  tramDelayTicks: 180,
  widerMapDelayTicks: 120,
  moreOutlinesDelayTicks: 60,
  tramInViewDistance: 3,
} as const;

export interface Ctx {
  readonly m: LevelManifest;
  readonly s: SimState;
  readonly tick: number;
  readonly events: WorldEvent[];
}

export type Payload = Record<string, string | number | boolean | null>;

export function emit(c: Ctx, type: WorldEventType, key: string, payload: Payload = {}): void {
  c.events.push({ id: `${type}:${c.tick}:${key}`, tick: c.tick, type, key, payload });
}

/** Record a once-only key; returns true only the first time. `fired` stays sorted for hashing. */
export function once(s: SimState, key: string): boolean {
  if (s.fired.includes(key)) return false;
  s.fired.push(key);
  s.fired.sort();
  return true;
}

/** Emit a DialogueCue whose key is the dialogue trigger suffix; each cue fires once per save. */
export function cue(c: Ctx, key: string): void {
  if (once(c.s, `cue:${key}`)) emit(c, 'DialogueCue', key);
}

export const cueFired = (s: SimState, key: string): boolean => s.fired.includes(`cue:${key}`);
