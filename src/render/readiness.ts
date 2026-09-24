/**
 * Progressive readiness (ADR 0002 startup policy 1): control readiness, not a fake percentage.
 * initializing → controllable (critical layer drawn once) → optional-loading → complete.
 * Optional detail is built one step per frame after control is available and never gates it.
 */
import type { RenderReadiness } from '../contracts/render';

export type OptionalStep = () => void;

export class ReadinessTracker {
  private phase: RenderReadiness = 'initializing';
  private criticalReady = false;
  private readonly queue: { name: string; run: OptionalStep }[] = [];
  private readonly done: string[] = [];
  private readonly failed: string[] = [];

  current(): RenderReadiness {
    return this.phase;
  }

  /** Scene has player, anchor, floor and objective objects. */
  markCriticalBuilt(): void {
    this.criticalReady = true;
  }

  enqueueOptional(name: string, run: OptionalStep): void {
    this.queue.push({ name, run });
  }

  pending(): readonly string[] {
    return this.queue.map((q) => q.name);
  }

  completed(): readonly string[] {
    return this.done;
  }

  failures(): readonly string[] {
    return this.failed;
  }

  /**
   * Call after each rendered frame. The first frame with the critical layer present makes the
   * game controllable; later frames each build at most one optional step.
   */
  afterFrame(): RenderReadiness {
    if (!this.criticalReady) return this.phase;
    if (this.phase === 'initializing') {
      this.phase = 'controllable';
      return this.phase;
    }
    const next = this.queue.shift();
    if (next) {
      try {
        next.run();
        this.done.push(next.name);
      } catch {
        // A broken optional effect must not block play (ADR 0002 R05); record and continue.
        this.failed.push(next.name);
      }
    }
    this.phase = this.queue.length ? 'optional-loading' : 'complete';
    return this.phase;
  }
}
