/**
 * Quality tiers and the dynamic-resolution governor (ADR 0002 "Startup and quality policy" 3).
 * Pure: consumes frame-time samples, returns render-only knobs. It has no access to, and no
 * output that could reach, simulation ticks (R04).
 */
import type { QualityTier } from '../contracts/render';

export interface TierPreset {
  /** Upper bound of internal render scale (multiplied with devicePixelRatio). */
  readonly maxScale: number;
  /** Optional effects level 0..2 (spray density, ribs, amber lamps, fog detail). */
  readonly effectsLevel: 0 | 1 | 2;
  readonly antialias: boolean;
  readonly sprayParticles: number;
  readonly maxPixelRatio: number;
}

export const TIER_PRESETS: Readonly<Record<QualityTier, TierPreset>> = {
  low: { maxScale: 0.75, effectsLevel: 0, antialias: false, sprayParticles: 0, maxPixelRatio: 1 },
  medium: { maxScale: 1, effectsLevel: 1, antialias: false, sprayParticles: 240, maxPixelRatio: 1.5 },
  high: { maxScale: 1, effectsLevel: 2, antialias: true, sprayParticles: 700, maxPixelRatio: 2 },
};

export interface GovernorConfig {
  /** Frame budget the governor defends. */
  readonly targetMs: number;
  /** Degrade when rolling mean > targetMs * degradeRatio. */
  readonly degradeRatio: number;
  /** Improve when rolling mean < targetMs * improveRatio (gap = hysteresis band). */
  readonly improveRatio: number;
  readonly windowSize: number;
  readonly cooldownMs: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly scaleStep: number;
  readonly maxEffectsLevel: 0 | 1 | 2;
}

export const DEFAULT_GOVERNOR: GovernorConfig = {
  targetMs: 16.7,
  degradeRatio: 1.1,
  improveRatio: 0.7,
  windowSize: 45,
  cooldownMs: 2000,
  minScale: 0.5,
  maxScale: 1,
  scaleStep: 0.1,
  maxEffectsLevel: 2,
};

/** Render-only output. Deliberately contains no tick, step or timing-authority fields. */
export interface GovernorState {
  readonly internalScale: number;
  readonly effectsLevel: 0 | 1 | 2;
}

export interface GovernorDecision extends GovernorState {
  readonly changed: boolean;
  readonly reason: 'warming' | 'cooldown' | 'steady' | 'degrade-effects' | 'degrade-scale' | 'improve-scale' | 'improve-effects' | 'at-bound';
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export class QualityGovernor {
  private readonly samples: number[] = [];
  private sum = 0;
  private lastChangeMs = Number.NEGATIVE_INFINITY;
  private scale: number;
  private effects: 0 | 1 | 2;
  readonly config: GovernorConfig;

  constructor(config: Partial<GovernorConfig> = {}) {
    this.config = { ...DEFAULT_GOVERNOR, ...config };
    if (this.config.minScale > this.config.maxScale) throw new Error('minScale must be <= maxScale');
    this.scale = this.config.maxScale;
    this.effects = this.config.maxEffectsLevel;
  }

  static forTier(tier: QualityTier, overrides: Partial<GovernorConfig> = {}): QualityGovernor {
    const p = TIER_PRESETS[tier];
    return new QualityGovernor({ maxScale: p.maxScale, maxEffectsLevel: p.effectsLevel, minScale: Math.min(0.5, p.maxScale), ...overrides });
  }

  state(): GovernorState {
    return { internalScale: this.scale, effectsLevel: this.effects };
  }

  rollingMeanMs(): number {
    return this.samples.length ? this.sum / this.samples.length : 0;
  }

  /**
   * Feed one frame sample. `frameMs` is the CPU frame time, or max(cpu, gpu) when GPU timing
   * exists. Non-finite or negative samples are ignored.
   */
  sample(frameMs: number, nowMs: number): GovernorDecision {
    if (Number.isFinite(frameMs) && frameMs >= 0) {
      this.samples.push(frameMs);
      this.sum += frameMs;
      if (this.samples.length > this.config.windowSize) this.sum -= this.samples.shift()!;
    }
    if (this.samples.length < this.config.windowSize) return this.decide(false, 'warming');
    if (nowMs - this.lastChangeMs < this.config.cooldownMs) return this.decide(false, 'cooldown');

    const mean = this.rollingMeanMs();
    const c = this.config;
    if (mean > c.targetMs * c.degradeRatio) {
      // Lower optional effects before resolution (ADR 0002).
      if (this.effects > 0) return this.change(nowMs, () => { this.effects = (this.effects - 1) as 0 | 1; }, 'degrade-effects');
      if (this.scale > c.minScale + 1e-9) return this.change(nowMs, () => { this.scale = round2(Math.max(c.minScale, this.scale - c.scaleStep)); }, 'degrade-scale');
      return this.decide(false, 'at-bound');
    }
    if (mean < c.targetMs * c.improveRatio) {
      if (this.scale < c.maxScale - 1e-9) return this.change(nowMs, () => { this.scale = round2(Math.min(c.maxScale, this.scale + c.scaleStep)); }, 'improve-scale');
      if (this.effects < c.maxEffectsLevel) return this.change(nowMs, () => { this.effects = (this.effects + 1) as 1 | 2; }, 'improve-effects');
      return this.decide(false, 'at-bound');
    }
    return this.decide(false, 'steady');
  }

  /** Reset the rolling window (e.g. after resize or tier change) without touching bounds. */
  resetWindow(): void {
    this.samples.length = 0;
    this.sum = 0;
  }

  private change(nowMs: number, apply: () => void, reason: GovernorDecision['reason']): GovernorDecision {
    apply();
    this.lastChangeMs = nowMs;
    this.resetWindow(); // measure the new setting from scratch
    return this.decide(true, reason);
  }

  private decide(changed: boolean, reason: GovernorDecision['reason']): GovernorDecision {
    return { internalScale: this.scale, effectsLevel: this.effects, changed, reason };
  }
}
