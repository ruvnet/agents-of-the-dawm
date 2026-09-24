/**
 * Final control screen DOM. Rebuilt only when the view-model changes; focus is preserved across
 * rebuilds by `data-fk` keys. Every button maps to one ControlAction sent through onControl; the
 * simulation re-validates every action. Authorization needs a separate confirm step.
 */
import type { ControlAction } from '../../contracts/input';
import { CONTROL, EN } from '../strings';
import { focusables } from '../dom';
import { esc, graphSvg } from './graph-svg';
import type { ControlVm, RouteRowVm } from './vm';

const GLYPH_SVG: Record<RouteRowVm['glyph'], string> = {
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22c0-6 4-9 8-9s8 3 8 9"/></svg>',
  capacity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17a9 9 0 0 1 18 0"/><path d="M12 17l5-7"/></svg>',
  sensor: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12"/></svg>',
};
const SHAPE = { check: '✓', cross: '✕' } as const;

export interface ControlView {
  readonly root: HTMLElement;
  render(vm: ControlVm): void;
  /** Escape / gamepad B: cancel the confirm step, otherwise close the panel. */
  back(): void;
  focusFirst(): void;
  isConfirming(): boolean;
}

function btn(fk: string, label: string, enabled: boolean, cls = '', extra = ''): string {
  return `<button type="button" class="fl-btn ${cls}" data-fk="${esc(fk)}" ${enabled ? '' : 'disabled aria-disabled="true"'} ${extra}>${esc(label)}</button>`;
}

function rowHtml(r: RouteRowVm): string {
  const cls = `fl-route ${r.safe ? 'is-safe' : 'is-unsafe'}${r.selected ? ' is-selected' : ''}`;
  const auth = r.authorize.offered ? '' : `<p class="fl-route-reject"><span class="fl-shape">✕</span> ${esc(r.authorize.rejectedText)}</p>`;
  return `<li class="${cls}" data-dest="${esc(r.destination)}">
  <div class="fl-route-head"><span class="fl-route-glyph">${GLYPH_SVG[r.glyph]}</span><strong>${esc(r.label)}</strong>
    <span class="fl-safety"><span class="fl-shape">${SHAPE[r.safetyShape]}</span> ${esc(r.safetyText.slice(2))}</span></div>
  <dl class="fl-route-nums">
    <div><dt>${esc(CONTROL.projected)}</dt><dd><b>${esc(String(r.projectedLoad))}</b> ${esc(r.unit)}</dd></div>
    <div><dt>${esc(CONTROL.limit)}</dt><dd><b>${esc(String(r.safeThreshold))}</b> ${esc(r.unit)}</dd></div>
    <div><dt>Occupancy</dt><dd>${esc(r.occupancyText)}</dd></div>
  </dl>
  <p class="fl-route-reason">${esc(r.reason)}</p>
  <p class="fl-route-evidence">${esc(r.evidenceText)}</p>
  <div class="fl-route-actions">${btn(`preview:${r.destination}`, r.previewed ? `${r.preview.label} ✓ ${CONTROL.previewed}` : r.preview.label, r.preview.enabled, 'fl-btn-small', `data-act="preview:${esc(r.destination)}"`)}${r.selected ? `<span class="fl-tag">${esc(CONTROL.selected)}</span>` : ''}</div>
  ${auth}
</li>`;
}

