import { describe, expect, it } from 'vitest';
import type { SimState } from '../../src/contracts';
import { CaptionLog } from '../../src/ui/captions';
import { anchorPrompt, hudVm, interactPrompt, type HudContext } from '../../src/ui/hud';
import { navEdges } from '../../src/ui/nav';
import { defaultSettings } from '../../src/ui/settings';
import { actionGlyph, crescentFor } from '../../src/ui/strings';
import { manifest, newSim } from '../sim/helpers';

const base = newSim(1047).state();
const ctx = (over: Partial<HudContext> = {}): HudContext => ({
  manifest, device: 'keyboard', bindings: defaultSettings().bindings, showTutorials: true, previewTo: new Map(), ...over,
});
const state = (fn: (s: SimState) => void): SimState => { const s = structuredClone(base) as SimState; fn(s); return s; };

describe('HUD view-model', () => {
  it('health, charge pips and overdrive as text', () => {
    const vm = hudVm(state((s) => { s.player.health = 64; s.player.charge = 2; s.player.overdrive = 1; }), 'Reach the inspection anchor.', ctx());
    expect(vm.healthText).toBe('Health 64/100');
    expect(vm.chargePips).toEqual([true, true, false]);
    expect(vm.chargeText).toBe('Charge 2/3');
    expect(vm.overdriveText).toContain('1');
    expect(vm.objective).toBe('Reach the inspection anchor.');
  });

  it('anchor prompt: PREVIEW DOWN then SHIFT DOWN with device glyphs and crescent orientation words', () => {
    const inside = state((s) => { s.player.anchorKey = 'anchor-a1-inspection'; });
    const p1 = anchorPrompt(inside, ctx())!;
    expect(p1.text).toBe('PREVIEW DOWN');
    expect(p1.glyph).toBe('F');
    expect(p1.crescent).toMatch(/wall crescent/);
    const previewed = state((s) => { s.player.anchorKey = 'anchor-a1-inspection'; s.puzzles['preview:anchor-a1-inspection'] = 1; });
    expect(anchorPrompt(previewed, ctx())!.text).toBe('SHIFT DOWN');
    expect(anchorPrompt(previewed, ctx({ device: 'gamepad' }))!.glyph).toBe('LB');
    expect(anchorPrompt(previewed, ctx({ device: 'touch' }))!.glyph).toBe('Shift button');
  });

  it('anchor prompt works without a manifest from ShiftPreviewed axes', () => {
    const s = state((x) => { x.player.anchorKey = 'anchor-a1-inspection'; x.puzzles['preview:anchor-a1-inspection'] = 1; });
    const p = anchorPrompt(s, ctx({ manifest: null, previewTo: new Map([['anchor-a1-inspection', '-z']]) }))!;
    expect(p.crescent).toContain(crescentFor('-z').words);
  });

  it('interact prompt near the pressure map and control screen', () => {
    const atMap = state((s) => { s.player.pos = [18, 0, 3]; });
    expect(interactPrompt(atMap, ctx())?.text).toBe('Inspect pressure map');
    const atScreen = state((s) => { s.player.pos = [120, 14, 14]; s.keeper.phase = 4; });
    expect(interactPrompt(atScreen, ctx())?.text).toBe('Open control screen');
    expect(interactPrompt(atScreen, ctx({ device: 'gamepad' }))?.glyph).toBe('B');
  });

  it('glyphs mention mouse buttons for pulse/spike on keyboard', () => {
    expect(actionGlyph('pulse', 'keyboard', defaultSettings().bindings)).toBe('J / Left mouse');
  });
});

describe('captions and script log', () => {
  it('expires captions, keeps a deduplicated script log, routes DAWM to the display', () => {
    const log = new CaptionLog();
    log.push([{ id: 'S01', speaker: 'Kest', text: 'Tala, the tram is stopped beyond the gate. Four people aboard.', durationMs: 3000 }], 0);
    log.push([{ id: 'C-tram-bell', speaker: null, text: '[tram bell]', durationMs: 1500 }], 100);
    log.push([{ id: 'S01', speaker: 'Kest', text: 'Tala, the tram is stopped beyond the gate. Four people aboard.', durationMs: 3000 }], 200);
    expect(log.current(500).map((c) => c.id)).toEqual(['C-tram-bell', 'S01']);
    expect(log.current(500).find((c) => c.id === 'C-tram-bell')!.cue).toBe(true);
    expect(log.current(10_000)).toEqual([]);
    log.push([{ id: 'D01', speaker: 'DAWM', text: 'RELIEF CHANNEL: VERIFIED / PRESSURE TRANSFER: SAFE / GATE: OPEN', durationMs: 4000 }], 11_000);
    expect(log.current(11_001)).toEqual([]);
    expect(log.currentDisplay(11_001)?.id).toBe('D01');
    expect(log.script().map((e) => e.id)).toEqual(['S01', 'C-tram-bell', 'D01']);
    expect(log.lastDisplay()?.text).toContain('GATE: OPEN');
  });
});

describe('caption log clear on a new run', () => {
  it('clear() forgets the script so replayed lines log again', () => {
    const log = new CaptionLog();
    log.push([{ id: 'S01', speaker: 'Kest', text: 'x', durationMs: 1000 }], 0);
    log.clear();
    expect(log.script()).toEqual([]);
    log.push([{ id: 'S01', speaker: 'Kest', text: 'x', durationMs: 1000 }], 0);
    expect(log.script().length).toBe(1);
  });
});

describe('gamepad menu navigation edges', () => {
  it('reports each edge once', () => {
    const idle = { buttons: new Array(17).fill(0), axes: [0, 0] };
    const down = { buttons: Object.assign(new Array(17).fill(0), { 13: 1, 0: 1 }), axes: [0, 0] };
    expect(navEdges(idle, down).sort()).toEqual(['activate', 'down']);
    expect(navEdges(down, down)).toEqual([]);
    expect(navEdges(null, { buttons: [0, 1], axes: [0, -1] }).sort()).toEqual(['back', 'up']);
  });
});
