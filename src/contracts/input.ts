import type { Destination } from './pressure';
import type { Vec2 } from './math';

/**
 * Device-independent command for exactly one simulation tick (ADR 0004).
 * Keyboard, gamepad and touch all normalise to this shape.
 * `control` is a coordinator-approved extension carrying discrete control-screen actions.
 */
export interface InputCommand {
  readonly tick: number;
  /** [strafe, forward] each in [-1, 1], relative to player yaw on the current surface. */
  readonly move2: Vec2;
  /** [yawDelta, pitchDelta] radians for this tick, each clamped to [-MAX_LOOK, MAX_LOOK]. */
  readonly look2: Vec2;
  readonly jump: boolean;
  readonly pulse: boolean;
  readonly spike: boolean;
  /** Request a shift at this anchor key; the target is the anchor's other authored surface. */
  readonly shiftAnchorId: string | null;
  readonly interact: boolean;
  readonly pause: boolean;
  readonly control: ControlAction | null;
}

export const MAX_LOOK = 0.25;

export type ControlAction =
  | { readonly kind: 'open-panel' }
  | { readonly kind: 'close-panel' }
  | { readonly kind: 'scan-sensor' }
  | { readonly kind: 'preview'; readonly destination: Destination }
  | { readonly kind: 'restore-edge' }
  | { readonly kind: 'authorize'; readonly destination: Destination };

export const IDLE_COMMAND: Omit<InputCommand, 'tick'> = {
  move2: [0, 0],
  look2: [0, 0],
  jump: false,
  pulse: false,
  spike: false,
  shiftAnchorId: null,
  interact: false,
  pause: false,
  control: null,
};

export function idle(tick: number): InputCommand {
  return { tick, ...IDLE_COMMAND };
}
