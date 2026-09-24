/**
 * English interface copy (locale 'en'), keyed so a fr-CA bundle can replace it later.
 * Dialogue and pressure reasons are NOT here: they come from the authored manifest/dialogue data.
 */
import type { ActionName, InputDevice } from '../contracts/ui';
import type { Destination } from '../contracts/pressure';
import type { Axis } from '../contracts/math';

export const EN = {
  title: 'Agents of the Dawm',
  subtitle: 'Floodline',
  tagline: 'Dawn. The floodgate is locked. Four people wait on the stranded tram.',
  play: 'Play',
  continue: 'Continue',
  settings: 'Settings',
  quality: 'Quality',
  captions: 'Captions',
  on: 'On',
  off: 'Off',
  resume: 'Resume',
  restartCheckpoint: 'Restart checkpoint',
  resetSave: 'Reset save',
  resetConfirmTitle: 'Reset local save?',
  resetConfirmBody: 'This deletes the saved checkpoint on this device. Settings are kept.',
  resetConfirmYes: 'Delete save',
  cancel: 'Cancel',
  back: 'Back',
  close: 'Close',
  paused: 'Paused',
  script: 'Script',
  scriptTitle: 'Script so far',
  scriptEmpty: 'No lines yet.',
  replay: 'Replay',
  credits: 'Credits',
  creditsBody: [
    'Agents of the Dawm: Floodline is an original work.',
    'World, characters, dialogue, interface marks, music and sound are original to this project; no borrowed characters, settings or branding.',
    'The district, the relief-channel sensor and every pressure value are fictional, authored game evidence. Nothing real is measured.',
  ],
  endingTitle: 'The tram crossed',
  endingBody: 'The relief channel took the pressure. The gate opened. Four people are safe.',
  fatalTitle: 'Floodline cannot start here',
  retry: 'Retry',
  useWebgl2: 'Use WebGL2',
  health: 'Health',
  charge: 'Charge',
  overdrive: 'Overdrive',
  objective: 'Objective',
  readiness: {
    initializing: 'Preparing controls…',
    controllable: 'Controls ready',
    'optional-loading': 'Controls ready · loading scenery detail',
    complete: 'Ready',
  },
  backend: { webgpu: 'WebGPU', webgl2: 'WebGL2', none: 'no renderer' },
  previewDown: 'PREVIEW DOWN',
  shiftDown: 'SHIFT DOWN',
  anchorOffline: 'Anchor offline: crescent not yet white',
  stepIntoField: 'Step into the marked field',
} as const;

export const NODE_LABELS: Record<string, string> = {
  reservoir: 'Reservoir',
  'protected-pump': 'Protected pump',
  'locked-gate': 'Locked gate',
  tram: 'Tram',
  'occupied-street': 'Occupied street',
  'relief-channel': 'Relief channel',
};

export const DESTINATION_LABELS: Record<Destination, string> = {
  'occupied-street': 'Occupied street',
  'protected-pump': 'Protected pump',
  'relief-channel': 'Relief channel',
};

