/**
 * Stateful but DOM-free input accumulator. DOM listeners (./dom.ts) only call the event methods;
 * `sample(ctx)` builds a RawDeviceState, normalizes it and then consumes the latches, so every
 * edge-triggered action fires exactly once per press however many ticks a frame samples.
 */
import type { ActionName, InputDevice, InputSampleContext } from '../../contracts/ui';
import type { ControlAction, InputCommand } from '../../contracts/input';
import type { LevelManifest } from '../../contracts/manifest';
import type { Vec2, Vec3 } from '../../contracts/math';
import { axisToVec } from '../../contracts/math';
import type { SimState } from '../../contracts/sim';
import { PLAYER_BODY } from '../../contracts/sim';
import type { GamepadSnapshot, RawDeviceState } from './core';
import { applyDeadzone, normalizeDetailed, TRIGGER_THRESHOLD } from './core';

/** An anchor counts as "nearby" for the preview ghost within this distance of its volume. */
export const ANCHOR_NEAR_M = 3;
/** While the shift action is held, preview the nearest anchor within this distance. */
export const ANCHOR_SHIFT_PREVIEW_M = 8;
const MAX_CONTROL_QUEUE = 16;

export interface InputAccumulator {
  keyDown(code: string, repeat?: boolean): void;
  keyUp(code: string): void;
  mouseMove(dx: number, dy: number): void;
  mouseButton(button: number, down: boolean): void;
  /** Latest polled gamepad (null when none is connected). Call before `sample`. */
  setGamepad(pad: GamepadSnapshot | null): void;
  touchStick(v: Vec2): void;
  touchLook(dx: number, dy: number): void;
  touchButton(action: ActionName, down: boolean): void;
  /** Window blur / pointer-lock loss: release everything held so no key sticks. */
  releaseAll(): void;
  /** Request a pause edge on the next sample (e.g. pointer lock lost by Esc). */
  requestPause(): void;
  sample(ctx: InputSampleContext): InputCommand;
  queueControl(action: ControlAction): void;
  previewAnchorKey(): string | null;
  activeDevice(): InputDevice;
  /** Actions held at the last sample (touch context buttons, prompts). */
  held(): ReadonlySet<ActionName>;
}

function distToBox(p: Vec3, min: Vec3, max: Vec3): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i]!;
    const d = v < min[i]! ? min[i]! - v : v > max[i]! ? v - max[i]! : 0;
    s += d * d;
  }
  return Math.sqrt(s);
}

export function bodyCenterOf(s: Readonly<SimState>): Vec3 {
  const u = axisToVec(s.player.up);
  const h = PLAYER_BODY.height / 2;
  const f = s.player.pos;
  return [f[0] + u[0] * h, f[1] + u[1] * h, f[2] + u[2] * h];
}

/** Nearest anchor within `maxM` of the player's feet, or null. */
export function nearestAnchor(m: LevelManifest, s: Readonly<SimState>, maxM: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const a of m.geometry.anchors) {
    const d = distToBox(s.player.pos, a.volume.min, a.volume.max);
    if (d <= maxM && d < bestD) { best = a.key; bestD = d; }
  }
  return best;
}

/** True when the player body centre is within the control-screen interactable radius. */
export function nearControlScreen(m: LevelManifest, s: Readonly<SimState>): boolean {
  const it = m.geometry.interactables.find((i) => i.kind === 'control-screen');
  if (!it) return false;
  const c = bodyCenterOf(s);
  return Math.hypot(c[0] - it.pos[0], c[1] - it.pos[1], c[2] - it.pos[2]) <= it.radius;
}

/** Near any non-pickup interactable (prompt / touch "Use" button context). */
export function nearInteractable(m: LevelManifest, s: Readonly<SimState>): string | null {
  const c = bodyCenterOf(s);
  let best: string | null = null;
  let bestD = Infinity;
  for (const it of m.geometry.interactables) {
    if (it.kind === 'charge-cell' || it.kind === 'overdrive-cell') continue;
    const d = Math.hypot(c[0] - it.pos[0], c[1] - it.pos[1], c[2] - it.pos[2]);
    if (d <= it.radius && d < bestD) { best = it.key; bestD = d; }
  }
  return best;
}

