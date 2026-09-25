/**
 * Caption timing and the script log. Pure (time is passed in). DAWM-speaker cues are an on-screen
 * system display (D01), not a spoken subtitle, so they are routed separately.
 */
import type { CaptionCue } from '../contracts/narrative';

export interface ActiveCaption {
  readonly id: string;
  readonly speaker: CaptionCue['speaker'];
  readonly text: string;
  readonly until: number;
  /** Non-speech cue such as [surge horn]. */
  readonly cue: boolean;
}

export interface ScriptEntry {
  readonly id: string;
  readonly speaker: CaptionCue['speaker'];
  readonly text: string;
  readonly display: boolean;
}

export const MAX_ACTIVE_CAPTIONS = 3;
export const MIN_CAPTION_MS = 2500;
export const DISPLAY_MIN_MS = 9000;

export class CaptionLog {
  private active: ActiveCaption[] = [];
  private display: ActiveCaption | null = null;
  private readonly log: ScriptEntry[] = [];
  private readonly seen = new Set<string>();

  push(cues: readonly CaptionCue[], nowMs: number): void {
    for (const c of cues) {
      if (!c || typeof c.text !== 'string') continue;
      const dur = Math.max(MIN_CAPTION_MS, Number.isFinite(c.durationMs) ? c.durationMs : 0);
      const isDisplay = c.speaker === 'DAWM';
      if (!this.seen.has(c.id)) {
        this.seen.add(c.id);
        this.log.push({ id: c.id, speaker: c.speaker, text: c.text, display: isDisplay });
      }
      const entry: ActiveCaption = { id: c.id, speaker: c.speaker, text: c.text, until: nowMs + (isDisplay ? Math.max(dur, DISPLAY_MIN_MS) : dur), cue: c.speaker === null };
      if (isDisplay) { this.display = entry; continue; }
      this.active = [...this.active.filter((a) => a.id !== c.id), entry].slice(-MAX_ACTIVE_CAPTIONS);
    }
  }

  current(nowMs: number): readonly ActiveCaption[] {
    this.active = this.active.filter((a) => a.until > nowMs);
    return this.active;
  }

  currentDisplay(nowMs: number): ActiveCaption | null {
    if (this.display && this.display.until <= nowMs) this.display = null;
    return this.display;
  }

  /** Last DAWM display ever shown (the ending panel repeats it). */
  lastDisplay(): ScriptEntry | null {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i]!.display) return this.log[i]!;
    return null;
  }

  script(): readonly ScriptEntry[] {
    return this.log;
  }

  reset(): void {
    this.active = [];
    this.display = null;
  }

  /** Forget everything, including the script log (a new run). */
  clear(): void {
    this.reset();
    this.log.length = 0;
    this.seen.clear();
  }
}
