/**
 * Small spatial SVG of the pressure graph, built as a pure string (testable without a DOM).
 * Safety is encoded by shape (check / cross / question) and words as well as colour classes.
 */
import type { Destination } from '../../contracts/pressure';
import { CONTROL, NODE_LABELS } from '../strings';
import type { ControlVm } from './vm';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Pt = readonly [number, number];
export const NODE_POS: Record<string, Pt> = {
  reservoir: [62, 118],
  'protected-pump': [200, 46],
  'occupied-street': [236, 196],
  'relief-channel': [104, 204],
  'locked-gate': [306, 118],
  tram: [364, 118],
};

function nodeShape(key: string, [x, y]: Pt, gateOpen: boolean): string {
  switch (key) {
    case 'reservoir':
      return `<rect x="${x - 34}" y="${y - 20}" width="68" height="40" rx="12" class="fl-g-node"/>`
        + `<path d="M${x - 24} ${y + 4} q8 -6 16 0 t16 0 t16 0" class="fl-g-glyph"/>`;
    case 'protected-pump':
      return `<circle cx="${x}" cy="${y}" r="22" class="fl-g-node"/>`
        + `<path d="M${x - 13} ${y + 7} A15 15 0 0 1 ${x + 13} ${y + 7}" class="fl-g-glyph"/>`
        + `<line x1="${x}" y1="${y + 7}" x2="${x + 9}" y2="${y - 7}" class="fl-g-glyph"/>`;
    case 'occupied-street':
      return `<rect x="${x - 30}" y="${y - 18}" width="60" height="36" rx="4" class="fl-g-node"/>`
        + `<circle cx="${x}" cy="${y - 7}" r="5" class="fl-g-glyph-fill"/>`
        + `<path d="M${x - 8} ${y + 12} q8 -16 16 0" class="fl-g-glyph"/>`;
    case 'relief-channel':
      return `<path d="M${x - 34} ${y - 16} L${x + 34} ${y - 16} L${x + 22} ${y + 16} L${x - 22} ${y + 16} Z" class="fl-g-node"/>`
        + `<circle cx="${x + 20}" cy="${y - 22}" r="4" class="fl-g-glyph-fill"/>`;
    case 'locked-gate':
      return `<rect x="${x - 16}" y="${y - 26}" width="32" height="52" rx="3" class="fl-g-node ${gateOpen ? 'is-open' : 'is-locked'}"/>`
        + (gateOpen
          ? `<path d="M${x - 8} ${y - 18} L${x - 8} ${y + 18}" class="fl-g-glyph"/>`
          : `<path d="M${x - 8} ${y - 18} L${x - 8} ${y + 18} M${x} ${y - 18} L${x} ${y + 18} M${x + 8} ${y - 18} L${x + 8} ${y + 18}" class="fl-g-glyph"/>`);
    case 'tram':
      return `<rect x="${x - 24}" y="${y - 14}" width="48" height="28" rx="6" class="fl-g-node"/>`
        + [0, 1, 2, 3].map((i) => `<rect x="${x - 19 + i * 10}" y="${y - 8}" width="7" height="8" class="fl-g-glyph-fill"/>`).join('');
    default:
      return `<circle cx="${x}" cy="${y}" r="16" class="fl-g-node"/>`;
  }
}

function tag([x, y]: Pt, kind: 'safe' | 'unsafe' | 'unknown', text: string): string {
  const gy = y + 34;
  const shape = kind === 'safe'
    ? `<path d="M${x - 40} ${gy - 1} l3 4 l6 -8" class="fl-g-mark"/>`
    : kind === 'unsafe'
      ? `<path d="M${x - 40} ${gy - 5} l7 7 M${x - 33} ${gy - 5} l-7 7" class="fl-g-mark"/>`
      : `<circle cx="${x - 36}" cy="${gy - 1}" r="4" class="fl-g-mark"/>`;
  return `<g class="fl-g-tag is-${kind}">${shape}<text x="${x - 28}" y="${gy + 3}" class="fl-g-tagtext">${esc(text)}</text></g>`;
}