export function createAccumulator(): InputAccumulator {
  const keysDown = new Set<string>();
  let keysPressed = new Set<string>();
  const mouseDown = new Set<number>();
  let mousePressed = new Set<number>();
  let mouseDx = 0;
  let mouseDy = 0;
  let pad: GamepadSnapshot | null = null;
  let padPrev: number[] = [];
  let touchMove: Vec2 = [0, 0];
  let touchDx = 0;
  let touchDy = 0;
  const touchDown = new Set<ActionName>();
  let touchPressed = new Set<ActionName>();
  let lookCarry: Vec2 = [0, 0];
  let pauseRequested = false;
  const queue: ControlAction[] = [];
  let preview: string | null = null;
  let device: InputDevice = 'keyboard';
  let lastHeld: ReadonlySet<ActionName> = new Set();

  const padActive = (p: GamepadSnapshot): boolean =>
    p.buttons.some((v, i) => v > TRIGGER_THRESHOLD && !(padPrev[i]! > TRIGGER_THRESHOLD))
    || applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0)[0] !== 0 || applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0)[1] !== 0
    || applyDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0)[0] !== 0 || applyDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0)[1] !== 0;

  return {
    keyDown(code, repeat = false) {
      device = 'keyboard';
      if (!keysDown.has(code) && !repeat) keysPressed.add(code);
      keysDown.add(code);
    },
    keyUp(code) { keysDown.delete(code); },
    mouseMove(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      device = 'keyboard';
      mouseDx += dx;
      mouseDy += dy;
    },
    mouseButton(button, down) {
      device = 'keyboard';
      if (down) { if (!mouseDown.has(button)) mousePressed.add(button); mouseDown.add(button); } else mouseDown.delete(button);
    },
    setGamepad(p) {
      if (p && padActive(p)) device = 'gamepad';
      pad = p;
    },
    touchStick(v) { device = 'touch'; touchMove = v; },
    touchLook(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      device = 'touch';
      touchDx += dx;
      touchDy += dy;
    },
    touchButton(action, down) {
      device = 'touch';
      if (down) { if (!touchDown.has(action)) touchPressed.add(action); touchDown.add(action); } else touchDown.delete(action);
    },
    releaseAll() {
      keysDown.clear();
      mouseDown.clear();
      touchDown.clear();
      touchMove = [0, 0];
    },
    requestPause() { pauseRequested = true; },
    sample(ctx) {
      const s = ctx.state;
      const raw: RawDeviceState = {
        keysDown, keysPressed, mouseDx, mouseDy, mouseDown, mousePressed,
        gamepad: pad, gamepadPrevButtons: padPrev,
        touchMove, touchLookDx: touchDx, touchLookDy: touchDy, touchDown, touchPressed, lookCarry,
      };
      const res = normalizeDetailed(raw, ctx.settings.bindings, ctx.settings, {
        // Outside every volume a shift still reaches the sim (nearest player anchor), so the engine
        // emits ShiftRejected with feedback instead of the press vanishing (ADR 0004 failure trace, VR6).
        tick: ctx.tick, uiCapturing: ctx.uiCapturing, anchorKey: s.player.anchorKey ?? nearestPlayerAnchor(ctx.manifest, s.player.pos),
      });
      // Consume latches and pointer deltas: later ticks of the same frame see no new presses.
      keysPressed = new Set();
      mousePressed = new Set();
      touchPressed = new Set();
      mouseDx = 0;
      mouseDy = 0;
      touchDx = 0;
      touchDy = 0;
      padPrev = pad ? [...pad.buttons] : [];
      lookCarry = res.lookCarry;
      lastHeld = res.held;

      let cmd = res.command;
      if (pauseRequested) {
        pauseRequested = false;
        if (!ctx.uiCapturing) cmd = { ...cmd, pause: true };
      }
      let control: ControlAction | null = queue.shift() ?? null;
      // Interact at the control screen opens the panel (the sim has no interact case for it).
      if (!control && cmd.interact && !s.pressure.panelOpen && nearControlScreen(ctx.manifest, s)) {
        control = { kind: 'open-panel' };
      }
      if (control) cmd = { ...cmd, control };

      const shiftHeld = res.held.has('shift');
      if (ctx.uiCapturing) preview = null;
      else if (s.player.anchorKey) preview = s.player.anchorKey;
      else preview = nearestAnchor(ctx.manifest, s, shiftHeld ? ANCHOR_SHIFT_PREVIEW_M : ANCHOR_NEAR_M);
      return cmd;
    },
    queueControl(action) {
      if (queue.length < MAX_CONTROL_QUEUE) queue.push(action);
    },
    previewAnchorKey: () => preview,
    activeDevice: () => device,
    held: () => lastHeld,
  };
}

/** Nearest player-target anchor by volume centre; the sim rejects it when the player is outside its volume. */
export function nearestPlayerAnchor(m: LevelManifest | undefined, pos: Vec3): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const an of m?.geometry.anchors ?? []) {
    if (an.target !== 'player') continue;
    const c = [0, 1, 2].map((i) => (an.volume.min[i]! + an.volume.max[i]!) / 2);
    const d = (c[0]! - pos[0]) ** 2 + (c[1]! - pos[1]) ** 2 + (c[2]! - pos[2]) ** 2;
    if (d < bestD) { bestD = d; best = an.key; }
  }
  return best;
}
