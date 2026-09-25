/**
 * createUi(): GameUi. Plain DOM + CSS. Modal state is DERIVED from each UiFrame (paused,
 * pressure.panelOpen, tramCrossed) plus local overlays (settings, script, reset confirm, fatal).
 * The UI never decides safety: the control screen mirrors simulation values only.
 */
import type { Axis } from '../contracts/math';
import type { LevelManifest } from '../contracts/manifest';
import type { RenderBackend, RenderReadiness } from '../contracts/render';
import type { GameUi, UiFrame, UiHooks, UiSettings } from '../contracts/ui';
import { CaptionLog } from './captions';
import { buildControlVm } from './control/vm';
import { createControlView, type ControlView } from './control/view';
import { focusables, h, moveFocus, setHidden, trapTab } from './dom';
import { createHud, hudVm, trackPreviews, type HudDom } from './hud';
import { createConfirm, createEnding, createFatal, createPause, createScript, createStart, readinessText,
  type EndingPanel, type ScriptPanel, type StartScreen } from './menus';
import { navEdges, pollPad, type PadState } from './nav';
import { mergeSettings } from './settings';
import { createSettingsPanel, type SettingsPanel } from './settings-panel';
import { EN } from './strings';

export interface UiOptions {
  /** Level manifest: enables interact prompts, "anchor nearby" prompts and crescent glyph names. */
  manifest?: LevelManifest;
  /** Clock for caption expiry (tests); defaults to performance.now. */
  now?: () => number;
}

type Overlay = 'settings' | 'script' | 'confirm';
type ModalName = 'fatal' | Overlay | 'control' | 'ending' | 'pause' | 'start' | null;