export function graphSvg(vm: ControlVm): string {
  const parts: string[] = [];
  parts.push(`<svg class="fl-graph" viewBox="0 0 400 250" role="img" aria-labelledby="fl-graph-title fl-graph-desc">`);
  parts.push(`<title id="fl-graph-title">${esc(CONTROL.graphTitle)}</title>`);
  const desc = vm.edges.map((e) => e.label).join('. ') + `. Gate ${vm.gateOpen ? 'open' : 'locked'}.`;
  parts.push(`<desc id="fl-graph-desc">${esc(desc)}</desc>`);
  // Context lines (not pressure routes): pump protects gate, tram waits beyond gate.
  const [px, py] = NODE_POS['protected-pump']!;
  const [gx, gy] = NODE_POS['locked-gate']!;
  const [tx, ty] = NODE_POS.tram!;
  parts.push(`<line x1="${px + 22}" y1="${py + 6}" x2="${gx - 16}" y2="${gy - 20}" class="fl-g-context"/>`);
  parts.push(`<line x1="${gx + 16}" y1="${gy}" x2="${tx - 24}" y2="${ty}" class="fl-g-context"/>`);
  for (const e of vm.edges) {
    const a = NODE_POS[e.from];
    const b = NODE_POS[e.to];
    if (!a || !b) continue;
    if (e.status === 'missing') {
      // Physical pipe with the approved route missing: dashed, broken in the middle with a cross.
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const f = 0.36;
      parts.push(`<g class="fl-g-edge is-missing" data-edge="${esc(e.id)}">`
        + `<line x1="${a[0]}" y1="${a[1]}" x2="${a[0] + (b[0] - a[0]) * f}" y2="${a[1] + (b[1] - a[1]) * f}"/>`
        + `<line x1="${a[0] + (b[0] - a[0]) * (1 - f)}" y1="${a[1] + (b[1] - a[1]) * (1 - f)}" x2="${b[0]}" y2="${b[1]}"/>`
        + `<path d="M${mx - 5} ${my - 5} l10 10 M${mx + 5} ${my - 5} l-10 10" class="fl-g-gapmark"/>`
        + `<text x="${mx - 76}" y="${my - 12}" class="fl-g-edgetext">${esc(e.label)}</text></g>`);
    } else {
      const cls = e.status === 'approved' ? (e.id === 'reservoir-to-relief' ? 'is-restored' : 'is-approved') : 'is-unapproved';
      parts.push(`<g class="fl-g-edge ${cls}" data-edge="${esc(e.id)}"><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`
        + (e.id === 'reservoir-to-relief' ? `<text x="${(a[0] + b[0]) / 2 - 58}" y="${(a[1] + b[1]) / 2 - 8}" class="fl-g-edgetext">${esc(e.label)}</text>` : '')
        + `</g>`);
    }
  }
  const rowFor = (d: string) => vm.rows.find((r) => r.destination === d);
  for (const [key, pos] of Object.entries(NODE_POS)) {
    const row = rowFor(key);
    const sel = row?.selected ? ' is-selected' : '';
    parts.push(`<g class="fl-g-nodegroup${sel}" data-node="${esc(key)}">`);
    if (row?.selected) parts.push(`<circle cx="${pos[0]}" cy="${pos[1]}" r="38" class="fl-g-selring"/>`);
    parts.push(nodeShape(key, pos, vm.gateOpen));
    const label = key === 'locked-gate' ? `Gate: ${vm.gateOpen ? 'OPEN' : 'LOCKED'}` : (NODE_LABELS[key] ?? key);
    parts.push(`<text x="${pos[0]}" y="${pos[1] - (key === 'locked-gate' ? 32 : 26)}" class="fl-g-label">${esc(label)}</text>`);
    if (row) {
      const unknown = row.destination === ('relief-channel' as Destination) && !vm.sensor.verified;
      parts.push(tag(pos, unknown ? 'unknown' : row.safe ? 'safe' : 'unsafe', unknown ? 'UNVERIFIED' : row.safe ? CONTROL.safe : CONTROL.unsafe));
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
