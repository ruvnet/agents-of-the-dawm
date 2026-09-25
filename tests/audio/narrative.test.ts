import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dialogueEn, loadSector01 } from '../../src/contracts/fixtures';
import { BEATS } from '../../src/contracts';
import type { CaptionCue, InputCommand, SimState, WorldEvent } from '../../src/contracts';
import { createSimulation } from '../../src/sim';
import { createAutopilot, drive, fullPlan } from '../../src/sim/autopilot';
import {
  BUNDLES, EN_BUNDLE, FR_CA_BUNDLE, OBJECTIVE_KEYS, captionDurationMs, createNarrativeDirector,
  objectiveFor, objectiveKeyFor, playedFromState, t,
} from '../../src/narrative';

const manifest = loadSector01();
let seq = 0;
const ev = (type: WorldEvent['type'], key: string, tick = seq++): WorldEvent =>
  ({ id: `${type}:${tick}:${key}`, tick, type, key, payload: {} });
const cue = (key: string, tick?: number) => ev('DialogueCue', key, tick);
const spoken = (c: readonly CaptionCue[]) => c.filter((x) => x.speaker !== null).map((x) => x.id);

function expectedLines(route: 'upper' | 'lower'): string[] {
  return dialogueEn.lines.filter((l) => !l.branch || l.branch === route).map((l) => l.id);
}

interface Run { captions: CaptionCue[]; objectivesByBeat: Map<string, Set<string>>; objectives: string[]; log: readonly WorldEvent[]; final: SimState }

function playRoute(route: 'upper' | 'lower'): Run {
  const sim = createSimulation(manifest, { seed: 1047 });
  const director = createNarrativeDirector();
  const captions: CaptionCue[] = [];
  const objectivesByBeat = new Map<string, Set<string>>();
  const objectives: string[] = [];
  const wrapped = {
    state: () => sim.state(),
    step(c: InputCommand) {
      const events = sim.step(c);
      const s = sim.state();
      captions.push(...director.consume(events, s.branch));
      const o = objectiveFor(s).key;
      if (objectives[objectives.length - 1] !== o) objectives.push(o);
      const set = objectivesByBeat.get(s.beat) ?? new Set<string>();
      set.add(o);
      objectivesByBeat.set(s.beat, set);
      return events;
    },
  };
  drive(wrapped, createAutopilot(manifest, fullPlan(route)));
  return { captions, objectivesByBeat, objectives, log: sim.eventLog(), final: sim.state() as SimState };
}

describe('dialogue fixture coverage', () => {
  it('every scripted trigger key maps to exactly one primary line; follow-ups chain via `after`', () => {
    const byTrigger = new Map<string, typeof dialogueEn.lines>();
    for (const l of dialogueEn.lines) byTrigger.set(l.trigger, [...(byTrigger.get(l.trigger) ?? []), l]);
    for (const [trigger, lines] of byTrigger) {
      const primary = lines.filter((l) => !(l.after && lines.some((o) => o.id === l.after)));
      expect(primary, trigger).toHaveLength(1);
    }
    expect(new Set(dialogueEn.lines.map((l) => l.id)).size).toBe(dialogueEn.lines.length);
    expect(dialogueEn.lines).toHaveLength(34); // 31 per route + 2 exclusive variants + D01
  });

  it('every line maps to a single trigger event and emits its own caption', () => {
    for (const l of dialogueEn.lines) {
      const d = createNarrativeDirector();
      const [type, key] = l.trigger.split(':') as [WorldEvent['type'], string];
      if (l.after) d.reset([l.after]);
      const out = spoken(d.consume([ev(type, key)], l.branch ?? 'none'));
      expect(out, l.id).toContain(l.id);
    }
  });
});

