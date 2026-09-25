/**
 * HUD: pure view-model (hudVm) plus a thin DOM that only rewrites text that changed.
 */
import type { Axis } from '../contracts/math';
import type { LevelManifest } from '../contracts/manifest';
import type { SimState, WorldEvent } from '../contracts/sim';
import { PLAYER_MAX_CHARGE, PLAYER_MAX_HEALTH } from '../contracts/sim';
import type { Bindings, InputDevice } from '../contracts/ui';
import { nearestAnchor, nearInteractable } from './input/accumulator';
import { actionGlyph, crescentFor, EN } from './strings';
import { h, setHidden, setText } from './dom';
import type { ActiveCaption } from './captions';

export interface PromptVm {
  readonly glyph: string;
  readonly text: string;
  /** Crescent shape + words for the destination surface (never colour only). */
  readonly crescent: string | null;
  readonly hint: string | null;
  readonly kind: 'preview' | 'shift' | 'offline' | 'approach';
}

export interface HudVm {
  readonly health: number;
  readonly healthText: string;
  readonly chargePips: readonly boolean[];
  readonly chargeText: string;
  readonly overdriveText: string | null;
  readonly objective: string | null;
  readonly anchor: PromptVm | null;
  readonly interact: { readonly glyph: string; readonly text: string } | null;
}

export interface HudContext {
  readonly manifest: LevelManifest | null;
  readonly device: InputDevice;
  readonly bindings: Bindings;
  readonly showTutorials: boolean;
  /** Destination up axis per anchor from ShiftPreviewed events (fallback when no manifest). */
  readonly previewTo: ReadonlyMap<string, Axis>;
}

/** Remember ShiftPreviewed destination axes so prompts work without a manifest. */
export function trackPreviews(events: readonly WorldEvent[], map: Map<string, Axis>): void {
  for (const e of events) {
    if (e.type === 'ShiftPreviewed' && typeof e.payload.to === 'string') map.set(e.key, e.payload.to as Axis);
  }
}

function destinationUp(s: Readonly<SimState>, key: string, ctx: HudContext): Axis | null {
  const def = ctx.manifest?.geometry.anchors.find((a) => a.key === key);
  const st = s.anchors.find((a) => a.key === key);
  if (def && st) {
    // Player anchors target the surface whose up differs from the player's (sim P2 note).
    if (def.target === 'player') return def.surfaces.find((x) => x.up !== s.player.up)?.up ?? null;
    return def.surfaces[st.activeSurface === 0 ? 1 : 0].up;
  }
  return ctx.previewTo.get(key) ?? null;
}

export function anchorPrompt(s: Readonly<SimState>, ctx: HudContext): PromptVm | null {
  const glyph = actionGlyph('shift', ctx.device, ctx.bindings);
  const key = s.player.anchorKey;
  if (key) {
    const st = s.anchors.find((a) => a.key === key);
    const up = destinationUp(s, key, ctx);
    const c = up ? crescentFor(up) : null;
    const crescent = c ? `${c.glyph} ${c.words}` : null;
    if (st && !st.enabled) return { glyph, text: EN.anchorOffline, crescent, hint: null, kind: 'offline' };
    const previewed = s.puzzles[`preview:${key}`] === 1;
    return {
      glyph, crescent, hint: null,
      text: previewed ? EN.shiftDown : EN.previewDown,
      kind: previewed ? 'shift' : 'preview',
    };
  }
  if (!ctx.manifest) return null;
  const near = nearestAnchor(ctx.manifest, s, 3);
  if (!near) return null;
  const up = destinationUp(s, near, ctx);
  const c = up ? crescentFor(up) : null;
  return {
    glyph, text: EN.previewDown, crescent: c ? `${c.glyph} ${c.words}` : null,
    hint: ctx.showTutorials ? EN.stepIntoField : null, kind: 'approach',
  };
}

export function interactPrompt(s: Readonly<SimState>, ctx: HudContext): HudVm['interact'] {
  if (!ctx.manifest || s.pressure.panelOpen) return null;
  const key = nearInteractable(ctx.manifest, s);
  if (!key) return null;
  const it = ctx.manifest.geometry.interactables.find((i) => i.key === key);
  if (!it) return null;
  let text: string | null = null;
  switch (it.kind) {
    case 'pressure-map': text = s.puzzles['map-open'] === 1 ? 'Close pressure map' : 'Inspect pressure map'; break;
    case 'channel-marker': text = s.flags.channelLocated ? null : 'Inspect channel marker'; break;
    case 'valve': text = 'Turn valve'; break;
    case 'control-screen': text = s.keeper.phase === 4 ? 'Open control screen' : 'Control screen held by the keeper'; break;
    default: text = null;
  }
  return text ? { glyph: actionGlyph('interact', ctx.device, ctx.bindings), text } : null;
}

export function hudVm(s: Readonly<SimState>, objective: string | null, ctx: HudContext): HudVm {
  const p = s.player;
  const health = Math.max(0, Math.min(PLAYER_MAX_HEALTH, Math.round(p.health)));
  const charge = Math.max(0, Math.min(PLAYER_MAX_CHARGE, Math.floor(p.charge)));
  return {
    health,
    healthText: `${EN.health} ${health}/${PLAYER_MAX_HEALTH}`,
    chargePips: Array.from({ length: PLAYER_MAX_CHARGE }, (_, i) => i < charge),
    chargeText: `${EN.charge} ${charge}/${PLAYER_MAX_CHARGE}`,
    overdriveText: p.overdrive > 0 ? `${EN.overdrive} ◆ ${p.overdrive}` : null,
    objective,
    anchor: anchorPrompt(s, ctx),
    interact: interactPrompt(s, ctx),
  };
}