export function controlHtml(vm: ControlVm, confirming: boolean): string {
  const checks = vm.checks.map((c) => `<li class="fl-check ${c.ok ? 'is-ok' : 'is-bad'}"><span class="fl-shape">${SHAPE[c.shape]}</span> ${esc(c.text.slice(2))}</li>`).join('');
  const blocked = vm.authorize.blockedReasons.map((b) => `<li>${esc(b)}</li>`).join('');
  const sem = vm.semantic;
  const confirm = confirming && vm.authorize.enabled ? `<div class="fl-confirm" role="alertdialog" aria-modal="true" aria-labelledby="fl-auth-title" aria-describedby="fl-auth-body">
    <h3 id="fl-auth-title">${esc(CONTROL.confirmTitle)}</h3>
    <p id="fl-auth-body">${esc(vm.authorize.consequence)}</p>
    <div class="fl-row">${btn('auth-cancel', EN.cancel, true, '', 'data-act="auth-cancel"')}${btn('auth-confirm', CONTROL.confirm, true, 'fl-btn-primary', 'data-act="auth-confirm"')}</div>
  </div>` : '';
  return `<header class="fl-modal-head">
  <div><h2 id="fl-control-title">${esc(CONTROL.title)}</h2><p class="fl-sub">${esc(CONTROL.subtitle)}</p></div>
  ${btn('close', `${EN.close} ✕`, true, 'fl-btn-small', 'data-act="close"')}
</header>
<div class="fl-control-body">
  <div class="fl-control-graph">${graphSvg(vm)}
    <p class="fl-legend"><span class="fl-leg is-approved">━ approved route</span> <span class="fl-leg is-missing">╌ ✕ ${esc(CONTROL.missingEdge)}</span> <span class="fl-leg is-unapproved">┄ not approved</span></p>
  </div>
  <section class="fl-control-step" aria-labelledby="fl-sensor-h">
    <h3 id="fl-sensor-h">1 · ${esc(CONTROL.sensorTitle)}</h3>
    <p class="fl-note">${esc(vm.sensor.label)}</p>
    <p class="fl-sensor-result ${vm.sensor.verified ? 'is-ok' : ''}">${esc(vm.sensor.result)}</p>
    ${btn('scan', vm.scan.label, vm.scan.enabled, '', 'data-act="scan"')}
  </section>
  <section class="fl-control-step" aria-labelledby="fl-routes-h">
    <h3 id="fl-routes-h">2 · ${esc(CONTROL.routes)}</h3>
    <ul class="fl-routes">${vm.rows.map(rowHtml).join('')}</ul>
  </section>
  <section class="fl-control-step" aria-labelledby="fl-checks-h">
    <h3 id="fl-checks-h">${esc(CONTROL.checksTitle)} <span class="fl-sub">${esc(CONTROL.checksFor)}: ${esc(vm.selectedLabel)}</span></h3>
    <ul class="fl-checks">${checks}</ul>
  </section>
  <section class="fl-control-step" aria-labelledby="fl-restore-h">
    <h3 id="fl-restore-h">3 · ${esc(vm.edgeRestored ? CONTROL.restoredEdge : CONTROL.missingEdge)}</h3>
    ${btn('restore', vm.restore.label, vm.restore.enabled, '', 'data-act="restore"')}
  </section>
  <section class="fl-control-step fl-authorize" aria-labelledby="fl-auth-h">
    <h3 id="fl-auth-h">4 · Authorize (relief channel only)</h3>
    ${btn('authorize', CONTROL.authorize, vm.authorize.enabled, 'fl-btn-primary', 'data-act="authorize"')}
    ${blocked ? `<ul class="fl-blocked">${blocked}</ul>` : ''}
  </section>
  <section class="fl-control-step fl-semantic is-${sem.status}" aria-labelledby="fl-sem-h">
    <h3 id="fl-sem-h">${esc(sem.heading)}</h3>
    ${sem.label ? `<p class="fl-note">${esc(sem.label)}</p>` : ''}
    <ul>${sem.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
  </section>
  <p class="fl-control-status" role="status" aria-live="polite">${esc(vm.statusText)}</p>
</div>
${confirm}`;
}

export function createControlView(onControl: (a: ControlAction) => void): ControlView {
  const root = document.createElement('section');
  root.className = 'fl-modal fl-control';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'fl-control-title');
  root.dataset.flModal = 'control';
  let confirming = false;
  let lastKey = '';
  let current: ControlVm | null = null;

  const rerender = () => {
    if (!current) return;
    const key = JSON.stringify(current) + String(confirming);
    if (key === lastKey) return;
    lastKey = key;
    const active = document.activeElement as HTMLElement | null;
    const fk = active && root.contains(active) ? active.dataset.fk : undefined;
    const scroll = root.querySelector('.fl-control-body')?.scrollTop ?? 0;
    root.innerHTML = controlHtml(current, confirming);
    const body = root.querySelector('.fl-control-body');
    if (body) body.scrollTop = scroll;
    const confirmBox = root.querySelector<HTMLElement>('.fl-confirm');
    if (confirmBox) { root.querySelector<HTMLElement>('[data-fk="auth-cancel"]')?.focus(); return; }
    if (fk) {
      const same = root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]:not([disabled])`);
      if (same) same.focus();
      else focusables(root)[0]?.focus();
    }
  };

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.hasAttribute('disabled') || !current) return;
    const act = el.dataset.act!;
    if (act === 'close') onControl({ kind: 'close-panel' });
    else if (act === 'scan') onControl(current.scan.action);
    else if (act === 'restore') onControl(current.restore.action);
    else if (act.startsWith('preview:')) {
      const row = current.rows.find((r) => `preview:${r.destination}` === act);
      if (row) onControl(row.preview.action);
    } else if (act === 'authorize') { if (current.authorize.enabled) { confirming = true; rerender(); } }
    else if (act === 'auth-cancel') { confirming = false; rerender(); root.querySelector<HTMLElement>('[data-fk="authorize"]')?.focus(); }
    else if (act === 'auth-confirm') {
      confirming = false;
      if (current.authorize.enabled) onControl(current.authorize.action);
      rerender();
    }
  });

  return {
    root,
    render(vm) {
      current = vm;
      if (!vm.authorize.enabled) confirming = false;
      rerender();
    },
    back() {
      if (confirming) { confirming = false; rerender(); root.querySelector<HTMLElement>('[data-fk="authorize"]')?.focus(); return; }
      onControl({ kind: 'close-panel' });
    },
    focusFirst() {
      const list = focusables(root);
      (list.find((el) => el.dataset.fk !== 'close') ?? list[0])?.focus({ preventScroll: true });
      root.scrollTop = 0;
    },
    isConfirming: () => confirming,
  };
}
