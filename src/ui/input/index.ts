/**
 * createInput(): the browser InputSource. Thin DOM glue over the pure core (./core.ts) and the
 * DOM-free accumulator (./accumulator.ts): keyboard + pointer-lock mouse, standard gamepad (polled
 * once per sample) and a touch layer.
 */
import type { InputDevice, InputSampleContext, InputSource } from '../../contracts/ui';
import type { GamepadSnapshot } from './core';
import { createAccumulator, nearInteractable } from './accumulator';
import { createTouchLayer, type TouchLayer } from './touch';

export interface InputOptions {
  /** 'auto' shows the touch layer on coarse pointers or after the first touch. */
  touch?: 'auto' | 'always' | 'never';
}

const EDITABLE = 'button, input, select, textarea, [contenteditable], [data-fl-modal] *';

function pollGamepad(): GamepadSnapshot | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  let pads: (Gamepad | null)[] = [];
  try { pads = [...navigator.getGamepads()]; } catch { return null; }
  const p = pads.find((g) => g && g.connected && g.mapping === 'standard') ?? pads.find((g) => g && g.connected) ?? null;
  if (!p) return null;
  return { axes: [...p.axes], buttons: p.buttons.map((b) => (b.pressed ? Math.max(b.value, 1) : b.value)) };
}

export function createInput(options: InputOptions = {}): InputSource & { readonly touchLayer: () => TouchLayer | null } {
  const acc = createAccumulator();
  const offs: (() => void)[] = [];
  let target: HTMLElement | null = null;
  let touch: TouchLayer | null = null;
  let capturing = true;
  let selfReleasedLock = false;
  let touchSeen = options.touch === 'always';

  const locked = (): boolean => !!target && target.ownerDocument.pointerLockElement === target;

  function listen<T extends Event>(el: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn as EventListener, opts);
    offs.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  return {
    attach(el) {
      if (target) return;
      target = el;
      const doc = el.ownerDocument;
      const win = doc.defaultView ?? window;
      listen<KeyboardEvent>(win, 'keydown', (e) => {
        const t = e.target as Element | null;
        if (t && typeof t.closest === 'function' && t.closest(EDITABLE)) return;
        acc.keyDown(e.code, e.repeat);
        if (!capturing && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'PageUp' || e.code === 'PageDown')) e.preventDefault();
      });
      listen<KeyboardEvent>(win, 'keyup', (e) => acc.keyUp(e.code));
      listen(win, 'blur', () => acc.releaseAll());
      listen(doc, 'visibilitychange', () => { if (doc.hidden) acc.releaseAll(); });
      listen<MouseEvent>(el, 'mousedown', (e) => {
        if (capturing) return;
        if (!locked()) {
          try { void (el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined); } catch { /* unsupported */ }
          return;
        }
        acc.mouseButton(e.button, true);
      });
      listen<MouseEvent>(win, 'mouseup', (e) => acc.mouseButton(e.button, false));
      listen<MouseEvent>(doc, 'mousemove', (e) => { if (locked()) acc.mouseMove(e.movementX, e.movementY); });
      listen<MouseEvent>(el, 'contextmenu', (e) => e.preventDefault());
      listen(doc, 'pointerlockchange', () => {
        if (locked()) return;
        acc.releaseAll();
        // Esc while pointer-locked is swallowed by the browser; treat an unexpected unlock as pause.
        if (!selfReleasedLock && !capturing) acc.requestPause();
        selfReleasedLock = false;
      });
      listen<PointerEvent>(win, 'pointerdown', (e) => {
        if (e.pointerType === 'touch' && !touchSeen && options.touch !== 'never') { touchSeen = true; touch?.setVisible(true); }
      }, { capture: true });
      if (options.touch !== 'never') {
        const host = el instanceof HTMLCanvasElement ? (el.parentElement ?? doc.body) : el;
        touch = createTouchLayer(host, acc);
        const coarse = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
        if (coarse) touchSeen = true;
        touch.setVisible(touchSeen);
      }
    },
    sample(ctx: InputSampleContext) {
      capturing = ctx.uiCapturing;
      if (capturing && locked()) {
        selfReleasedLock = true;
        try { target!.ownerDocument.exitPointerLock(); } catch { /* ignore */ }
      }
      acc.setGamepad(pollGamepad());
      const cmd = acc.sample(ctx);
      if (touch) {
        touch.setContext({
          capturing,
          canShift: ctx.state.player.anchorKey !== null,
          canInteract: nearInteractable(ctx.manifest, ctx.state) !== null,
        });
      }
      return cmd;
    },
    queueControl: (a) => acc.queueControl(a),
    previewAnchorKey: () => acc.previewAnchorKey(),
    activeDevice: (): InputDevice => acc.activeDevice(),
    touchLayer: () => touch,
    dispose() {
      for (const off of offs.splice(0)) off();
      touch?.dispose();
      touch = null;
      if (locked()) { selfReleasedLock = true; try { target!.ownerDocument.exitPointerLock(); } catch { /* ignore */ } }
      target = null;
    },
  };
}

export { createAccumulator, nearControlScreen, nearestAnchor, nearInteractable } from './accumulator';
export type { InputAccumulator } from './accumulator';
export * from './core';
