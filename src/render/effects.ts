/**
 * Event-driven visual effect timeline (pure). Consumes committed WorldEvents from RenderFrame
 * and produces time-boxed, render-only effects. Deduplicated by event id so a replayed or
 * repeated batch never double-fires. Never writes back to simulation.
 */
import type { WorldEvent, WorldEventType } from '../contracts/sim';
import { clamp01, type V3 } from './vec';

export type EffectKind =
  | 'shift-flash' | 'pulse-ring' | 'spike-trail' | 'surge-telegraph' | 'surge' | 'seal-break' | 'gate-open' | 'tram-crossing';

export interface ActiveEffect {
  readonly id: string;
  readonly kind: EffectKind;
  readonly key: string;
  readonly startMs: number;
  readonly durationMs: number;
  /** World origin captured at trigger time (e.g. player position), if any. */
  readonly origin: V3 | null;
  /** Direction captured at trigger time (spike trail), if any. */
  readonly dir: V3 | null;
  /** Effect stays at its end state after completion (gate, tram). */
  readonly persistent: boolean;
}

export const EFFECT_FOR_EVENT: Partial<Record<WorldEventType, { kind: EffectKind; durationMs: number; persistent?: boolean }>> = {
  ShiftCommitted: { kind: 'shift-flash', durationMs: 420 },
  ToolPulse: { kind: 'pulse-ring', durationMs: 650 },
  ToolSpike: { kind: 'spike-trail', durationMs: 320 },
  SurgeTelegraph: { kind: 'surge-telegraph', durationMs: 3000 },
  Surge: { kind: 'surge', durationMs: 900 },
  SealBroken: { kind: 'seal-break', durationMs: 1000 },
  GateOpened: { kind: 'gate-open', durationMs: 4000, persistent: true },
  TramCrossed: { kind: 'tram-crossing', durationMs: 9000, persistent: true },
};

export interface EffectContext {
  readonly playerPos: V3;
  readonly playerForward: V3;
}

export class EffectTimeline {
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private active: ActiveEffect[] = [];

  constructor(private readonly maxRemembered = 512) {}

  ingest(events: readonly WorldEvent[], nowMs: number, ctx: EffectContext): ActiveEffect[] {
    const added: ActiveEffect[] = [];
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      this.remember(e.id);
      const spec = EFFECT_FOR_EVENT[e.type];
      if (!spec) continue;
      const fx: ActiveEffect = {
        id: e.id, kind: spec.kind, key: e.key, startMs: nowMs, durationMs: spec.durationMs,
        origin: [...ctx.playerPos] as V3, dir: [...ctx.playerForward] as V3, persistent: spec.persistent === true,
      };
      // Only one live instance per persistent kind.
      if (fx.persistent) this.active = this.active.filter((a) => a.kind !== fx.kind);
      this.active.push(fx);
      added.push(fx);
    }
    return added;
  }

  /** Drops finished non-persistent effects and returns the live list. */
  update(nowMs: number): readonly ActiveEffect[] {
    this.active = this.active.filter((a) => a.persistent || nowMs - a.startMs < a.durationMs);
    return this.active;
  }

  live(): readonly ActiveEffect[] {
    return this.active;
  }

  find(kind: EffectKind): ActiveEffect | undefined {
    return this.active.find((a) => a.kind === kind);
  }

  clear(): void {
    this.active = [];
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > this.maxRemembered) this.seen.delete(this.seenOrder.shift()!);
  }
}

export const effectProgress = (fx: ActiveEffect, nowMs: number): number => clamp01((nowMs - fx.startMs) / fx.durationMs);

/**
 * Surge telegraph seam intensity: three pulses over the 3 s window, 0..1.
 * Reduced flashes cap the peak and remove strobing (steady glow ramp instead).
 */
export function seamIntensity(progress: number, reducedFlashes: boolean): number {
  const p = clamp01(progress);
  if (reducedFlashes) return 0.35 + 0.4 * p;
  return 0.25 + 0.75 * Math.pow(Math.sin(p * Math.PI * 3), 2);
}

/** Shift flash opacity; reduced motion/flash keeps it gentle. */
export function flashOpacity(progress: number, reduced: boolean): number {
  const p = clamp01(progress);
  return (1 - p) * (reduced ? 0.18 : 0.55);
}

/**
 * Gate opening amount 0..1 given sim state and the effect. A restored save with the gate
 * already open (no event this session) renders fully open.
 */
export function gateOpenAmount(gateOpenFlag: boolean, fx: ActiveEffect | undefined, nowMs: number): number {
  if (!gateOpenFlag) return 0;
  if (!fx) return 1;
  const p = effectProgress(fx, nowMs);
  return p * p * (3 - 2 * p);
}

/** Tram travel 0..1 (render-only, begins only after TramCrossed). */
export function tramTravel(tramCrossed: boolean, fx: ActiveEffect | undefined, nowMs: number): number {
  if (!tramCrossed) return 0;
  if (!fx) return 1;
  return effectProgress(fx, nowMs);
}

/** Small camera shake for surge / seal break; zero when reducedMotion. */
export function shakeOffset(live: readonly ActiveEffect[], nowMs: number, reducedMotion: boolean): V3 {
  if (reducedMotion) return [0, 0, 0];
  let amp = 0;
  for (const fx of live) {
    if (fx.kind !== 'surge' && fx.kind !== 'seal-break') continue;
    amp = Math.max(amp, (1 - effectProgress(fx, nowMs)) * (fx.kind === 'surge' ? 0.12 : 0.06));
  }
  if (amp <= 0) return [0, 0, 0];
  const t = nowMs / 1000;
  return [Math.sin(t * 41) * amp, Math.sin(t * 53 + 1.3) * amp, Math.sin(t * 37 + 2.1) * amp];
}
