/**
 * Start, pause, reset-confirm, script, ending and fatal panels. Plain DOM, built once; ui.ts shows
 * one at a time and owns focus.
 */
import type { RenderBackend, RenderReadiness } from '../contracts/render';
import type { UiSettings } from '../contracts/ui';
import type { ScriptEntry } from './captions';
import { EN } from './strings';
import { h, setText } from './dom';

export const LOGO_SVG = '<svg class="fl-logo" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 40a24 24 0 0 0 48 0" class="fl-logo-c"/><path d="M14 40a18 18 0 0 1 36 0" class="fl-logo-w"/><path d="M4 50q7-5 14 0t14 0t14 0t14 0" class="fl-logo-sea"/></svg>';

const modal = (name: string, labelId: string, cls: string) =>
  h('section', { class: `fl-modal ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId, 'data-fl-modal': name, hidden: true });

export function readinessText(r: RenderReadiness, backend: RenderBackend): string {
  return `${EN.readiness[r]} · ${EN.backend[backend]}`;
}

export interface StartScreen {
  readonly root: HTMLElement;
  setReadiness(text: string, controllable: boolean): void;
  setSettings(s: UiSettings): void;
  setHasSave(v: boolean): void;
}

export function createStart(hooks: {
  play: () => void; continue: () => void; settings: () => void;
  quality: (q: UiSettings['quality']) => void; captions: (on: boolean) => void;
}): StartScreen {
  const root = modal('start', 'fl-start-title', 'fl-start');
  const ready = h('p', { class: 'fl-ready', role: 'status', 'aria-live': 'polite' }, EN.readiness.initializing);
  const cont = h('button', { type: 'button', class: 'fl-btn', 'data-fk': 'continue', onclick: hooks.continue }, EN.continue);
  const quality = h('select', { 'data-fk': 'quality', onchange: (e: Event) => hooks.quality((e.target as HTMLSelectElement).value as UiSettings['quality']) },
    ...([['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const).map(([v, t]) => h('option', { value: v }, t)));
  const captions = h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'aria-pressed': 'true', 'data-fk': 'captions',
    onclick: () => hooks.captions(captions.getAttribute('aria-pressed') !== 'true') }, `${EN.captions}: ${EN.on}`);
  const logo = h('div', { class: 'fl-start-mark' });
  logo.innerHTML = LOGO_SVG;
  root.append(
    logo,
    h('h1', { id: 'fl-start-title' }, h('span', { class: 'fl-title-a' }, EN.title), h('span', { class: 'fl-title-b' }, EN.subtitle)),
    h('p', { class: 'fl-tagline' }, EN.tagline),
    h('div', { class: 'fl-row fl-start-actions' },
      h('button', { type: 'button', class: 'fl-btn fl-btn-primary fl-btn-play', 'data-fk': 'play', onclick: hooks.play }, `▶ ${EN.play}`), cont),
    h('div', { class: 'fl-row fl-start-options' },
      h('label', { class: 'fl-field fl-inline' }, h('span', {}, EN.quality), quality),
      captions,
      h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'data-fk': 'settings', onclick: hooks.settings }, `⚙ ${EN.settings}`)),
    ready,
  );
  return {
    root,
    setReadiness(text, controllable) {
      setText(ready, text);
      ready.classList.toggle('is-ready', controllable);
    },
    setSettings(s) {
      quality.value = s.quality;
      captions.setAttribute('aria-pressed', String(s.captions));
      setText(captions, `${EN.captions}: ${s.captions ? EN.on : EN.off}`);
    },
    setHasSave(v) { cont.hidden = !v; },
  };
}

export function createPause(hooks: { resume: () => void; restart: () => void; settings: () => void; script: () => void; reset: () => void }): HTMLElement {
  const root = modal('pause', 'fl-pause-title', 'fl-pause fl-menu');
  root.append(
    h('h2', { id: 'fl-pause-title' }, EN.paused),
    h('div', { class: 'fl-stack' },
      h('button', { type: 'button', class: 'fl-btn fl-btn-primary', 'data-fk': 'resume', onclick: hooks.resume }, EN.resume),
      h('button', { type: 'button', class: 'fl-btn', 'data-fk': 'restart', onclick: hooks.restart }, EN.restartCheckpoint),
      h('button', { type: 'button', class: 'fl-btn', 'data-fk': 'settings', onclick: hooks.settings }, EN.settings),
      h('button', { type: 'button', class: 'fl-btn', 'data-fk': 'script', onclick: hooks.script }, EN.script),
      h('button', { type: 'button', class: 'fl-btn fl-btn-danger', 'data-fk': 'reset', onclick: hooks.reset }, EN.resetSave)),
  );
  return root;
}

export function createConfirm(hooks: { yes: () => void; no: () => void }): HTMLElement {
  const root = modal('confirm', 'fl-confirm-title', 'fl-confirm-reset fl-menu');
  root.setAttribute('role', 'alertdialog');
  root.append(
    h('h2', { id: 'fl-confirm-title' }, EN.resetConfirmTitle),
    h('p', {}, EN.resetConfirmBody),
    h('div', { class: 'fl-row' },
      h('button', { type: 'button', class: 'fl-btn', 'data-fk': 'no', onclick: hooks.no }, EN.cancel),
      h('button', { type: 'button', class: 'fl-btn fl-btn-danger', 'data-fk': 'yes', onclick: hooks.yes }, EN.resetConfirmYes)),
  );
  return root;
}

export interface ScriptPanel { readonly root: HTMLElement; render(entries: readonly ScriptEntry[]): void }

export function createScript(onClose: () => void): ScriptPanel {
  const root = modal('script', 'fl-script-title', 'fl-script');
  const list = h('ol', { class: 'fl-script-list', tabindex: 0, 'aria-label': EN.scriptTitle });
  root.append(
    h('header', { class: 'fl-modal-head' }, h('h2', { id: 'fl-script-title' }, EN.scriptTitle),
      h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'data-fk': 'close', onclick: onClose }, EN.close)),
    list,
  );
  let count = -1;
  return {
    root,
    render(entries) {
      if (entries.length === count) return;
      count = entries.length;
      list.replaceChildren(...(entries.length ? entries.map((e) => h('li', { class: `fl-script-line${e.display ? ' is-display' : ''}${e.speaker === null ? ' is-cue' : ''}` },
        e.speaker ? h('span', { class: 'fl-speaker' }, e.display ? 'DAWM display: ' : `${e.speaker}: `) : null,
        h('span', {}, e.text))) : [h('li', { class: 'fl-note' }, EN.scriptEmpty)]));
      list.scrollTop = list.scrollHeight;
    },
  };
}

export interface EndingPanel { readonly root: HTMLElement; setDisplay(text: string | null): void; setSettings(s: UiSettings): void }

export function createEnding(hooks: {
  replay: () => void; quality: (q: UiSettings['quality']) => void; captions: (on: boolean) => void; script: () => void;
}): EndingPanel {
  const root = modal('ending', 'fl-ending-title', 'fl-ending');
  const display = h('div', { class: 'fl-dawm-display is-static', role: 'status' });
  const credits = h('div', { class: 'fl-credits', id: 'fl-credits', hidden: true }, ...EN.creditsBody.map((t) => h('p', {}, t)));
  const quality = h('select', { 'data-fk': 'quality', onchange: (e: Event) => hooks.quality((e.target as HTMLSelectElement).value as UiSettings['quality']) },
    ...([['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const).map(([v, t]) => h('option', { value: v }, t)));
  const captions = h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'aria-pressed': 'true', 'data-fk': 'captions',
    onclick: () => hooks.captions(captions.getAttribute('aria-pressed') !== 'true') }, `${EN.captions}: ${EN.on}`);
  const creditsBtn = h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'aria-expanded': 'false', 'aria-controls': 'fl-credits', 'data-fk': 'credits',
    onclick: () => { credits.hidden = !credits.hidden; creditsBtn.setAttribute('aria-expanded', String(!credits.hidden)); } }, EN.credits);
  root.append(
    h('h2', { id: 'fl-ending-title' }, EN.endingTitle),
    display,
    h('p', {}, EN.endingBody),
    h('div', { class: 'fl-row' },
      h('button', { type: 'button', class: 'fl-btn fl-btn-primary', 'data-fk': 'replay', onclick: hooks.replay }, `↻ ${EN.replay}`),
      h('label', { class: 'fl-field fl-inline' }, h('span', {}, EN.quality), quality),
      captions, creditsBtn,
      h('button', { type: 'button', class: 'fl-btn fl-btn-small', 'data-fk': 'script', onclick: hooks.script }, EN.script)),
    credits,
  );
  return {
    root,
    setDisplay(text) {
      display.hidden = !text;
      display.replaceChildren(...(text ? [h('span', { class: 'fl-dawm-tag' }, 'DAWM'), ...text.split(' / ').map((l) => h('span', { class: 'fl-dawm-line' }, l))] : []));
    },
    setSettings(s) {
      quality.value = s.quality;
      captions.setAttribute('aria-pressed', String(s.captions));
      setText(captions, `${EN.captions}: ${s.captions ? EN.on : EN.off}`);
    },
  };
}

export function createFatal(title: string, detail: string, actions: readonly { label: string; run: () => void }[]): HTMLElement {
  const root = modal('fatal', 'fl-fatal-title', 'fl-fatal fl-menu');
  root.setAttribute('role', 'alertdialog');
  root.hidden = false;
  root.append(
    h('h2', { id: 'fl-fatal-title' }, `⚠ ${title}`),
    h('p', { class: 'fl-fatal-detail' }, detail),
    h('div', { class: 'fl-row' }, ...actions.map((a, i) => h('button', { type: 'button', class: `fl-btn${i === 0 ? ' fl-btn-primary' : ''}`, 'data-fk': `fatal-${i}`, onclick: a.run }, a.label))),
  );
  return root;
}
