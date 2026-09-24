/**
 * Settings panel: remapping (keyboard + gamepad), look, camera, graphics, audio, captions/text,
 * assists and tutorials. Every change is merged through mergeSettings and emitted immediately.
 */
import type { ActionName, UiSettings } from '../contracts/ui';
import { ACTIONS, defaultBindings, FOV_RANGE, GAMEPAD_ACTIONS, LOOK_SENSITIVITY_RANGE, mergeSettings, rebind } from './settings';
import { ACTION_LABELS, EN, keyLabel, padLabel } from './strings';
import { h } from './dom';

export interface SettingsPanel {
  readonly root: HTMLElement;
  open(settings: UiSettings): void;
  /** True while waiting for a key or button to bind (Escape cancels the capture, not the panel). */
  isListening(): boolean;
  cancelListen(): void;
  /** Poll gamepads while listening for a gamepad rebind (call every frame). */
  poll(): void;
}

type Listen = { device: 'keyboard' | 'gamepad'; action: ActionName; prev: number[] } | null;

export function createSettingsPanel(onChange: (s: UiSettings) => void, onBack: () => void): SettingsPanel {
  let s: UiSettings | null = null;
  let listen: Listen = null;
  const root = h('section', { class: 'fl-modal fl-settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fl-settings-title', 'data-fl-modal': 'settings' });
  const status = h('p', { class: 'fl-note', role: 'status', 'aria-live': 'polite' });

  const commit = (next: unknown) => {
    s = mergeSettings(next, s ?? undefined);
    onChange(s);
    build();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!listen || listen.device !== 'keyboard' || !s) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const l = listen;
    listen = null;
    window.removeEventListener('keydown', onKey, true);
    if (e.code === 'Escape' && l.action !== 'pause') { status.textContent = 'Rebind cancelled.'; build(); return; }
    commit({ ...s, bindings: rebind(s.bindings, 'keyboard', l.action, e.code) });
    status.textContent = `${ACTION_LABELS[l.action]} bound to ${keyLabel(e.code)}.`;
  };

  function startListen(device: 'keyboard' | 'gamepad', action: ActionName): void {
    listen = { device, action, prev: currentPadButtons() };
    status.textContent = device === 'keyboard'
      ? `Press a key for ${ACTION_LABELS[action]} (Esc cancels).`
      : `Press a gamepad button for ${ACTION_LABELS[action]}.`;
    if (device === 'keyboard') window.addEventListener('keydown', onKey, true);
    build();
  }

  function currentPadButtons(): number[] {
    try {
      const p = [...navigator.getGamepads()].find((g) => g && g.connected);
      return p ? p.buttons.map((b) => b.value) : [];
    } catch { return []; }
  }

  const check = (label: string, value: boolean, set: (v: boolean) => unknown) =>
    h('label', { class: 'fl-field fl-check-field' },
      h('input', { type: 'checkbox', 'data-fk': label, checked: value, onchange: (e: Event) => commit(set((e.target as HTMLInputElement).checked)) }), h('span', {}, label));
  const range = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, set: (v: number) => unknown) => {
    const out = h('output', {}, fmt(value));
    const input = h('input', { type: 'range', 'data-fk': label, min, max, step, value, 'aria-valuetext': fmt(value),
      oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = fmt(v); },
      onchange: (e: Event) => commit(set(Number((e.target as HTMLInputElement).value))) });
    return h('label', { class: 'fl-field fl-range' }, h('span', {}, label), input, out);
  };
  const select = <T extends string | number>(label: string, value: T, options: readonly [T, string][], set: (v: T) => unknown) =>
    h('label', { class: 'fl-field' }, h('span', {}, label),
      h('select', { 'data-fk': label, onchange: (e: Event) => { const raw = (e.target as HTMLSelectElement).value; const opt = options.find(([v]) => String(v) === raw); if (opt) commit(set(opt[0])); } },
        ...options.map(([v, text]) => h('option', { value: String(v), selected: v === value }, text))));
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  function build(): void {
    if (!s) return;
    const cur = s;
    const kb = ACTIONS.map((a) => h('tr', {},
      h('th', { scope: 'row' }, ACTION_LABELS[a]),
      h('td', {}, cur.bindings.keyboard[a].map(keyLabel).join(', ') || '—'),
      h('td', {}, h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'aria-label': `Change key for ${ACTION_LABELS[a]}`, 'data-fk': `kb:${a}`,
        onclick: () => startListen('keyboard', a) }, listen?.device === 'keyboard' && listen.action === a ? 'Press a key…' : 'Change'))));
    const gp = GAMEPAD_ACTIONS.map((a) => h('tr', {},
      h('th', { scope: 'row' }, ACTION_LABELS[a]),
      h('td', {}, (cur.bindings.gamepad[a] ?? []).map(padLabel).join(', ') || '—'),
      h('td', {}, h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'aria-label': `Change gamepad button for ${ACTION_LABELS[a]}`, 'data-fk': `gp:${a}`,
        onclick: () => startListen('gamepad', a) }, listen?.device === 'gamepad' && listen.action === a ? 'Press a button…' : 'Change'))));
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.fk ?? null;
    const scroll = root.querySelector('.fl-settings-body')?.scrollTop ?? 0;
    root.replaceChildren(
      h('header', { class: 'fl-modal-head' }, h('h2', { id: 'fl-settings-title' }, EN.settings),
        h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'data-back': '1', onclick: onBack }, `${EN.back}`)),
      h('div', { class: 'fl-settings-body' },
        status,
        h('fieldset', {}, h('legend', {}, 'Captions and text'),
          check('Captions', cur.captions, (v) => ({ ...cur, captions: v })),
          select('Text size', cur.textScale, [[1, '100%'], [1.5, '150%'], [2, '200%']], (v) => ({ ...cur, textScale: v })),
          check('Show tutorial prompts', cur.showTutorials, (v) => ({ ...cur, showTutorials: v }))),
        h('fieldset', {}, h('legend', {}, 'Look and camera'),
          range('Look sensitivity', cur.lookSensitivity, LOOK_SENSITIVITY_RANGE.min, LOOK_SENSITIVITY_RANGE.max, 0.1, (v) => `${v.toFixed(1)}×`, (v) => ({ ...cur, lookSensitivity: v })),
          check('Invert Y', cur.invertY, (v) => ({ ...cur, invertY: v })),
          check('Level horizon (no camera roll)', cur.camera.noRoll, (v) => ({ ...cur, camera: { ...cur.camera, noRoll: v } })),
          check('Reduced camera motion', cur.camera.reducedMotion, (v) => ({ ...cur, camera: { ...cur.camera, reducedMotion: v } })),
          check('Reduced flashes', cur.camera.reducedFlashes ?? cur.camera.reducedMotion, (v) => ({ ...cur, camera: { ...cur.camera, reducedFlashes: v } })),
          check('Motion blur', cur.camera.motionBlur, (v) => ({ ...cur, camera: { ...cur.camera, motionBlur: v } })),
          range('Field of view', cur.camera.fovDeg, FOV_RANGE.min, FOV_RANGE.max, 1, (v) => `${v}°`, (v) => ({ ...cur, camera: { ...cur.camera, fovDeg: v } }))),
        h('fieldset', {}, h('legend', {}, 'Graphics'),
          select(EN.quality, cur.quality, [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], (v) => ({ ...cur, quality: v })),
          select('Renderer (applies on reload)', cur.renderer, [['auto', 'Auto'], ['webgpu', 'WebGPU'], ['webgl2', 'WebGL2']], (v) => ({ ...cur, renderer: v }))),
        h('fieldset', {}, h('legend', {}, 'Audio'),
          range('Master volume', cur.audio.master, 0, 1, 0.05, pct, (v) => ({ ...cur, audio: { ...cur.audio, master: v } })),
          range('Speech volume', cur.audio.speech, 0, 1, 0.05, pct, (v) => ({ ...cur, audio: { ...cur.audio, speech: v } })),
          range('Effects volume', cur.audio.effects, 0, 1, 0.05, pct, (v) => ({ ...cur, audio: { ...cur.audio, effects: v } })),
          range('Music volume', cur.audio.music, 0, 1, 0.05, pct, (v) => ({ ...cur, audio: { ...cur.audio, music: v } })),
          check('Mute all', cur.audio.muted, (v) => ({ ...cur, audio: { ...cur.audio, muted: v } }))),
        h('fieldset', {}, h('legend', {}, 'Assists (the story and safety checks never change)'),
          check('Aim assist', cur.assist.aimAssist, (v) => ({ ...cur, assist: { ...cur.assist, aimAssist: v } })),
          check('Half incoming damage', cur.assist.halfDamage, (v) => ({ ...cur, assist: { ...cur.assist, halfDamage: v } })),
          check('Extended keeper exposure', cur.assist.extendedExposure, (v) => ({ ...cur, assist: { ...cur.assist, extendedExposure: v } }))),
        h('fieldset', {}, h('legend', {}, 'Keyboard controls'),
          h('p', { class: 'fl-note' }, 'Mouse: look (click the game to capture the pointer), left button Pulse, right button Spike.'),
          h('table', { class: 'fl-bindings' }, h('tbody', {}, ...kb))),
        h('fieldset', {}, h('legend', {}, 'Gamepad controls'),
          h('p', { class: 'fl-note' }, 'Left stick moves, right stick looks.'),
          h('table', { class: 'fl-bindings' }, h('tbody', {}, ...gp))),
        h('button', { type: 'button', class: 'fl-btn', onclick: () => commit({ ...cur, bindings: defaultBindings() }) }, 'Reset controls to default')),
    );
    const body = root.querySelector('.fl-settings-body');
    if (body) body.scrollTop = scroll;
    if (focusedKey) root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focusedKey)}"]`)?.focus();
  }

  return {
    root,
    open(settings) {
      s = mergeSettings(settings);
      listen = null;
      status.textContent = '';
      build();
    },
    isListening: () => listen !== null,
    cancelListen() {
      if (!listen) return;
      if (listen.device === 'keyboard') window.removeEventListener('keydown', onKey, true);
      listen = null;
      build();
    },
    poll() {
      if (!listen || listen.device !== 'gamepad' || !s) return;
      const now = currentPadButtons();
      const idx = now.findIndex((v, i) => v > 0.5 && !((listen!.prev[i] ?? 0) > 0.5));
      listen.prev = now;
      if (idx < 0) return;
      const action = listen.action;
      listen = null;
      commit({ ...s, bindings: rebind(s.bindings, 'gamepad', action, idx) });
      status.textContent = `${ACTION_LABELS[action]} bound to ${padLabel(idx)}.`;
    },
  };
}