describe('narrative director rules', () => {
  it('once lines never repeat across repeated events, checkpoint retries and reset', () => {
    const d = createNarrativeDirector();
    expect(spoken(d.consume([cue('first-move')], 'none'))).toEqual(['S01']);
    expect(spoken(d.consume([cue('first-move'), cue('first-move')], 'none'))).toEqual([]);
    const saved = d.played();
    const fresh = createNarrativeDirector();
    fresh.reset(saved);
    expect(spoken(fresh.consume([cue('first-move')], 'none'))).toEqual([]);
    expect(spoken(fresh.consume([cue('tram-in-view')], 'none'))).toEqual(['S02']);
    fresh.reset([]);
    expect(spoken(fresh.consume([cue('first-move')], 'none'))).toEqual(['S01']);
  });

  it('reset ignores unknown ids and duplicates', () => {
    const d = createNarrativeDirector();
    d.reset(['S01', 'S01', 'NOPE']);
    expect(d.played()).toEqual(['S01']);
  });

  it('branch lines play only for the chosen branch', () => {
    const d = createNarrativeDirector();
    expect(spoken(d.consume([cue('choose-lower'), cue('clear-lower')], 'upper'))).toEqual([]);
    expect(spoken(d.consume([cue('choose-upper')], 'upper'))).toEqual(['S16U']);
    expect(spoken(d.consume([cue('clear-upper')], 'upper'))).toEqual(['S17U']);
    expect(d.played()).not.toContain('S16L');
    const n = createNarrativeDirector();
    expect(spoken(n.consume([cue('choose-lower')], 'none'))).toEqual([]);
    // Branch can also be learnt from a RouteChosen event in the same batch.
    expect(spoken(n.consume([ev('RouteChosen', 'lower'), cue('choose-lower')], 'none'))).toEqual(['S16L']);
  });

  it('S13 -> S14 and S28 -> D01 are sequenced on the same tick', () => {
    const d = createNarrativeDirector();
    expect(spoken(d.consume([cue('channel-marker', 5)], 'none'))).toEqual(['S13', 'S14']);
    const out = d.consume([cue('authorized', 9)], 'none');
    expect(spoken(out)).toEqual(['S28', 'D01']);
    expect(out[1]!.speaker).toBe('DAWM');
  });

  it('an `after` line arriving first waits for its prerequisite', () => {
    const d = createNarrativeDirector();
    expect(spoken(d.consume([cue('more-outlines')], 'none'))).toEqual([]);
    expect(d.pending()).toEqual(['S31']);
    expect(spoken(d.consume([cue('wider-map')], 'none'))).toEqual(['S30', 'S31']);
    expect(d.pending()).toEqual([]);
  });

  it('non-speech cues become speaker-null captions and repeat', () => {
    const d = createNarrativeDirector();
    const a = d.consume([ev('SurgeTelegraph', 'keeper'), ev('Surge', 'keeper'), ev('ShiftCommitted', 'anchor-a1-inspection'),
      ev('ShiftRejected', 'x'), ev('GateOpened', 'locked-gate')], 'none');
    expect(a.map((c) => c.text)).toEqual(['[surge horn]', '[water surge]', '[orientation chime]', '[shift rejected]', '[floodgate opens]']);
    expect(a.every((c) => c.speaker === null)).toBe(true);
    const b = d.consume([ev('SurgeTelegraph', 'keeper')], 'none');
    expect(b).toHaveLength(1);
    expect(b[0]!.id).not.toBe(a[0]!.id);
    const bell = d.consume([cue('tram-in-view')], 'none');
    expect(bell.map((c) => c.text)).toEqual(['[tram bell]', dialogueEn.lines.find((l) => l.id === 'S02')!.text]);
  });

  it('unknown events are ignored', () => {
    const d = createNarrativeDirector();
    expect(d.consume([cue('no-such-cue'), ev('PlayerDamaged', 'x')], 'none')).toEqual([]);
  });

  it('durationMs derives from text length within bounds', () => {
    expect(captionDurationMs('')).toBe(1500);
    expect(captionDurationMs('x'.repeat(1000))).toBe(9000);
    expect(captionDurationMs('a'.repeat(40))).toBeGreaterThan(captionDurationMs('a'.repeat(20)));
    const d = createNarrativeDirector();
    const [c] = d.consume([cue('first-move')], 'none');
    expect(c!.durationMs).toBe(captionDurationMs(c!.text));
  });

  describe('no wall clock', () => {
    afterEach(() => vi.restoreAllMocks());
    it('never reads Date.now, performance.now or Math.random', () => {
      const spies = [vi.spyOn(Date, 'now'), vi.spyOn(performance, 'now'), vi.spyOn(Math, 'random')];
      const d = createNarrativeDirector();
      d.consume([cue('first-move'), cue('channel-marker'), ev('Surge', 'k')], 'none');
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      for (const f of ['index.ts', 'objectives.ts', 'strings.ts']) {
        const src = readFileSync(new URL(`../../src/narrative/${f}`, import.meta.url), 'utf8');
        expect(src).not.toMatch(/Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval/);
      }
    });
    it('is deterministic for identical input', () => {
      const evs = [cue('first-move', 1), cue('channel-marker', 2), ev('Surge', 'k', 3), cue('authorized', 4)];
      expect(createNarrativeDirector().consume(evs, 'none')).toEqual(createNarrativeDirector().consume(evs, 'none'));
    });
  });
});

