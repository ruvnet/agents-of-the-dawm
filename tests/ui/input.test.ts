import { describe, expect, it } from 'vitest';
import type { InputCommand, InputSampleContext, SimState, UiSettings } from '../../src/contracts';
import { MAX_LOOK } from '../../src/contracts';
import { createAccumulator, type InputAccumulator } from '../../src/ui/input/accumulator';
import { applyDeadzone, EMPTY_RAW, normalize, stickVector, type GamepadSnapshot } from '../../src/ui/input/core';
import { defaultSettings, rebind } from '../../src/ui/settings';
import { manifest, newSim } from '../sim/helpers';

const baseState = newSim(1047).state();

function ctx(tick: number, over: Partial<InputSampleContext> = {}, state: Readonly<SimState> = baseState, settings: UiSettings = defaultSettings()): InputSampleContext {
  return { tick, state, manifest, uiCapturing: false, settings, ...over };
}

function withPlayer(p: Partial<SimState['player']>, extra: Partial<SimState> = {}): SimState {
  const s = structuredClone(baseState) as SimState;
  Object.assign(s.player, p);
  Object.assign(s, extra);
  return s;
}

// ------------------------------------------------------------------ abstract action traces (G03)

type Move = 'none' | 'forward' | 'back' | 'left' | 'right' | 'forward-right';
type Press = 'jump' | 'pulse' | 'spike' | 'shift' | 'interact' | 'pause';
interface Step { move: Move; press: Press[] }

const TRACE: Step[] = [
  { move: 'none', press: [] },
  { move: 'forward', press: [] },
  { move: 'forward', press: ['jump'] },
  { move: 'forward-right', press: [] },
  { move: 'forward-right', press: ['pulse'] },
  { move: 'right', press: ['spike'] },
  { move: 'left', press: [] },
  { move: 'back', press: ['interact'] },
  { move: 'none', press: ['shift'] },
  { move: 'none', press: ['jump', 'pulse'] },
  { move: 'none', press: ['pause'] },
  { move: 'none', press: [] },
];

interface Driver { apply(acc: InputAccumulator, step: Step, prev: Step | null): void }

const KEY_FOR: Record<Press, string> = { jump: 'Space', pulse: 'KeyJ', spike: 'KeyK', shift: 'KeyF', interact: 'KeyE', pause: 'Escape' };
const MOVE_KEYS: Record<Move, string[]> = {
  none: [], forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], 'forward-right': ['KeyW', 'KeyD'],
};
const STICK: Record<Move, [number, number]> = {
  none: [0, 0], forward: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0], 'forward-right': [Math.SQRT1_2, -Math.SQRT1_2],
};
const PAD_FOR: Record<Press, number> = { jump: 0, pulse: 2, spike: 7, shift: 4, interact: 1, pause: 9 };
const TOUCH_MOVE: Record<Move, [number, number]> = {
  none: [0, 0], forward: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0], 'forward-right': [Math.SQRT1_2, Math.SQRT1_2],
};

const keyboard: Driver = {
  apply(acc, step, prev) {
    for (const k of prev ? MOVE_KEYS[prev.move] : []) acc.keyUp(k);
    for (const p of prev?.press ?? []) acc.keyUp(KEY_FOR[p]);
    for (const k of MOVE_KEYS[step.move]) acc.keyDown(k);
    for (const p of step.press) acc.keyDown(KEY_FOR[p]);
  },
};
const gamepad: Driver = {
  apply(acc, step) {
    const buttons = new Array(17).fill(0);
    for (const p of step.press) buttons[PAD_FOR[p]] = 1;
    const [x, y] = STICK[step.move];
    const pad: GamepadSnapshot = { axes: [x, y, 0, 0], buttons };
    acc.setGamepad(pad);
  },
};
const touch: Driver = {
  apply(acc, step, prev) {
    for (const p of prev?.press ?? []) acc.touchButton(p, false);
    acc.touchStick(TOUCH_MOVE[step.move]);
    for (const p of step.press) acc.touchButton(p, true);
  },
};

