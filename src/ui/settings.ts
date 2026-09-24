/**
 * UiSettings defaults, validation and merge for untrusted stored settings (W4.UI.01).
 * Pure and DOM-free: safe to import from node tests.
 */
import type { ActionName, Bindings, UiSettings } from '../contracts/ui';

export const ACTIONS: readonly ActionName[] = [
  'forward', 'back', 'left', 'right', 'jump', 'pulse', 'spike', 'shift',
  'interact', 'pause', 'lookLeft', 'lookRight', 'lookUp', 'lookDown',
];

/** Actions a player can remap on a gamepad (look is on the right stick, move on the left stick). */
export const GAMEPAD_ACTIONS: readonly ActionName[] = [
  'jump', 'pulse', 'spike', 'shift', 'interact', 'pause', 'forward', 'back', 'left', 'right',
];

export const LOOK_SENSITIVITY_RANGE = { min: 0.2, max: 3 } as const;
export const FOV_RANGE = { min: 60, max: 100 } as const;
const MAX_KEYS_PER_ACTION = 4;
const MAX_GAMEPAD_BUTTON = 16;
const CODE_RE = /^[A-Za-z0-9]{1,32}$/;

export function defaultBindings(): Bindings {
  return {
    keyboard: {
      forward: ['KeyW', 'ArrowUp'],
      back: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      jump: ['Space'],
      pulse: ['KeyJ'],
      spike: ['KeyK'],
      shift: ['KeyF'],
      interact: ['KeyE'],
      pause: ['Escape', 'KeyP'],
      // E is interact, so the right look key is R (Q/R pair). Arrows move by default.
      lookLeft: ['KeyQ', 'Numpad4'],
      lookRight: ['KeyR', 'Numpad6'],
      lookUp: ['PageUp', 'Numpad8'],
      lookDown: ['PageDown', 'Numpad2'],
    },
    // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 9 Start, 12-15 d-pad.
    gamepad: {
      jump: [0],
      pulse: [2],
      spike: [7],
      shift: [4],
      interact: [1, 3],
      pause: [9],
      forward: [12],
      back: [13],
      left: [14],
      right: [15],
    },
  };
}

export function defaultSettings(): UiSettings {
  const reduce = prefersReducedMotion();
  return {
    version: 1,
    camera: { noRoll: false, reducedMotion: reduce, fovDeg: 75, motionBlur: false, reducedFlashes: reduce },
    quality: 'auto',
    renderer: 'auto',
    captions: true,
    textScale: 1,
    audio: { master: 0.8, speech: 1, effects: 0.8, music: 0.6, muted: false },
    assist: { aimAssist: false, halfDamage: false, extendedExposure: false },
    lookSensitivity: 1,
    invertY: false,
    bindings: defaultBindings(),
    showTutorials: true,
    locale: 'en',
  };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ field validators

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function validKeyList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_KEYS_PER_ACTION && v.every((c) => typeof c === 'string' && CODE_RE.test(c));
}

function validButtonList(v: unknown): v is number[] {
  return Array.isArray(v) && v.length <= MAX_KEYS_PER_ACTION
    && v.every((b) => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= MAX_GAMEPAD_BUTTON);
}

function bindingErrors(v: unknown, errors: string[]): void {
  if (!isObj(v)) { errors.push('bindings must be an object'); return; }
  if (!isObj(v.keyboard)) errors.push('bindings.keyboard must be an object');
  else for (const a of ACTIONS) if (!validKeyList(v.keyboard[a])) errors.push(`bindings.keyboard.${a} invalid`);
  if (!isObj(v.gamepad)) errors.push('bindings.gamepad must be an object');
  else {
    for (const [k, list] of Object.entries(v.gamepad)) {
      if (!ACTIONS.includes(k as ActionName)) errors.push(`bindings.gamepad.${k} unknown action`);
      else if (!validButtonList(list)) errors.push(`bindings.gamepad.${k} invalid`);
    }
  }
}

/** Strict validation: every field must be present and valid. Returns the errors found. */
export function settingsErrors(raw: unknown): string[] {
  const e: string[] = [];
  if (!isObj(raw)) return ['settings must be an object'];
  if (raw.version !== 1) e.push('version must be 1');
  const cam = raw.camera;
  if (!isObj(cam)) e.push('camera must be an object');
  else {
    for (const k of ['noRoll', 'reducedMotion', 'motionBlur'] as const) if (!isBool(cam[k])) e.push(`camera.${k} must be boolean`);
    if (cam.reducedFlashes !== undefined && !isBool(cam.reducedFlashes)) e.push('camera.reducedFlashes must be boolean');
    if (!inRange(cam.fovDeg, FOV_RANGE.min, FOV_RANGE.max)) e.push('camera.fovDeg out of range');
  }
  if (!['auto', 'low', 'medium', 'high'].includes(raw.quality as string)) e.push('quality invalid');
  if (!['auto', 'webgpu', 'webgl2'].includes(raw.renderer as string)) e.push('renderer invalid');
  if (!isBool(raw.captions)) e.push('captions must be boolean');
  if (![1, 1.5, 2].includes(raw.textScale as number)) e.push('textScale must be 1, 1.5 or 2');
  const au = raw.audio;
  if (!isObj(au)) e.push('audio must be an object');
  else {
    for (const k of ['master', 'speech', 'effects', 'music'] as const) if (!unit(au[k])) e.push(`audio.${k} must be in [0,1]`);
    if (!isBool(au.muted)) e.push('audio.muted must be boolean');
  }
  const as = raw.assist;
  if (!isObj(as)) e.push('assist must be an object');
  else for (const k of ['aimAssist', 'halfDamage', 'extendedExposure'] as const) if (!isBool(as[k])) e.push(`assist.${k} must be boolean`);
  if (!inRange(raw.lookSensitivity, LOOK_SENSITIVITY_RANGE.min, LOOK_SENSITIVITY_RANGE.max)) e.push('lookSensitivity out of range');
  if (!isBool(raw.invertY)) e.push('invertY must be boolean');
  bindingErrors(raw.bindings, e);
  if (!isBool(raw.showTutorials)) e.push('showTutorials must be boolean');
  if (raw.locale !== 'en') e.push('locale must be en');
  return e;
}

