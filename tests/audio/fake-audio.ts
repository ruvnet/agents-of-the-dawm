/** Minimal in-memory AudioContext stand-in: records node creation and param automation. */

export class FakeParam {
  value = 0;
  readonly calls: string[] = [];
  setValueAtTime(v: number) { this.calls.push('set'); this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.calls.push('exp'); this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.calls.push('lin'); this.value = v; return this; }
  setTargetAtTime(v: number) { this.calls.push('target'); this.value = v; return this; }
  cancelScheduledValues() { this.calls.push('cancel'); return this; }
}

class FakeNode {
  connect(n: unknown) { return n; }
  disconnect() {}
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); }
class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = 0;
  start() { this.started += 1; }
  stop() {}
}
class FakeOsc extends FakeSource { type = 'sine'; frequency = new FakeParam(); detune = new FakeParam(); }
class FakeBufferSource extends FakeSource { buffer: unknown = null; loop = false; }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  /** What resume() does: 'run' succeeds, 'block' stays suspended, 'reject' throws, 'hang' never settles. */
  resumeMode: 'run' | 'block' | 'reject' | 'hang' = 'run';
  readonly created: Record<string, number> = {};
  readonly gains: FakeGain[] = [];
  private listeners: (() => void)[] = [];

  private count(k: string) { this.created[k] = (this.created[k] ?? 0) + 1; }
  createGain() { this.count('gain'); const g = new FakeGain(); this.gains.push(g); return g; }
  createOscillator() { this.count('osc'); return new FakeOsc(); }
  createBiquadFilter() { this.count('filter'); return new FakeFilter(); }
  createBufferSource() { this.count('noise'); return new FakeBufferSource(); }
  createDynamicsCompressor() { this.count('compressor'); return new FakeCompressor(); }
  createBuffer(_ch: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  addEventListener(_t: string, fn: () => void) { this.listeners.push(fn); }
  removeEventListener(_t: string, fn: () => void) { this.listeners = this.listeners.filter((f) => f !== fn); }
  setState(s: FakeAudioContext['state']) { this.state = s; for (const f of this.listeners) f(); }
  resume(): Promise<void> {
    if (this.resumeMode === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.resumeMode === 'hang') return new Promise(() => {});
    if (this.resumeMode === 'run') this.setState('running');
    return Promise.resolve();
  }
  close(): Promise<void> { this.setState('closed'); return Promise.resolve(); }
  sources(): number { return (this.created.osc ?? 0) + (this.created.noise ?? 0); }
}

export const asCtx = (f: FakeAudioContext) => f as unknown as AudioContext;
