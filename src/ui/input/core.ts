/**
 * Pure, DOM-free input core (G03). Keyboard, gamepad and touch all reduce to one RawDeviceState,
 * and `normalize` turns that into exactly one InputCommand for one simulation tick.
 *
 * Edge rule: raw state carries both what is held (`*Down`) and what was pressed since the last
 * sample (`*Pressed` latches; for the polled gamepad, `buttons` vs `prevButtons`). The stateful
 * accumulator in ./accumulator.ts clears the latches after the first tick of a frame, so a press
 * fires exactly once even when several ticks are sampled in one rendered frame.
 */
import type { ActionName, Bindings } from '../../contracts/ui';
import type { InputCommand } from '../../contracts/input';
import { MAX_LOOK } from '../../contracts/input';
import type { Vec2 } from '../../contracts/math';
import { TICK_MS } from '../../contracts/sim';

export const STICK_DEADZONE = 0.18;
export const TRIGGER_THRESHOLD = 0.5;
/** Radians per mouse pixel at sensitivity 1. */
export const MOUSE_RAD_PER_PX = 0.0022;
/** Radians per touch-drag pixel at sensitivity 1. */
export const TOUCH_RAD_PER_PX = 0.006;
/** Radians per second for look keys and a fully deflected right stick at sensitivity 1. */
export const LOOK_RATE = 2.4;
export const LOOK_CARRY_LIMIT = MAX_LOOK * 4;

export const EDGE_ACTIONS = ['jump', 'pulse', 'spike', 'shift', 'interact', 'pause'] as const;
export type EdgeAction = (typeof EDGE_ACTIONS)[number];

export interface GamepadSnapshot {
  readonly axes: readonly number[];
  /** Button values in [0, 1] (standard mapping). */
  readonly buttons: readonly number[];
}

export interface RawDeviceState {
  readonly keysDown: ReadonlySet<string>;
  readonly keysPressed: ReadonlySet<string>;
  /** Pointer-lock mouse movement since the last consumed sample, in CSS pixels. */
  readonly mouseDx: number;
  readonly mouseDy: number;
  /** Mouse buttons: 0 = left (pulse), 2 = right (spike). */
  readonly mouseDown: ReadonlySet<number>;
  readonly mousePressed: ReadonlySet<number>;
  readonly gamepad: GamepadSnapshot | null;
  readonly gamepadPrevButtons: readonly number[];
  /** Virtual stick in normalized [strafe, forward], magnitude <= 1. */
  readonly touchMove: Vec2;
  readonly touchLookDx: number;
  readonly touchLookDy: number;
  readonly touchDown: ReadonlySet<ActionName>;
  readonly touchPressed: ReadonlySet<ActionName>;
  /** Look radians left over from clamping the previous tick (pointer and drag only). */
  readonly lookCarry: Vec2;
}

export interface NormalizeSettings {
  readonly lookSensitivity: number;
  readonly invertY: boolean;
}

export interface NormalizeFrame {
  readonly tick: number;
  readonly uiCapturing: boolean;
  /** Anchor whose volume the player is inside (state.player.anchorKey). */
  readonly anchorKey: string | null;
}

export interface NormalizeResult {
  readonly command: InputCommand;
  /** Unclamped look minus what was applied, to carry into the next tick. */
  readonly lookCarry: Vec2;
  /** Actions held this tick (for previews and touch context). */
  readonly held: ReadonlySet<ActionName>;
}