// ------------------------------------------------------------------ DOM

export interface HudDom {
  readonly root: HTMLElement;
  render(vm: HudVm): void;
  renderCaptions(list: readonly ActiveCaption[], enabled: boolean): void;
  renderDisplay(d: ActiveCaption | null): void;
}

export function createHud(onPause: () => void, onScript: () => void): HudDom {
  const bar = h('div', { class: 'fl-health-fill' });
  const healthText = h('span', { class: 'fl-health-text' });
  const health = h('div', { class: 'fl-health', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': PLAYER_MAX_HEALTH, 'aria-label': EN.health },
    h('div', { class: 'fl-health-bar' }, bar), healthText);
  const pips = h('span', { class: 'fl-pips', 'aria-hidden': 'true' });
  const chargeText = h('span', { class: 'fl-charge-text' });
  const overdrive = h('span', { class: 'fl-overdrive' });
  const status = h('div', { class: 'fl-status fl-panelish' }, health, h('div', { class: 'fl-charge' }, pips, chargeText), overdrive);
  const objective = h('div', { class: 'fl-objective fl-panelish', role: 'status', 'aria-live': 'polite' });
  const buttons = h('div', { class: 'fl-hud-buttons' },
    h('button', { type: 'button', class: 'fl-btn fl-btn-icon', 'aria-label': EN.script, tabindex: -1, onclick: onScript }, '☰ ', EN.script),
    h('button', { type: 'button', class: 'fl-btn fl-btn-icon', 'aria-label': 'Pause', tabindex: -1, onclick: onPause }, '❚❚'));
  const anchor = h('div', { class: 'fl-prompt fl-prompt-anchor', role: 'status', 'aria-live': 'polite' });
  const interact = h('div', { class: 'fl-prompt fl-prompt-interact', role: 'status', 'aria-live': 'polite' });
  const prompts = h('div', { class: 'fl-prompts' }, anchor, interact);
  const captions = h('div', { class: 'fl-captions', 'aria-live': 'polite', role: 'log', 'aria-label': 'Captions' });
  const display = h('div', { class: 'fl-dawm-display', role: 'status', 'aria-live': 'assertive' });
  const root = h('div', { class: 'fl-hud' }, h('div', { class: 'fl-hud-top' }, status, objective, buttons), display, h('div', { class: 'fl-hud-bottom' }, prompts, captions));
  let lastPips = '';
  let lastCaptions = '';
  let lastPrompt = '';

  const promptHtml = (el: HTMLElement, key: string, parts: Node[] | null) => {
    if (key === el.dataset.key) return;
    el.dataset.key = key;
    el.replaceChildren(...(parts ?? []));
    setHidden(el, !parts);
  };

  return {
    root,
    render(vm) {
      bar.style.width = `${vm.health}%`;
      health.setAttribute('aria-valuenow', String(vm.health));
      setText(healthText, vm.healthText);
      const pk = vm.chargePips.map((x) => (x ? '1' : '0')).join('');
      if (pk !== lastPips) {
        lastPips = pk;
        pips.replaceChildren(...vm.chargePips.map((on) => h('span', { class: `fl-pip ${on ? 'is-on' : ''}` }, on ? '●' : '○')));
      }
      setText(chargeText, vm.chargeText);
      setText(overdrive, vm.overdriveText ?? '');
      setHidden(overdrive, !vm.overdriveText);
      setText(objective, vm.objective ? `${EN.objective}: ${vm.objective}` : '');
      setHidden(objective, !vm.objective);
      const a = vm.anchor;
      const ak = a ? `${a.kind}|${a.glyph}|${a.text}|${a.crescent}|${a.hint}` : '';
      if (ak !== lastPrompt) {
        lastPrompt = ak;
        promptHtml(anchor, ak, a ? [
          h('kbd', { class: 'fl-glyph' }, a.glyph),
          h('strong', { class: `fl-prompt-text is-${a.kind}` }, a.text),
          ...(a.crescent ? [h('span', { class: 'fl-crescent' }, h('span', { class: 'fl-crescent-glyph', 'aria-hidden': 'true' }, a.crescent.slice(0, 1)), a.crescent.slice(2))] : []),
          ...(a.hint ? [h('span', { class: 'fl-hint' }, a.hint)] : []),
        ] : null);
      }
      const i = vm.interact;
      promptHtml(interact, i ? `${i.glyph}|${i.text}` : '', i ? [h('kbd', { class: 'fl-glyph' }, i.glyph), h('span', {}, i.text)] : null);
    },
    renderCaptions(list, enabled) {
      const key = enabled ? list.map((c) => c.id).join('|') : '';
      if (key === lastCaptions) return;
      lastCaptions = key;
      captions.replaceChildren(...(enabled ? list.map((c) => h('p', { class: `fl-caption${c.cue ? ' is-cue' : ''}` },
        c.speaker ? h('span', { class: 'fl-speaker' }, `${c.speaker}: `) : null,
        h('span', { class: 'fl-caption-text' }, c.text))) : []));
    },
    renderDisplay(d) {
      const key = d ? d.id : '';
      if (display.dataset.key === key) return;
      display.dataset.key = key;
      display.replaceChildren(...(d ? [h('span', { class: 'fl-dawm-tag' }, 'DAWM'), ...d.text.split(' / ').map((line) => h('span', { class: 'fl-dawm-line' }, line))] : []));
      setHidden(display, !d);
    },
  };
}
