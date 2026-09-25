/**
 * Pure gamepad menu navigation: turns two polled snapshots into menu edges. Used by the UI while a
 * modal owns input (the game InputSource is idle then), so menus and the control screen are fully
 * gamepad-operable.
 */
export type NavEdge = 'up' | 'down' | 'left' | 'right' | 'activate' | 'back' | 'start';

export interface PadState { readonly buttons: readonly number[]; readonly axes: readonly number[] }

const on = (v: number | undefined) => (v ?? 0) > 0.5;
const STICK = 0.6;

function dirs(p: PadState): Record<'up' | 'down' | 'left' | 'right', boolean> {
  const x = p.axes[0] ?? 0;
  const y = p.axes[1] ?? 0;
  return {
    up: on(p.buttons[12]) || y < -STICK,
    down: on(p.buttons[13]) || y > STICK,
    left: on(p.buttons[14]) || x < -STICK,
    right: on(p.buttons[15]) || x > STICK,
  };
}

export function navEdges(prev: PadState | null, cur: PadState | null): NavEdge[] {
  if (!cur) return [];
  const p = prev ?? { buttons: [], axes: [] };
  const out: NavEdge[] = [];
  const dc = dirs(cur);
  const dp = dirs(p);
  for (const d of ['up', 'down', 'left', 'right'] as const) if (dc[d] && !dp[d]) out.push(d);
  if (on(cur.buttons[0]) && !on(p.buttons[0])) out.push('activate');
  if (on(cur.buttons[1]) && !on(p.buttons[1])) out.push('back');
  if (on(cur.buttons[9]) && !on(p.buttons[9])) out.push('start');
  return out;
}

export function pollPad(): PadState | null {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    const g = [...navigator.getGamepads()].find((x) => x && x.connected);
    return g ? { buttons: g.buttons.map((b) => (b.pressed ? Math.max(1, b.value) : b.value)), axes: [...g.axes] } : null;
  } catch {
    return null;
  }
}