export const CONTROL = {
  title: 'Local pressure control',
  subtitle: 'DAWM approved-route graph · fictional district',
  graphTitle: 'Pressure graph: reservoir, pump, gate, tram, street and relief channel',
  missingEdge: 'approved route missing',
  restoredEdge: 'approved route restored',
  routes: 'Destinations',
  projected: 'Projected',
  limit: 'Safe limit',
  occupied: 'People present',
  unoccupied: 'No people',
  unknownOccupancy: 'Occupancy unverified',
  safe: 'SAFE',
  unsafe: 'UNSAFE',
  safeLong: 'Within tolerance',
  unsafeLong: 'Rejected by preflight',
  preview: 'Preview',
  previewed: 'Previewed',
  selected: 'Selected',
  scan: 'Scan relief sensor',
  scanned: 'Sensor scanned',
  restore: 'Restore reservoir → relief route',
  restored: 'Route restored',
  authorize: 'Authorize transfer…',
  authorizeRejected: 'Cannot authorize',
  confirmTitle: 'Authorize pressure transfer?',
  confirm: 'Confirm transfer',
  checksTitle: 'Capacity checks',
  checksFor: 'for selected route',
  noSelection: 'No destination selected',
  pumpCheck: 'Pump within tolerance',
  streetCheck: 'Street not flooded by transfer',
  reliefCheck: 'Relief channel within tolerance',
  yes: 'yes',
  no: 'no',
  sensorTitle: 'Relief channel sensor',
  sensorLabel: 'Fictional in-world sensor: authored/synthetic game evidence, not real sensing.',
  sensorUnscanned: 'Not scanned yet.',
  sensorUnlocated: 'Channel not located in the district yet.',
  sensorClear: 'Scan result: no people present; capacity within tolerance.',
  sensorOccupied: 'Scan result: people present.',
  evidence: 'Evidence',
  evidenceAuthored: 'authored simulation',
  semanticReady: 'WorldGraph semantic provenance (projection only, not authority)',
  semanticUnavailable: 'Semantic detail unavailable — authored evidence',
  established: 'established',
  notEstablished: 'not yet',
  gateOpen: 'Transfer complete. Gate open.',
  previewIncomplete: 'Preview all three destinations before authorizing.',
  selectRelief: 'Preview the relief channel last to select it for authorization.',
  capacityNotSafe: 'Capacity checks for the relief channel are not all satisfied.',
  rejectedPrefix: 'Rejected',
  nothingRouted: 'Nothing was routed.',
} as const;

/** Label for a KeyboardEvent.code, for prompts and the remap panel. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    PageUp: 'PgUp', PageDown: 'PgDn', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  };
  return named[code] ?? code;
}

const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];

export function padLabel(button: number): string {
  return PAD_LABELS[button] ?? `Button ${button}`;
}

const TOUCH_LABELS: Partial<Record<ActionName, string>> = {
  jump: 'Jump', pulse: 'Pulse', spike: 'Spike', shift: 'Shift', interact: 'Use', pause: 'Pause',
};

export const ACTION_LABELS: Record<ActionName, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump', pulse: 'Pulse', spike: 'Spike', shift: 'Shift gravity', interact: 'Interact', pause: 'Pause',
  lookLeft: 'Look left', lookRight: 'Look right', lookUp: 'Look up', lookDown: 'Look down',
};

/** Device-localized glyph for an action, e.g. "F", "LB", "Shift button". */
export function actionGlyph(
  action: ActionName,
  device: InputDevice,
  bindings: { keyboard: Record<ActionName, string[]>; gamepad: Partial<Record<ActionName, number[]>> },
): string {
  if (device === 'gamepad') {
    const b = bindings.gamepad[action]?.[0];
    return b === undefined ? '—' : padLabel(b);
  }
  if (device === 'touch') return `${TOUCH_LABELS[action] ?? ACTION_LABELS[action]} button`;
  const extra = action === 'pulse' ? ' / Left mouse' : action === 'spike' ? ' / Right mouse' : '';
  const c = bindings.keyboard[action][0];
  return (c ? keyLabel(c) : '—') + extra;
}

/**
 * Crescent orientation for an anchor surface, drawn as a text glyph plus words so it never relies on
 * colour: floor surfaces open upward, wall surfaces open sideways, ceilings open downward.
 */
export function crescentFor(up: Axis): { glyph: string; words: string } {
  switch (up) {
    case '+y': return { glyph: '◡', words: 'floor crescent (down = floor)' };
    case '-y': return { glyph: '◠', words: 'ceiling crescent (down = ceiling)' };
    case '+x': case '+z': return { glyph: '◖', words: 'wall crescent (down = this wall)' };
    case '-x': case '-z': return { glyph: '◗', words: 'wall crescent (down = this wall)' };
  }
}