export const EMPTY_RAW: RawDeviceState = {
  keysDown: new Set(), keysPressed: new Set(), mouseDx: 0, mouseDy: 0, mouseDown: new Set(), mousePressed: new Set(),
  gamepad: null, gamepadPrevButtons: [], touchMove: [0, 0], touchLookDx: 0, touchLookDy: 0,
  touchDown: new Set(), touchPressed: new Set(), lookCarry: [0, 0],
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Radial deadzone with rescale so a fully deflected stick still reaches magnitude 1. */
export function applyDeadzone(x: number, y: number, dz = STICK_DEADZONE): Vec2 {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const m = Math.hypot(fx, fy);
  if (m <= dz) return [0, 0];
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return [(fx / m) * scaled, (fy / m) * scaled];
}

/** Clamp a 2D vector to magnitude 1 (keyboard diagonals match a 45 degree stick). */
export function clampUnit(v: Vec2): Vec2 {
  const m = Math.hypot(v[0], v[1]);
  return m > 1 ? [v[0] / m, v[1] / m] : v;
}

/** Normalized virtual-stick vector from a touch offset (screen y grows downward). */
export function stickVector(dx: number, dy: number, radius: number, deadzone = 0.12): Vec2 {
  if (!(radius > 0)) return [0, 0];
  const [x, y] = applyDeadzone(dx / radius, dy / radius, deadzone);
  return [x, y === 0 ? 0 : -y];
}

const pressedValue = (v: number | undefined): boolean => (v ?? 0) > TRIGGER_THRESHOLD;

function padDown(raw: RawDeviceState, list: readonly number[] | undefined): boolean {
  if (!raw.gamepad || !list) return false;
  return list.some((b) => pressedValue(raw.gamepad!.buttons[b]));
}

function padPressed(raw: RawDeviceState, list: readonly number[] | undefined): boolean {
  if (!raw.gamepad || !list) return false;
  return list.some((b) => pressedValue(raw.gamepad!.buttons[b]) && !pressedValue(raw.gamepadPrevButtons[b]));
}

const MOUSE_FOR: Partial<Record<ActionName, number>> = { pulse: 0, spike: 2 };

/** Is `action` held on any device? */
export function isHeld(raw: RawDeviceState, bindings: Bindings, action: ActionName): boolean {
  if (bindings.keyboard[action]?.some((c) => raw.keysDown.has(c))) return true;
  const mb = MOUSE_FOR[action];
  if (mb !== undefined && raw.mouseDown.has(mb)) return true;
  if (padDown(raw, bindings.gamepad[action])) return true;
  return raw.touchDown.has(action);
}

/** Was `action` newly pressed since the last consumed sample on any device? */
export function wasPressed(raw: RawDeviceState, bindings: Bindings, action: ActionName): boolean {
  if (bindings.keyboard[action]?.some((c) => raw.keysPressed.has(c))) return true;
  const mb = MOUSE_FOR[action];
  if (mb !== undefined && raw.mousePressed.has(mb)) return true;
  if (padPressed(raw, bindings.gamepad[action])) return true;
  return raw.touchPressed.has(action);
}

function axis(raw: RawDeviceState, bindings: Bindings, neg: ActionName, pos: ActionName): number {
  return (isHeld(raw, bindings, pos) ? 1 : 0) - (isHeld(raw, bindings, neg) ? 1 : 0);
}

function moveVector(raw: RawDeviceState, bindings: Bindings): Vec2 {
  const kx = axis(raw, bindings, 'left', 'right');
  const ky = axis(raw, bindings, 'back', 'forward');
  let x = kx;
  let y = ky;
  if (raw.gamepad) {
    const [sx, sy] = applyDeadzone(raw.gamepad.axes[0] ?? 0, raw.gamepad.axes[1] ?? 0);
    x += sx;
    y -= sy; // stick y grows downward
  }
  x += raw.touchMove[0];
  y += raw.touchMove[1];
  const [cx, cy] = clampUnit([clamp(x, -1, 1), clamp(y, -1, 1)]);
  return [cx + 0, cy + 0]; // normalise -0 to 0
}

/** Unclamped look radians for this tick. Positive yaw turns left; positive pitch looks up. */
export function rawLook(raw: RawDeviceState, bindings: Bindings, settings: NormalizeSettings): Vec2 {
  const sens = clamp(Number.isFinite(settings.lookSensitivity) ? settings.lookSensitivity : 1, 0.05, 10);
  const inv = settings.invertY ? -1 : 1;
  const dt = TICK_MS / 1000;
  let yaw = -raw.mouseDx * MOUSE_RAD_PER_PX * sens - raw.touchLookDx * TOUCH_RAD_PER_PX * sens;
  let pitch = (-raw.mouseDy * MOUSE_RAD_PER_PX * sens - raw.touchLookDy * TOUCH_RAD_PER_PX * sens) * inv;
  const keyYaw = axis(raw, bindings, 'lookRight', 'lookLeft');
  const keyPitch = axis(raw, bindings, 'lookDown', 'lookUp');
  yaw += keyYaw * LOOK_RATE * dt * sens;
  pitch += keyPitch * LOOK_RATE * dt * sens * inv;
  if (raw.gamepad) {
    const [rx, ry] = applyDeadzone(raw.gamepad.axes[2] ?? 0, raw.gamepad.axes[3] ?? 0);
    yaw += -rx * LOOK_RATE * dt * sens;
    pitch += -ry * LOOK_RATE * dt * sens * inv;
  }
  return [yaw + raw.lookCarry[0], pitch + raw.lookCarry[1]];
}

/** One device-independent command for one tick. `control` is always null here (see accumulator). */
export function normalizeDetailed(
  raw: RawDeviceState,
  bindings: Bindings,
  settings: NormalizeSettings,
  frame: NormalizeFrame,
): NormalizeResult {
  const held = new Set<ActionName>();
  for (const a of Object.keys(bindings.keyboard) as ActionName[]) if (isHeld(raw, bindings, a)) held.add(a);
  if (frame.uiCapturing) {
    return {
      command: { tick: frame.tick, move2: [0, 0], look2: [0, 0], jump: false, pulse: false, spike: false,
        shiftAnchorId: null, interact: false, pause: false, control: null },
      lookCarry: [0, 0],
      held,
    };
  }
  const [ly, lp] = rawLook(raw, bindings, settings);
  const look2: Vec2 = [clamp(ly, -MAX_LOOK, MAX_LOOK) + 0, clamp(lp, -MAX_LOOK, MAX_LOOK) + 0];
  const carry: Vec2 = [clamp(ly - look2[0], -LOOK_CARRY_LIMIT, LOOK_CARRY_LIMIT), clamp(lp - look2[1], -LOOK_CARRY_LIMIT, LOOK_CARRY_LIMIT)];
  const pressed = (a: EdgeAction) => wasPressed(raw, bindings, a);
  const shift = pressed('shift');
  return {
    command: {
      tick: frame.tick,
      move2: moveVector(raw, bindings),
      look2,
      jump: pressed('jump'),
      pulse: pressed('pulse'),
      spike: pressed('spike'),
      shiftAnchorId: shift ? frame.anchorKey : null,
      interact: pressed('interact'),
      pause: pressed('pause'),
      control: null,
    },
    lookCarry: carry,
    held,
  };
}

/** `normalize(rawDeviceState, bindings, settings) -> InputCommand` for one tick. */
export function normalize(
  raw: RawDeviceState,
  bindings: Bindings,
  settings: NormalizeSettings,
  frame: NormalizeFrame = { tick: 0, uiCapturing: false, anchorKey: null },
): InputCommand {
  return normalizeDetailed(raw, bindings, settings, frame).command;
}