export type SettingsValidation = { ok: true; value: UiSettings } | { ok: false; errors: string[] };

/** Strict: accepts only a complete, valid UiSettings (returned as a deep copy). */
export function validateSettings(raw: unknown): SettingsValidation {
  const errors = settingsErrors(raw);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: mergeSettings(raw) };
}

/**
 * Lenient merge for untrusted or partial input: starts from defaults and takes each field only
 * when it validates on its own. Never throws; garbage in gives defaults out.
 */
export function mergeSettings(partial: unknown, base: UiSettings = defaultSettings()): UiSettings {
  const out: UiSettings = structuredClone(base);
  if (!isObj(partial)) return out;
  const p = partial;
  const cam = p.camera;
  if (isObj(cam)) {
    if (isBool(cam.noRoll)) out.camera.noRoll = cam.noRoll;
    if (isBool(cam.reducedMotion)) out.camera.reducedMotion = cam.reducedMotion;
    if (isBool(cam.motionBlur)) out.camera.motionBlur = cam.motionBlur;
    if (isBool(cam.reducedFlashes)) out.camera.reducedFlashes = cam.reducedFlashes;
    if (inRange(cam.fovDeg, FOV_RANGE.min, FOV_RANGE.max)) out.camera.fovDeg = cam.fovDeg;
  }
  if (['auto', 'low', 'medium', 'high'].includes(p.quality as string)) out.quality = p.quality as UiSettings['quality'];
  if (['auto', 'webgpu', 'webgl2'].includes(p.renderer as string)) out.renderer = p.renderer as UiSettings['renderer'];
  if (isBool(p.captions)) out.captions = p.captions;
  if ([1, 1.5, 2].includes(p.textScale as number)) out.textScale = p.textScale as UiSettings['textScale'];
  const au = p.audio;
  if (isObj(au)) {
    for (const k of ['master', 'speech', 'effects', 'music'] as const) if (unit(au[k])) out.audio[k] = au[k];
    if (isBool(au.muted)) out.audio.muted = au.muted;
  }
  const as = p.assist;
  if (isObj(as)) for (const k of ['aimAssist', 'halfDamage', 'extendedExposure'] as const) if (isBool(as[k])) out.assist[k] = as[k];
  if (inRange(p.lookSensitivity, LOOK_SENSITIVITY_RANGE.min, LOOK_SENSITIVITY_RANGE.max)) out.lookSensitivity = p.lookSensitivity;
  if (isBool(p.invertY)) out.invertY = p.invertY;
  if (isBool(p.showTutorials)) out.showTutorials = p.showTutorials;
  const b = p.bindings;
  if (isObj(b)) {
    if (isObj(b.keyboard)) {
      for (const a of ACTIONS) { const list = b.keyboard[a]; if (validKeyList(list)) out.bindings.keyboard[a] = [...list]; }
    }
    if (isObj(b.gamepad)) {
      for (const a of ACTIONS) { const list = b.gamepad[a]; if (validButtonList(list)) out.bindings.gamepad[a] = [...list]; }
    }
  }
  return out;
}

/**
 * Bind `code` (keyboard) or `button` (gamepad) as the primary input of `action`. The same input is
 * removed from every other action so one press never triggers two actions.
 */
export function rebind(bindings: Bindings, device: 'keyboard', action: ActionName, input: string): Bindings;
export function rebind(bindings: Bindings, device: 'gamepad', action: ActionName, input: number): Bindings;
export function rebind(bindings: Bindings, device: 'keyboard' | 'gamepad', action: ActionName, input: string | number): Bindings {
  const next = structuredClone(bindings);
  if (device === 'keyboard') {
    if (typeof input !== 'string' || !CODE_RE.test(input)) return next;
    for (const a of ACTIONS) next.keyboard[a] = next.keyboard[a].filter((c) => c !== input);
    const rest = next.keyboard[action].filter((c) => c !== input);
    next.keyboard[action] = [input, ...rest].slice(0, MAX_KEYS_PER_ACTION);
  } else {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > MAX_GAMEPAD_BUTTON) return next;
    for (const a of ACTIONS) { const l = next.gamepad[a]; if (l) next.gamepad[a] = l.filter((c) => c !== input); }
    next.gamepad[action] = [input, ...(next.gamepad[action] ?? []).filter((c) => c !== input)].slice(0, MAX_KEYS_PER_ACTION);
  }
  return next;
}
