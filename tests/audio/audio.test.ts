import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import type { AudioSettings, MusicStem, SoundEventId, WorldEvent } from '../../src/contracts';
import {
  AXIS_RATE, DEFAULT_AUDIO_SETTINGS, DUCK_DEPTH, INITIAL_MUSIC, MAX_ONE_SHOTS_PER_BATCH, RECIPES, RELEASE_CHORDS, STEP_SEC,
  admitSounds, busLevels, createAudioEngine, duckFactor, duckMsForEvents, effectiveGain, equalPower, extendDuck,
  musicLevel, recipeDuration, reduceMusic, sanitizeAudioSettings, soundsForEvent, stemFor, stemNotes, stemTargets, targetCurve,
} from '../../src/audio';
import { captionDurationMs } from '../../src/narrative';
import { FakeAudioContext, asCtx } from './fake-audio';

let n = 0;
const ev = (type: WorldEvent['type'], key = 'k', payload: WorldEvent['payload'] = {}): WorldEvent =>
  ({ id: `${type}:${n}:${key}`, tick: n++, type, key, payload });
const ids = (e: WorldEvent) => soundsForEvent(e).map((s) => s.id);

const ALL_SOUNDS: SoundEventId[] = [
  'surf', 'pump-hum', 'gantry-strain', 'machine-servo', 'orientation-chime', 'warning-horn', 'water-surge', 'tram-bell',
  'underwater-fall', 'pulse', 'spike', 'seal-break', 'shift-reject', 'pickup', 'ui-confirm', 'ui-reject', 'gate-open', 'damage',
];

describe('event -> sound mapping', () => {
  it('maps the scripted event types to their one-shots', () => {
    const table: [WorldEvent['type'], SoundEventId][] = [
      ['ShiftCommitted', 'orientation-chime'], ['SurgeTelegraph', 'warning-horn'], ['Surge', 'water-surge'],
      ['TramCrossed', 'tram-bell'], ['PlayerFell', 'underwater-fall'], ['ToolPulse', 'pulse'], ['ToolSpike', 'spike'],
      ['SealBroken', 'seal-break'], ['MachineStunned', 'machine-servo'], ['ShiftRejected', 'shift-reject'],
      ['ChargeCollected', 'pickup'], ['TransferRejected', 'ui-reject'], ['GateOpened', 'gate-open'], ['PlayerDamaged', 'damage'],
    ];
    for (const [type, id] of table) expect(ids(ev(type, 'player', { target: 'player', to: '+y' })), type).toEqual([id]);
  });

  it('pitches the orientation chime by landing axis and strains for non-player shifts', () => {
    const up = soundsForEvent(ev('ShiftCommitted', 'a', { target: 'player', to: '+y' }))[0]!;
    const wall = soundsForEvent(ev('ShiftCommitted', 'a', { target: 'player', to: '-z' }))[0]!;
    expect(up.rate).toBe(1);
    expect(wall.rate).toBe(AXIS_RATE['-z']);
    expect(ids(ev('ShiftCommitted', 'anchor-gantry', { target: 'gantry', to: '+x' }))).toEqual(['orientation-chime', 'gantry-strain']);
  });

  it('ignores events without a sound and covers every SoundEventId somewhere', () => {
    expect(ids(ev('CheckpointReached'))).toEqual([]);
    expect(ids(ev('DialogueCue', 'first-move'))).toEqual(['surf']);
    expect(ids(ev('DialogueCue', 'map-closed'))).toEqual([]);
    const reachable = new Set<SoundEventId>();
    const probes: WorldEvent[] = [
      ev('ShiftCommitted', 'g', { target: 'gantry', to: '+y' }), ev('BeatEntered', 'west-approach'), ev('BeatEntered', 'maintenance-deck'),
      ev('SurgeTelegraph'), ev('Surge'), ev('TramCrossed'), ev('PlayerFell'), ev('ToolPulse'), ev('ToolSpike'), ev('SealBroken'),
      ev('MachineStunned'), ev('ShiftRejected'), ev('ChargeCollected'), ev('TransferRejected'), ev('GateOpened'), ev('PlayerDamaged'),
      ev('PanelOpened'),
    ];
    for (const p of probes) for (const s of soundsForEvent(p)) reachable.add(s.id);
    expect([...reachable].sort()).toEqual([...ALL_SOUNDS].sort());
  });

  it('limits repeats within a short window and caps a batch', () => {
    const last = new Map<SoundEventId, number>();
    const burst = Array.from({ length: 20 }, () => ({ id: 'pulse' as SoundEventId, rate: 1 }));
    expect(admitSounds(burst, last, 1)).toHaveLength(1);
    expect(admitSounds(burst, last, 1.01)).toHaveLength(0);
    expect(admitSounds(burst, last, 2)).toHaveLength(1);
    const many = ALL_SOUNDS.map((id) => ({ id, rate: 1 }));
    expect(admitSounds(many, new Map(), 0)).toHaveLength(MAX_ONE_SHOTS_PER_BATCH);
  });
});