export function createUi(options: UiOptions = {}): GameUi {
  const now = options.now ?? (() => performance.now());
  let root: HTMLElement | null = null;
  let app: HTMLElement | null = null;
  let hooks: UiHooks | null = null;
  let settings: UiSettings = mergeSettings(null);
  let started = false;
  let hasSave = false;
  let frame: UiFrame | null = null;
  const overlays: Overlay[] = [];
  let fatal: HTMLElement | null = null;
  let top: ModalName = null;
  let padPrev: PadState | null = null;
  let lastRejection: { reason: string; destination: string | null } | null = null;
  const previewTo = new Map<string, Axis>();
  const captions = new CaptionLog();
  let readiness: RenderReadiness = 'initializing';
  let backend: RenderBackend = 'none';
  const offs: (() => void)[] = [];

  let hud!: HudDom;
  let start!: StartScreen;
  let pause!: HTMLElement;
  let confirm!: HTMLElement;
  let script!: ScriptPanel;
  let ending!: EndingPanel;
  let settingsPanel!: SettingsPanel;
  let control!: ControlView;
  let loader!: HTMLElement;

  const emitSettings = (next: unknown) => {
    settings = mergeSettings(next, settings);
    applySettings();
    hooks?.onSettings(settings);
  };

  function applySettings(): void {
    if (!app) return;
    app.style.setProperty('--fl-text-scale', String(settings.textScale));
    app.classList.toggle('fl-reduced-motion', settings.camera.reducedMotion);
    app.classList.toggle('fl-no-captions', !settings.captions);
    start?.setSettings(settings);
    ending?.setSettings(settings);
  }

  const openOverlay = (o: Overlay) => {
    if (o === 'settings') settingsPanel.open(settings);
    if (o === 'script') script.render(captions.script());
    if (!overlays.includes(o)) overlays.push(o);
    refresh();
  };
  const closeOverlay = () => { overlays.pop(); refresh(); };

  function modalName(): ModalName {
    if (fatal) return 'fatal';
    const o = overlays[overlays.length - 1];
    if (o) return o;
    if (!started) return 'start';
    if (frame?.state.tramCrossed) return 'ending';
    // After a safe transfer the panel steps aside so the release and tram crossing are visible (display only).
    if (frame?.state.pressure.panelOpen && !frame.state.flags.gateOpen) return 'control';
    if (frame?.paused) return 'pause';
    return null;
  }

  function modalEl(n: ModalName): HTMLElement | null {
    switch (n) {
      case 'fatal': return fatal;
      case 'settings': return settingsPanel.root;
      case 'script': return script.root;
      case 'confirm': return confirm;
      case 'control': return control.root;
      case 'ending': return ending.root;
      case 'pause': return pause;
      case 'start': return start.root;
      default: return null;
    }
  }

  /** Show exactly the top modal, move focus into it when it changes, release focus when none. */
  function refresh(): void {
    if (!app) return;
    const n = modalName();
    for (const el of [start.root, pause, confirm, script.root, ending.root, settingsPanel.root, control.root]) setHidden(el, el !== modalEl(n));
    setHidden(hud.root, !started);
    app.classList.toggle('is-capturing', n !== null);
    app.classList.toggle('is-ending', n === 'ending');
    const showLoader = started && readiness === 'initializing' && !fatal;
    setHidden(loader, !showLoader);
    if (n === top) return;
    if (top === 'control') control.reset();
    top = n;
    const el = modalEl(n);
    if (el) {
      if (n === 'control') control.focusFirst();
      else (el.querySelector<HTMLElement>('[data-fk="play"], [data-fk="resume"], [data-fk="no"], [data-fk="replay"], [data-fk="fatal-0"]') ?? focusables(el)[0])?.focus();
    } else {
      const active = document.activeElement as HTMLElement | null;
      if (active && app.contains(active)) active.blur();
    }
  }

  function back(): void {
    switch (top) {
      case 'settings': if (settingsPanel.isListening()) settingsPanel.cancelListen(); else closeOverlay(); break;
      case 'script': case 'confirm': closeOverlay(); break;
      case 'control': control.back(); break;
      case 'pause': hooks?.onPause(false); break;
      default: break;
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!app || top === null) return;
    if (settingsPanel.isListening()) return; // the rebind capture owns this key
    const el = modalEl(top);
    if (el && trapTab(el, e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      back();
    }
  }

  function gamepadNav(): void {
    const pad = pollPad();
    const edges = navEdges(padPrev, pad);
    padPrev = pad;
    if (top === null || edges.length === 0) return;
    const el = modalEl(top);
    if (!el) return;
    const active = document.activeElement as HTMLElement | null;
    const inModal = !!active && el.contains(active);
    for (const edge of edges) {
      if (edge === 'up') moveFocus(el, -1);
      else if (edge === 'down') moveFocus(el, 1);
      else if ((edge === 'left' || edge === 'right') && inModal && active instanceof HTMLInputElement && active.type === 'range') {
        const step = Number(active.step) || 1;
        active.value = String(Number(active.value) + (edge === 'left' ? -step : step));
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
      } else if ((edge === 'left' || edge === 'right') && inModal && active instanceof HTMLSelectElement) {
        const i = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (edge === 'left' ? -1 : 1)));
        if (i !== active.selectedIndex) { active.selectedIndex = i; active.dispatchEvent(new Event('change', { bubbles: true })); }
      } else if (edge === 'left') moveFocus(el, -1);
      else if (edge === 'right') moveFocus(el, 1);
      else if (edge === 'activate') { if (inModal) active!.click(); else moveFocus(el, 1); }
      else if (edge === 'back') back();
      else if (edge === 'start') { if (top === 'pause') hooks?.onPause(false); else if (top === 'start') hooks && startGame('new'); else back(); }
    }
  }

  function startGame(mode: 'new' | 'continue'): void {
    started = true;
    if (mode === 'new') captions.clear(); else captions.reset();
    lastRejection = null;
    hooks?.onStart(mode);
    refresh();
  }

  function trackRejections(f: UiFrame): void {
    for (const e of f.events) {
      if (e.type === 'TransferRejected') {
        lastRejection = { reason: String(e.payload.reason ?? e.payload.reasonKey ?? 'Rejected'), destination: typeof e.payload.destination === 'string' ? e.payload.destination : null };
      } else if (e.type === 'PanelOpened' || e.type === 'PanelClosed' || e.type === 'SensorVerified' || e.type === 'EdgeRestored'
        || e.type === 'TransferAuthorized' || (e.type === 'PreviewShown' && e.payload.safe === true)) {
        lastRejection = null;
      }
    }
  }

  return {
    mount(r, hk, s, opts) {
      root = r;
      hooks = hk;
      settings = mergeSettings(s);
      hasSave = opts.hasSave;
      hud = createHud(() => hooks?.onPause(true), () => openOverlay('script'));
      start = createStart({
        play: () => startGame('new'),
        continue: () => startGame('continue'),
        settings: () => openOverlay('settings'),
        quality: (q) => emitSettings({ ...settings, quality: q }),
        captions: (on) => emitSettings({ ...settings, captions: on }),
      });
      start.setHasSave(hasSave);
      pause = createPause({
        resume: () => hooks?.onPause(false),
        restart: () => hooks?.onRestartCheckpoint(),
        settings: () => openOverlay('settings'),
        script: () => openOverlay('script'),
        reset: () => openOverlay('confirm'),
      });
      confirm = createConfirm({ yes: () => { hooks?.onResetSave(); hasSave = false; start.setHasSave(false); closeOverlay(); }, no: closeOverlay });
      script = createScript(closeOverlay);
      ending = createEnding({
        replay: () => startGame('new'),
        quality: (q) => emitSettings({ ...settings, quality: q }),
        captions: (on) => emitSettings({ ...settings, captions: on }),
        script: () => openOverlay('script'),
      });
      settingsPanel = createSettingsPanel((next) => emitSettings(next), closeOverlay);
      control = createControlView((a) => hooks?.onControl(a));
      loader = h('div', { class: 'fl-loader', role: 'status', 'aria-live': 'polite', hidden: true },
        h('strong', {}, EN.readiness.initializing), h('span', {}, 'Movement and controls become available as soon as they are ready.'));
      app = h('div', { class: 'fl-app' }, hud.root, loader, start.root, pause, control.root, ending.root, script.root, confirm, settingsPanel.root);
      r.append(app);
      const kd = (e: KeyboardEvent) => onKeyDown(e);
      window.addEventListener('keydown', kd, true);
      offs.push(() => window.removeEventListener('keydown', kd, true));
      applySettings();
      start.setReadiness(readinessText(readiness, backend), false);
      refresh();
    },
    update(f) {
      if (!app) return;
      frame = f;
      const t = now();
      captions.push(f.captions, t);
      trackPreviews(f.events, previewTo);
      trackRejections(f);
      if (started) {
        hud.render(hudVm(f.state, f.objective?.text ?? null, {
          manifest: options.manifest ?? null, device: f.device, bindings: settings.bindings,
          showTutorials: settings.showTutorials, previewTo,
        }));
        hud.renderCaptions(captions.current(t), settings.captions);
        hud.renderDisplay(captions.currentDisplay(t));
      }
      if (f.state.pressure.panelOpen) {
        control.render(buildControlVm({ graph: f.graph, previewed: f.state.pressure.previewed, lastRejection }));
      }
      if (f.state.tramCrossed) ending.setDisplay(captions.lastDisplay()?.text ?? null);
      if (top === 'script') script.render(captions.script());
      refresh();
      if (settingsPanel.poll()) padPrev = pollPad(); // the bind press must not also activate a button
      else gamepadNav();
    },
    setReadiness(r, b) {
      readiness = r;
      backend = b;
      if (!app) return;
      start.setReadiness(readinessText(r, b), r !== 'initializing');
      refresh();
    },
    showFatal(title, detail, actions) {
      if (!app) return;
      fatal?.remove();
      const list = actions && actions.length ? actions : [
        { label: EN.retry, run: () => location.reload() },
        { label: EN.useWebgl2, run: () => { emitSettings({ ...settings, renderer: 'webgl2' }); location.reload(); } },
      ];
      fatal = createFatal(title || EN.fatalTitle, detail, list);
      app.append(fatal);
      top = null;
      refresh();
    },
    clearFatal() {
      if (!fatal) return;
      fatal.remove();
      fatal = null;
      refresh();
    },
    capturing: () => modalName() !== null,
    markStarted: (mode: 'new' | 'continue') => {
      if (started) return;
      started = true;
      if (mode === 'new') captions.clear(); else captions.reset();
      lastRejection = null;
      refresh();
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      app?.remove();
      app = null;
      root = null;
      hooks = null;
    },
  };
}
