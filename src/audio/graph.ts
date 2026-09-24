/**
 * Thin Web Audio layer: builds the bus graph and renders recipe layers. No game logic here.
 */
import type { AudioBusName, MusicStem } from '../contracts/audio';
import type { Layer } from './recipes';
import { layerEnd } from './recipes';

export interface Graph {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly buses: Record<AudioBusName, GainNode>;
  /** Music bus -> duck -> master; ducking automates this node only. */
  readonly duck: GainNode;
  readonly stems: Record<MusicStem, GainNode>;
  readonly noise: AudioBuffer;
}

/** Deterministic white noise (xorshift32) so no randomness source is needed. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let x = 0x9e3779b9;
  for (let i = 0; i < len; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    data[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buf;
}

export function buildGraph(ctx: BaseAudioContext): Graph {
  const gain = (v: number, to: AudioNode): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  };
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);
  const master = gain(0, limiter);
  const duck = gain(1, master);
  const buses = { speech: gain(1, master), effects: gain(1, master), music: gain(1, duck) };
  const stems = { explore: gain(0, buses.music), encounter: gain(0, buses.music), release: gain(0, buses.music) };
  return { ctx, master, buses, duck, stems, noise: noiseBuffer(ctx) };
}

export function rampTo(p: AudioParam, value: number, at: number, timeConstant: number): void {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(value, at, Math.max(0.001, timeConstant));
}

/** Render one layer into `dest` starting at `when`, scaled by playback `rate`. */
export function playLayer(g: Graph, l: Layer, dest: AudioNode, when: number, rate = 1): void {
  const ctx = g.ctx;
  const t0 = when + (l.delay ?? 0);
  const peak = t0 + l.attack;
  const holdEnd = peak + (l.hold ?? 0);
  const end = when + layerEnd(l);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), peak);
  env.gain.setValueAtTime(Math.max(0.0002, l.gain), holdEnd);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);

  let src: AudioScheduledSourceNode;
  let input: AudioNode = env;
  if (l.kind === 'tone') {
    const osc = ctx.createOscillator();
    osc.type = l.wave;
    osc.frequency.setValueAtTime(l.f0 * rate, t0);
    if (l.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, l.f1 * rate), end);
    if (l.detune) osc.detune.value = l.detune;
    if (l.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = l.lowpass;
      f.connect(env);
      input = f;
    }
    osc.connect(input);
    src = osc;
  } else {
    const n = ctx.createBufferSource();
    n.buffer = g.noise;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = l.filter;
    f.Q.value = l.q;
    f.frequency.setValueAtTime(l.f0 * rate, t0);
    if (l.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(1, l.f1 * rate), end);
    f.connect(env);
    n.connect(f);
    src = n;
  }
  src.start(t0);
  src.stop(end + 0.05);
  src.onended = () => { try { env.disconnect(); } catch { /* already gone */ } };
}