describe('procedural recipes and stems', () => {
  it('every SoundEventId has a bounded, original synth recipe', () => {
    for (const id of ALL_SOUNDS) {
      const r = RECIPES[id];
      expect(r.layers.length, id).toBeGreaterThan(0);
      const d = recipeDuration(r);
      expect(Number.isFinite(d) && d > 0 && d <= 4, id).toBe(true);
      for (const l of r.layers) {
        expect(l.gain).toBeGreaterThan(0);
        expect(l.gain).toBeLessThanOrEqual(0.6);
        expect(l.f0).toBeGreaterThan(0);
      }
    }
  });

  it('three stems produce deterministic, distinct patterns', () => {
    const bar = (s: MusicStem) => Array.from({ length: 64 }, (_, i) => stemNotes(s, i));
    expect(bar('explore')).toEqual(bar('explore'));
    const count = (s: MusicStem) => bar(s).reduce((a, b) => a + b.length, 0);
    expect(count('encounter')).toBeGreaterThan(count('explore'));
    expect(count('release')).toBeGreaterThan(0);
    expect(stemNotes('release', 0).filter((l) => l.kind === 'tone').length).toBeGreaterThanOrEqual(RELEASE_CHORDS[0]!.length);
    expect(STEP_SEC).toBeGreaterThan(0.1);
  });

  it('ships no audio sample files or asset imports', () => {
    expect(readdirSync(new URL('../../src/audio/', import.meta.url)).every((f) => f.endsWith('.ts') || f.endsWith('.md'))).toBe(true);
    for (const f of readdirSync(new URL('../../src/audio/', import.meta.url))) {
      const src = readFileSync(new URL(`../../src/audio/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/\.(mp3|ogg|wav|m4a|flac)['"]|fetch\(|decodeAudioData|XMLHttpRequest/);
    }
  });
});

describe('music stem selection', () => {
  it('encounter while machines are awake or the keeper is engaged, explore otherwise, release is final', () => {
    let m = reduceMusic(INITIAL_MUSIC, [ev('MachineWoke', 'skimmer-d1'), ev('MachineWoke', 'skimmer-d2')]);
    expect(stemFor(m)).toBe('encounter');
    m = reduceMusic(m, [ev('MachineDisabled', 'skimmer-d1')]);
    expect(stemFor(m)).toBe('encounter');
    m = reduceMusic(m, [ev('MachineDisabled', 'skimmer-d2')]);
    expect(stemFor(m)).toBe('explore');
    m = reduceMusic(m, [ev('MachineWoke', 'hauler'), ev('PlayerRespawned', 'cp', { reason: 'defeated' })]);
    expect(stemFor(m)).toBe('explore');
    m = reduceMusic(m, [ev('MachineWoke', 'hauler'), ev('PlayerRespawned', 'cp', { reason: 'fall' })]);
    expect(stemFor(m)).toBe('encounter');
    m = reduceMusic(INITIAL_MUSIC, [ev('DialogueCue', 'enter-arena')]);
    expect(stemFor(m)).toBe('encounter');
    m = reduceMusic(m, [ev('KeeperDisabled', 'keeper')]);
    expect(stemFor(m)).toBe('explore');
    m = reduceMusic(m, [ev('GateOpened', 'locked-gate'), ev('MachineWoke', 'late')]);
    expect(stemFor(m)).toBe('release');
  });
});

describe('mixing and ducking math', () => {
  const s: AudioSettings = { master: 0.5, speech: 1, effects: 0.4, music: 0.8, muted: false };

  it('bus gain is master x bus, and mute silences everything at master', () => {
    expect(effectiveGain(s, 'effects')).toBeCloseTo(0.2);
    expect(effectiveGain(s, 'music')).toBeCloseTo(0.4);
    expect(busLevels({ ...s, muted: true }).master).toBe(0);
    expect(effectiveGain({ ...s, muted: true }, 'speech')).toBe(0);
    expect(busLevels({ ...s, muted: true }).effects).toBe(0.4); // sliders survive a mute
  });

  it('sanitises untrusted settings', () => {
    expect(sanitizeAudioSettings({ master: 7, speech: -1, effects: Number.NaN, music: 0.5, muted: 'yes' as unknown as boolean }))
      .toEqual({ master: 1, speech: 0, effects: DEFAULT_AUDIO_SETTINGS.effects, music: 0.5, muted: false });
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('ducks music under captions and extends but never shortens the window', () => {
    expect(duckFactor(1, 2)).toBe(DUCK_DEPTH);
    expect(duckFactor(2, 2)).toBe(1);
    expect(musicLevel(s, 1, 3)).toBeCloseTo(0.4 * DUCK_DEPTH);
    expect(musicLevel(s, 4, 3)).toBeCloseTo(0.4);
    expect(extendDuck(10, 0, 2000)).toBe(12);
    expect(extendDuck(10, 15, 2000)).toBe(15);
    expect(extendDuck(10, 11, Number.NaN)).toBe(11);
  });

  it('duck length follows the spoken caption durations for the cue', () => {
    const s13 = 'The relief channel is still here.';
    const s14 = 'The new district map dropped its connection.';
    expect(duckMsForEvents([ev('DialogueCue', 'channel-marker')])).toBe(captionDurationMs(s13) + captionDurationMs(s14));
    expect(duckMsForEvents([ev('Surge')])).toBe(0);
  });

  it('crossfade curves are equal power and converge', () => {
    for (const t of [0, 0.25, 0.5, 1]) {
      const [a, b] = equalPower(t);
      expect(a * a + b * b).toBeCloseTo(1);
    }
    expect(stemTargets('encounter')).toEqual({ explore: 0, encounter: 1, release: 0 });
    expect(targetCurve(1, 0, 4, 0.8)).toBeLessThan(0.01);
  });
});

describe('audio engine lifecycle', () => {
  const g = globalThis as { AudioContext?: unknown };
  afterEach(() => { delete g.AudioContext; });

  it('is unavailable without an AudioContext and never throws', async () => {
    expect(g.AudioContext).toBeUndefined();
    const a = createAudioEngine();
    expect(a.state()).toBe('unavailable');
    await expect(a.unlock()).resolves.toBe(false);
    expect(() => {
      a.handleEvents([ev('Surge'), ev('GateOpened')]);
      a.setStem('encounter');
      a.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
      a.duck(1000);
      a.dispose();
    }).not.toThrow();
    expect(a.state()).toBe('unavailable');
  });

  it('a throwing context factory yields unavailable, not an exception', async () => {
    const a = createAudioEngine({ createContext: () => { throw new Error('no audio device'); } });
    await expect(a.unlock()).resolves.toBe(false);
    expect(a.state()).toBe('unavailable');
  });

  it('unlock resolves false and stays locked when resume is blocked or hangs', async () => {
    for (const mode of ['block', 'reject', 'hang'] as const) {
      const f = new FakeAudioContext();
      f.resumeMode = mode;
      const a = createAudioEngine({ createContext: () => asCtx(f), unlockTimeoutMs: 10 });
      expect(a.state()).toBe('locked');
      await expect(a.unlock()).resolves.toBe(false);
      expect(a.state(), mode).toBe('locked');
      a.dispose();
    }
  });

  it('runs after unlock, plays synthesized sounds, suspends and recovers', async () => {
    const f = new FakeAudioContext();
    const a = createAudioEngine({ createContext: () => asCtx(f) });
    a.handleEvents([ev('Surge')]); // before unlock: dropped silently
    expect(f.sources()).toBe(0);
    await expect(a.unlock()).resolves.toBe(true);
    expect(a.state()).toBe('running');
    const before = f.sources();
    a.handleEvents([ev('Surge'), ev('ToolPulse')]);
    expect(f.sources()).toBeGreaterThan(before);
    a.handleEvents([ev('MachineWoke', 'skimmer-d1')]);
    expect(a.currentStem()).toBe('encounter');
    a.setStem('release');
    expect(a.currentStem()).toBe('release');
    f.resumeMode = 'block';
    f.setState('suspended');
    expect(a.state()).toBe('suspended');
    f.resumeMode = 'run';
    a.handleEvents([ev('ToolPulse')]); // retries resume on the next batch
    expect(a.state()).toBe('running');
    a.dispose();
    expect(a.state()).toBe('unavailable');
  });

  it('applies muted settings to the master bus', async () => {
    const f = new FakeAudioContext();
    const a = createAudioEngine({ createContext: () => asCtx(f) });
    await a.unlock();
    a.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
    // First gain created by buildGraph is the master bus.
    expect(f.gains[0]!.gain.value).toBe(0);
    a.setSettings({ ...DEFAULT_AUDIO_SETTINGS, master: 0.5 });
    expect(f.gains[0]!.gain.value).toBe(0.5);
    expect(a.settings().master).toBe(0.5);
    a.dispose();
  });
});
