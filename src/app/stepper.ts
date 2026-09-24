import { MAX_CATCHUP_TICKS, TICK_MS } from '../contracts/sim';

/**
 * Fixed-timestep accumulator (ADR 0004). Render rate never changes the tick sequence:
 * elapsed wall time only decides how many fixed ticks run before the next render.
 */
export class FixedStepper {
  private acc = 0;
  private last: number | null = null;

  constructor(private readonly maxCatchup = MAX_CATCHUP_TICKS, private readonly tickMs = TICK_MS) {}

  /** Returns the number of ticks to run now and the interpolation alpha for rendering. */
  advance(nowMs: number, speed = 1): { ticks: number; alpha: number } {
    if (this.last === null) this.last = nowMs;
    const dt = Math.max(0, Math.min(250, nowMs - this.last)) * speed;
    this.last = nowMs;
    this.acc += dt;
    let ticks = Math.floor(this.acc / this.tickMs);
    const cap = this.maxCatchup * Math.max(1, Math.ceil(speed));
    if (ticks > cap) {
      ticks = cap;
      this.acc = 0; // drop the backlog instead of spiralling
    } else {
      this.acc -= ticks * this.tickMs;
    }
    return { ticks, alpha: Math.min(1, this.acc / this.tickMs) };
  }

  reset(): void {
    this.acc = 0;
    this.last = null;
  }
}
