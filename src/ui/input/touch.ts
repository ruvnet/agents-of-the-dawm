/**
 * Touch layer: a large fixed virtual stick, a look-drag area and large context buttons. Each action
 * is one press or hold; nothing needs a rapid sequence. Thin DOM: it only forwards to the accumulator.
 */
import type { ActionName } from '../../contracts/ui';
import type { InputAccumulator } from './accumulator';
import { stickVector } from './core';

export interface TouchContext {
  readonly capturing: boolean;
  readonly canShift: boolean;
  readonly canInteract: boolean;
}

export interface TouchLayer {
  readonly root: HTMLElement;
  setContext(c: TouchContext): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

const BUTTONS: readonly { action: ActionName; label: string; glyph: string; context?: 'shift' | 'interact' }[] = [
  { action: 'jump', label: 'Jump', glyph: '⤒' },
  { action: 'pulse', label: 'Pulse', glyph: '◎' },
  { action: 'spike', label: 'Spike', glyph: '➚' },
  { action: 'shift', label: 'Shift', glyph: '◡', context: 'shift' },
  { action: 'interact', label: 'Use', glyph: '✋', context: 'interact' },
];

export function createTouchLayer(host: HTMLElement, acc: InputAccumulator): TouchLayer {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'fl-touch';
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;

  const look = doc.createElement('div');
  look.className = 'fl-touch-look';
  const stick = doc.createElement('div');
  stick.className = 'fl-touch-stick';
  const knob = doc.createElement('div');
  knob.className = 'fl-touch-knob';
  stick.append(knob);
  const pad = doc.createElement('div');
  pad.className = 'fl-touch-buttons';
  const pause = doc.createElement('button');
  pause.type = 'button';
  pause.className = 'fl-touch-btn fl-touch-pause';
  pause.dataset.action = 'pause';
  pause.innerHTML = '<span class="fl-touch-glyph">❚❚</span><span class="fl-touch-label">Pause</span>';

  const buttons = new Map<ActionName, HTMLButtonElement>();
  for (const b of BUTTONS) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = `fl-touch-btn fl-touch-${b.action}`;
    el.dataset.action = b.action;
    if (b.context) el.dataset.context = b.context;
    el.innerHTML = `<span class="fl-touch-glyph">${b.glyph}</span><span class="fl-touch-label">${b.label}</span>`;
    pad.append(el);
    buttons.set(b.action, el);
  }
  buttons.set('pause', pause);
  root.append(look, stick, pad, pause);
  host.append(root);

  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
    el.addEventListener(type, fn as EventListener, { passive: false });
    offs.push(() => el.removeEventListener(type, fn as EventListener));
  };

  // Buttons: press on pointerdown, release on up/cancel/leave. Pointer capture keeps a hold stable.
  for (const [action, el] of buttons) {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
      el.classList.add('is-down');
      acc.touchButton(action, true);
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      el.classList.remove('is-down');
      acc.touchButton(action, false);
    };
    on(el, 'pointerdown', down);
    on(el, 'pointerup', up);
    on(el, 'pointercancel', up);
    on(el, 'lostpointercapture', up);
  }

  // Fixed stick centred on its zone.
  let stickId: number | null = null;
  const stickMove = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = e.clientX - (r.left + radius);
    const dy = e.clientY - (r.top + r.height / 2);
    const v = stickVector(dx, dy, radius);
    acc.touchStick(v);
    const k = Math.min(1, Math.hypot(dx, dy) / radius);
    const a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * k * radius * 0.6}px, ${Math.sin(a) * k * radius * 0.6}px)`;
  };
  on(stick, 'pointerdown', (e) => {
    e.preventDefault();
    stickId = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    stickMove(e);
  });
  on(stick, 'pointermove', (e) => { if (e.pointerId === stickId) { e.preventDefault(); stickMove(e); } });
  const stickEnd = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    acc.touchStick([0, 0]);
    knob.style.transform = '';
  };
  on(stick, 'pointerup', stickEnd);
  on(stick, 'pointercancel', stickEnd);

  // Look drag anywhere in the look area.
  let lookId: number | null = null;
  let lx = 0;
  let ly = 0;
  on(look, 'pointerdown', (e) => {
    e.preventDefault();
    lookId = e.pointerId;
    lx = e.clientX;
    ly = e.clientY;
    try { look.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  on(look, 'pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    e.preventDefault();
    acc.touchLook(e.clientX - lx, e.clientY - ly);
    lx = e.clientX;
    ly = e.clientY;
  });
  const lookEnd = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };
  on(look, 'pointerup', lookEnd);
  on(look, 'pointercancel', lookEnd);

  return {
    root,
    setContext(c) {
      root.classList.toggle('is-capturing', c.capturing);
      buttons.get('shift')!.classList.toggle('is-available', c.canShift);
      buttons.get('interact')!.classList.toggle('is-available', c.canInteract);
    },
    setVisible(v) { root.hidden = !v; },
    dispose() {
      for (const off of offs) off();
      root.remove();
    },
  };
}
