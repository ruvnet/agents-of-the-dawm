/**
 * Public surface of the UI and controls module (W4.UI.01).
 *
 *   const input = createInput();                 // InputSource
 *   input.attach(canvas);
 *   const ui = createUi({ manifest });           // GameUi (manifest optional, enables prompts)
 *   ui.mount(uiRoot, hooks, mergeSettings(stored), { hasSave });
 *   // per tick:  input.sample({ tick, state, manifest, uiCapturing: ui.capturing(), settings })
 *   // per frame: ui.update(frame)
 *   // hooks.onControl = (a) => input.queueControl(a)
 */
export { createInput, type InputOptions } from './input/index';
export { normalize, normalizeDetailed, applyDeadzone, stickVector, EMPTY_RAW } from './input/core';
export type { RawDeviceState, GamepadSnapshot, NormalizeSettings, NormalizeFrame } from './input/core';
export { createAccumulator, type InputAccumulator } from './input/accumulator';
export { createUi, type UiOptions } from './ui';
export { defaultSettings, defaultBindings, mergeSettings, validateSettings, settingsErrors, rebind } from './settings';
export { buildControlVm, type ControlVm, type RouteRowVm } from './control/vm';