describe.each(['upper', 'lower'] as const)('real simulation playthrough (%s)', (route) => {
  const run = playRoute(route);

  it('plays exactly the route lines, in script order: 31 spoken + D01', () => {
    const ids = spoken(run.captions);
    expect(ids).toEqual(expectedLines(route));
    expect(ids.filter((id) => id !== 'D01')).toHaveLength(31);
  });

  it('feeding the whole log again plays nothing new (once across retries)', () => {
    const d = createNarrativeDirector();
    d.consume(run.log, route);
    expect(spoken(d.consume(run.log, route))).toEqual([]);
  });

  it('playedFromState restores the same played set from a save snapshot', () => {
    const restored = playedFromState(run.final);
    expect([...restored].sort()).toEqual(expectedLines(route).sort());
    const d = createNarrativeDirector();
    d.reset(restored);
    expect(spoken(d.consume(run.log, route))).toEqual([]);
  });

  it('objectives cover every beat of the route and progress in story order', () => {
    const skipped = route === 'upper' ? 'lower-conduit' : 'upper-lattice';
    for (const b of BEATS) if (b !== skipped) expect(run.objectivesByBeat.has(b), b).toBe(true);
    const expected = [
      'reach-inspection-anchor', 'climb-wall', 'disable-skimmers', 'move-gantry', 'inspect-channel-marker', 'choose-route',
      route === 'upper' ? 'cross-lattice' : 'redirect-conduit', 'expose-seals', 'open-control-screen', 'scan-relief-sensor',
      'preview-destinations', 'restore-route', 'authorize-transfer', 'watch-tram', 'complete',
    ];
    expect(run.objectives).toEqual(expected);
  });

  it('a checkpoint retry mid-run does not replay any line', () => {
    const sim = createSimulation(manifest, { seed: 1047 });
    const d = createNarrativeDirector();
    const all: CaptionCue[] = [];
    const pilot = createAutopilot(manifest, fullPlan(route));
    let retried = false;
    const wrapped = {
      state: () => sim.state(),
      step(c: InputCommand) {
        const events = sim.step(c);
        all.push(...d.consume(events, sim.state().branch));
        if (!retried && sim.state().beat === 'keeper-arena') {
          retried = true;
          const before = sim.eventLog().length;
          sim.restartFromCheckpoint();
          all.push(...d.consume(sim.eventLog().slice(before), sim.state().branch));
          // Re-feed everything so far, as if the app replayed the retry window.
          all.push(...d.consume(sim.eventLog(), sim.state().branch));
        }
        return events;
      },
    };
    drive(wrapped, pilot);
    expect(retried).toBe(true);
    const ids = spoken(all);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expectedLines(route));
  });
});

describe('objectives and localisation', () => {
  it('every objective key has English text and objectiveFor uses the table', () => {
    for (const k of OBJECTIVE_KEYS) expect(EN_BUNDLE.strings[`objective.${k}`], k).toBeTruthy();
    const sim = createSimulation(manifest, { seed: 1 });
    expect(objectiveFor(sim.state())).toEqual({ key: 'reach-inspection-anchor', text: t('objective.reach-inspection-anchor') });
    expect(objectiveKeyFor(sim.state())).toBe('reach-inspection-anchor');
  });

  it('English bundle carries every dialogue line and cue by stable ID', () => {
    for (const l of dialogueEn.lines) expect(EN_BUNDLE.strings[`line.${l.id}`]).toBe(l.text);
    for (const c of dialogueEn.cues) expect(EN_BUNDLE.strings[`cue.${c.id}`]).toBe(c.text);
  });

  it('fr-CA is a stub flagged for human review, keyed only by existing IDs, falling back to English', () => {
    expect(FR_CA_BUNDLE.needsHumanReview).toBe(true);
    expect(BUNDLES['fr-CA']).toBe(FR_CA_BUNDLE);
    for (const k of Object.keys(FR_CA_BUNDLE.strings)) expect(EN_BUNDLE.strings[k], k).toBeDefined();
    expect(t('line.S01', 'fr-CA')).toBe(EN_BUNDLE.strings['line.S01']);
    expect(t('cue.C-tram-bell', 'fr-CA')).toBe('[cloche du tram]');
    const fr = createNarrativeDirector(dialogueEn, { locale: 'fr-CA' });
    expect(fr.consume([cue('tram-in-view')], 'none')[0]!.text).toBe('[cloche du tram]');
  });
});