function run(driver: Driver, trace: Step[], state = baseState): InputCommand[] {
  const acc = createAccumulator();
  const out: InputCommand[] = [];
  let prev: Step | null = null;
  trace.forEach((step, i) => {
    driver.apply(acc, step, prev);
    out.push(acc.sample(ctx(i, {}, state)));
    prev = step;
  });
  return out;
}

function expectSameTrace(a: InputCommand[], b: InputCommand[]): void {
  expect(a.length).toBe(b.length);
  a.forEach((c, i) => {
    const d = b[i]!;
    expect(c.move2[0]).toBeCloseTo(d.move2[0], 9);
    expect(c.move2[1]).toBeCloseTo(d.move2[1], 9);
    expect({ ...c, move2: null }).toEqual({ ...d, move2: null });
  });
}

describe('G03: keyboard, gamepad and touch produce equivalent normalized traces', () => {
  const inAnchor = withPlayer({ anchorKey: 'anchor-a1-inspection' });
  const kb = run(keyboard, TRACE, inAnchor);
  const gp = run(gamepad, TRACE, inAnchor);
  const tc = run(touch, TRACE, inAnchor);

  it('keyboard == gamepad == touch for the same abstract actions', () => {
    expectSameTrace(kb, gp);
    expectSameTrace(kb, tc);
  });

  it('the trace itself is the intended one', () => {
    expect(kb[1]!.move2).toEqual([0, 1]);
    expect(kb[3]!.move2[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(kb[3]!.move2[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(kb.map((c) => c.jump)).toEqual(TRACE.map((s) => s.press.includes('jump')));
    expect(kb[8]!.shiftAnchorId).toBe('anchor-a1-inspection');
    expect(kb[10]!.pause).toBe(true);
    expect(kb.every((c) => c.look2[0] === 0 && c.look2[1] === 0)).toBe(true);
  });
});

describe('edge-triggered actions fire exactly once per press', () => {
  it('keyboard: one press sampled over a 5-tick catch-up frame fires once', () => {
    const acc = createAccumulator();
    acc.keyDown('KeyJ');
    const cmds = [0, 1, 2, 3, 4].map((t) => acc.sample(ctx(t)));
    expect(cmds.map((c) => c.pulse)).toEqual([true, false, false, false, false]);
  });

  it('key auto-repeat does not re-fire', () => {
    const acc = createAccumulator();
    acc.keyDown('Space');
    expect(acc.sample(ctx(0)).jump).toBe(true);
    acc.keyDown('Space', true);
    expect(acc.sample(ctx(1)).jump).toBe(false);
  });

  it('press and release between two samples still fires once', () => {
    const acc = createAccumulator();
    acc.keyDown('KeyK');
    acc.keyUp('KeyK');
    expect(acc.sample(ctx(0)).spike).toBe(true);
    expect(acc.sample(ctx(1)).spike).toBe(false);
  });

  it('gamepad: a held button polled every tick fires once; release then press fires again', () => {
    const acc = createAccumulator();
    const down: GamepadSnapshot = { axes: [0, 0, 0, 0], buttons: [1] };
    const up: GamepadSnapshot = { axes: [0, 0, 0, 0], buttons: [0] };
    const seq = [down, down, down, up, down].map((p, t) => { acc.setGamepad(p); return acc.sample(ctx(t)).jump; });
    expect(seq).toEqual([true, false, false, false, true]);
  });

  it('touch: a held button fires once', () => {
    const acc = createAccumulator();
    acc.touchButton('pulse', true);
    expect([0, 1, 2].map((t) => acc.sample(ctx(t)).pulse)).toEqual([true, false, false]);
  });

  it('mouse buttons map to pulse (left) and spike (right)', () => {
    const acc = createAccumulator();
    acc.mouseButton(0, true);
    acc.mouseButton(2, true);
    const c = acc.sample(ctx(0));
    expect([c.pulse, c.spike]).toEqual([true, true]);
    expect(acc.sample(ctx(1)).pulse).toBe(false);
  });
});

describe('uiCapturing idles movement and actions; only control actions pass', () => {
  it('idles move, look and edges, drops pause, passes queued control', () => {
    const acc = createAccumulator();
    acc.keyDown('KeyW');
    acc.keyDown('Space');
    acc.keyDown('Escape');
    acc.mouseMove(50, 20);
    acc.queueControl({ kind: 'scan-sensor' });
    const c = acc.sample(ctx(0, { uiCapturing: true }));
    expect(c.move2).toEqual([0, 0]);
    expect(c.look2).toEqual([0, 0]);
    expect([c.jump, c.pulse, c.spike, c.interact, c.pause, c.shiftAnchorId]).toEqual([false, false, false, false, false, null]);
    expect(c.control).toEqual({ kind: 'scan-sensor' });
    expect(acc.previewAnchorKey()).toBeNull();
  });

  it('a press made while capturing does not fire after the capture ends', () => {
    const acc = createAccumulator();
    acc.keyDown('Space');
    expect(acc.sample(ctx(0, { uiCapturing: true })).jump).toBe(false);
    const after = acc.sample(ctx(1));
    expect(after.jump).toBe(false);
    acc.keyUp('Space');
  });

  it('queued controls come out one per tick, in order', () => {
    const acc = createAccumulator();
    acc.queueControl({ kind: 'open-panel' });
    acc.queueControl({ kind: 'preview', destination: 'relief-channel' });
    expect(acc.sample(ctx(0)).control).toEqual({ kind: 'open-panel' });
    expect(acc.sample(ctx(1)).control).toEqual({ kind: 'preview', destination: 'relief-channel' });
    expect(acc.sample(ctx(2)).control).toBeNull();
  });

  it('releaseAll clears held keys (blur / pointer-lock loss)', () => {
    const acc = createAccumulator();
    acc.keyDown('KeyW');
    acc.releaseAll();
    expect(acc.sample(ctx(0)).move2).toEqual([0, 0]);
  });
});

describe('remapping, look scaling and anchors', () => {
  it('remap: rebinding pulse to KeyL moves the action and removes the old conflict', () => {
    const s = defaultSettings();
    const remapped = { ...s, bindings: rebind(s.bindings, 'keyboard', 'pulse', 'KeyL') };
    expect(remapped.bindings.keyboard.pulse[0]).toBe('KeyL');
    const acc = createAccumulator();
    acc.keyDown('KeyL');
    expect(acc.sample(ctx(0, {}, baseState, remapped)).pulse).toBe(true);
    acc.keyDown('KeyJ');
    // KeyJ is still a secondary pulse binding here; rebinding Space to pulse must remove it from jump.
    const r2 = { ...s, bindings: rebind(s.bindings, 'keyboard', 'pulse', 'Space') };
    expect(r2.bindings.keyboard.jump).not.toContain('Space');
    const acc2 = createAccumulator();
    acc2.keyDown('Space');
    const c = acc2.sample(ctx(0, {}, baseState, r2));
    expect([c.pulse, c.jump]).toEqual([true, false]);
  });

  it('gamepad remap', () => {
    const s = defaultSettings();
    const r = { ...s, bindings: rebind(s.bindings, 'gamepad', 'jump', 3) };
    const acc = createAccumulator();
    acc.setGamepad({ axes: [], buttons: [0, 0, 0, 1] });
    const c = acc.sample(ctx(0, {}, baseState, r));
    expect([c.jump, c.interact]).toEqual([true, false]);
  });

  it('look2 is clamped to MAX_LOOK and the remainder carries over bounded ticks', () => {
    const acc = createAccumulator();
    acc.mouseMove(1000, 0);
    const a = acc.sample(ctx(0));
    expect(a.look2[0]).toBe(-MAX_LOOK);
    const rest = [1, 2, 3, 4, 5, 6].map((t) => acc.sample(ctx(t)).look2[0]);
    expect(rest.every((v) => v >= -MAX_LOOK && v <= 0)).toBe(true);
    expect(rest[rest.length - 1]).toBe(0);
  });

  it('sensitivity scales and invertY flips pitch', () => {
    const s = defaultSettings();
    const raw = { ...EMPTY_RAW, mouseDx: 10, mouseDy: -10 };
    const base = normalize(raw, s.bindings, { lookSensitivity: 1, invertY: false });
    const fast = normalize(raw, s.bindings, { lookSensitivity: 2, invertY: false });
    const inv = normalize(raw, s.bindings, { lookSensitivity: 1, invertY: true });
    expect(base.look2[0]).toBeLessThan(0); // mouse right turns right (negative yaw)
    expect(base.look2[1]).toBeGreaterThan(0); // mouse up looks up
    expect(fast.look2[0]).toBeCloseTo(base.look2[0] * 2, 12);
    expect(inv.look2[1]).toBeCloseTo(-base.look2[1], 12);
  });

  it('look keys and the right stick turn the same way as the mouse', () => {
    const s = defaultSettings();
    const key = normalize({ ...EMPTY_RAW, keysDown: new Set(['KeyR']) }, s.bindings, s);
    const stick = normalize({ ...EMPTY_RAW, gamepad: { axes: [0, 0, 1, 0], buttons: [] } }, s.bindings, s);
    expect(key.look2[0]).toBeLessThan(0);
    expect(stick.look2[0]).toBeLessThan(0);
  });

  it('shift targets the anchor the player is inside, else the nearest player anchor (sim rejects it, VR6)', () => {
    const acc = createAccumulator();
    acc.keyDown('KeyF');
    const outside = acc.sample(ctx(0)).shiftAnchorId;
    expect(outside).not.toBeNull();
    expect(manifest.geometry.anchors.find((a) => a.key === outside)?.target).toBe('player');
    acc.keyUp('KeyF');
    acc.keyDown('KeyF');
    const inside = withPlayer({ anchorKey: 'anchor-gantry' });
    expect(acc.sample(ctx(1, {}, inside)).shiftAnchorId).toBe('anchor-gantry');
    expect(acc.previewAnchorKey()).toBe('anchor-gantry');
  });

  it('previews a nearby anchor, and a farther one only while shift is held', () => {
    const a1 = manifest.geometry.anchors.find((a) => a.key === 'anchor-a1-inspection')!;
    const near = withPlayer({ pos: [a1.volume.min[0] - 2, 0, (a1.volume.min[2] + a1.volume.max[2]) / 2], anchorKey: null });
    const far = withPlayer({ pos: [a1.volume.min[0] - 6, 0, (a1.volume.min[2] + a1.volume.max[2]) / 2], anchorKey: null });
    const acc = createAccumulator();
    acc.sample(ctx(0, {}, near));
    expect(acc.previewAnchorKey()).toBe('anchor-a1-inspection');
    acc.sample(ctx(1, {}, far));
    expect(acc.previewAnchorKey()).toBeNull();
    acc.keyDown('KeyF');
    acc.sample(ctx(2, {}, far));
    expect(acc.previewAnchorKey()).toBe('anchor-a1-inspection');
  });

  it('interact at the control screen also requests open-panel', () => {
    const at = withPlayer({ pos: [120, 14, 14], up: '+y', anchorKey: null });
    const acc = createAccumulator();
    acc.keyDown('KeyE');
    const c = acc.sample(ctx(0, {}, at));
    expect(c.interact).toBe(true);
    expect(c.control).toEqual({ kind: 'open-panel' });
    acc.keyUp('KeyE');
    acc.keyDown('KeyE');
    expect(acc.sample(ctx(1)).control).toBeNull(); // away from the screen
  });

  it('active device follows the last input', () => {
    const acc = createAccumulator();
    acc.touchStick([0, 1]);
    expect(acc.activeDevice()).toBe('touch');
    acc.setGamepad({ axes: [0, 0, 0, 0], buttons: [1] });
    expect(acc.activeDevice()).toBe('gamepad');
    acc.keyDown('KeyW');
    expect(acc.activeDevice()).toBe('keyboard');
  });
});

describe('pure helpers', () => {
  it('deadzone rescales to full magnitude and drops small noise', () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual([0, 0]);
    const [x, y] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBe(0);
    expect(applyDeadzone(NaN, 1)[1]).toBeCloseTo(1, 12);
  });

  it('touch stick up is forward', () => {
    const [x, y] = stickVector(0, -50, 50);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
    expect(stickVector(0, 0, 0)).toEqual([0, 0]);
  });
});
