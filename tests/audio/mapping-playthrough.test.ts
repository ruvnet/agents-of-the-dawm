import { describe, expect, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import type { MusicStem, SoundEventId, WorldEvent } from '../../src/contracts';
import { createSimulation } from '../../src/sim';
import { createAutopilot, drive, fullPlan } from '../../src/sim/autopilot';
import { INITIAL_MUSIC, reduceMusic, soundsForEvent, stemFor } from '../../src/audio';

const manifest = loadSector01();

function realLog(route: 'upper' | 'lower'): readonly WorldEvent[] {
  const sim = createSimulation(manifest, { seed: 1047 });
  drive(sim, createAutopilot(manifest, fullPlan(route)));
  return sim.eventLog();
}

describe.each(['upper', 'lower'] as const)('audio mapping against the real %s playthrough', (route) => {
  const log = realLog(route);

  it('music moves explore -> encounter -> explore -> release and never sticks on encounter', () => {
    let m = INITIAL_MUSIC;
    const stems: MusicStem[] = [stemFor(m)];
    let afterKeeper: MusicStem | null = null;
    for (const e of log) {
      m = reduceMusic(m, [e]);
      const s = stemFor(m);
      if (s !== stems[stems.length - 1]) stems.push(s);
      if (e.type === 'KeeperDisabled') afterKeeper = s;
      if (e.type === 'TransferAuthorized') expect(stems[stems.length - 2]).toBe('explore');
    }
    expect(stems[0]).toBe('explore');
    expect(stems.filter((s) => s === 'encounter').length).toBeGreaterThanOrEqual(2);
    expect(afterKeeper).toBe('explore');
    expect(stems[stems.length - 1]).toBe('release');
    expect(m.awake).toEqual([]);
  });

  it('real event shapes produce the scripted one-shots', () => {
    const heard = new Set<SoundEventId>(log.flatMap(soundsForEvent).map((s) => s.id));
    // The autopilot beats the keeper before its first surge, so horn/surge are covered by unit tests only.
    for (const id of ['surf', 'orientation-chime', 'tram-bell', 'pulse', 'spike', 'seal-break',
      'pickup', 'gate-open', 'ui-confirm', 'machine-servo', 'gantry-strain'] as SoundEventId[]) {
      expect(heard.has(id), id).toBe(true);
    }
    const chimes = log.filter((e) => e.type === 'ShiftCommitted').flatMap(soundsForEvent).filter((s) => s.id === 'orientation-chime');
    expect(new Set(chimes.map((c) => c.rate)).size).toBeGreaterThan(1); // direction is audible
  });
});
