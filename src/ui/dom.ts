/** Tiny DOM helpers. Functions only touch `document` when called (modules stay node-importable). */

export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set text only when it changed (update() runs every frame). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
}

/** Keep Tab / Shift+Tab inside `root`. Returns true when the event was handled. */
export function trapTab(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== 'Tab') return false;
  const list = focusables(root);
  if (list.length === 0) { e.preventDefault(); return true; }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = root.ownerDocument.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) { e.preventDefault(); first.focus(); return true; }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); return true; }
  return false;
}

/** Move focus by `delta` among focusables of `root` (gamepad / arrow navigation). */
export function moveFocus(root: HTMLElement, delta: number): void {
  const list = focusables(root);
  if (list.length === 0) return;
  const active = root.ownerDocument.activeElement as HTMLElement | null;
  const i = active ? list.indexOf(active) : -1;
  const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
  list[next]!.focus();
}
