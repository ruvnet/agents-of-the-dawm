/**
 * Pure view-model for the final control screen (ADR 0003 "Pressure graph and final display
 * contract"). It MIRRORS simulation-derived values; it never decides safety. Every enabled/disabled
 * flag below is a copy of a simulation predicate from PressureView/SimState so the player is not
 * offered an action the simulation will reject. The simulation still re-checks every action.
 */
import type { ControlAction } from '../../contracts/input';
import type { Destination, FinalGraphView, PressureRoute, RoutePreview } from '../../contracts/pressure';
import { DESTINATIONS } from '../../contracts/pressure';
import { CONTROL, DESTINATION_LABELS, NODE_LABELS } from '../strings';

export type SafetyShape = 'check' | 'cross';

export interface RouteRowVm {
  readonly destination: Destination;
  readonly label: string;
  /** Destination glyph drawn next to the label: person (street), capacity (pump), sensor (relief). */
  readonly glyph: 'person' | 'capacity' | 'sensor';
  readonly occupancyText: string;
  readonly projectedLoad: number;
  readonly safeThreshold: number;
  readonly unit: 'kPa';
  /** e.g. "Projected 180 kPa · Safe limit 120 kPa" (both numbers and the unit, always). */
  readonly loadText: string;
  readonly safe: boolean;
  readonly safetyShape: SafetyShape;
  /** Text encoding of safety, never colour only: "✓ SAFE: Within tolerance" / "✕ UNSAFE: Rejected by preflight". */
  readonly safetyText: string;
  readonly reason: string;
  readonly evidenceText: string;
  readonly selected: boolean;
  readonly previewed: boolean;
  readonly preview: { readonly action: ControlAction; readonly enabled: boolean; readonly label: string };
  /** Authorization is offered only for the relief channel; street and pump show a rejection. */
  readonly authorize: { readonly offered: false; readonly rejectedText: string } | { readonly offered: true };
}

export interface CheckVm { readonly label: string; readonly ok: boolean; readonly text: string; readonly shape: SafetyShape }

export interface EdgeVm {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** 'approved' solid; 'missing' a physical pipe without an approved route (the story's edge); 'unapproved' other unapproved pipes. */
  readonly status: 'approved' | 'missing' | 'unapproved';
  readonly label: string;
}

export interface SemanticVm {
  readonly status: 'ready' | 'unavailable';
  readonly heading: string;
  readonly label: string | null;
  readonly lines: readonly string[];
}

export interface ControlVm {
  readonly rows: readonly RouteRowVm[];
  readonly selectedLabel: string;
  readonly checks: readonly CheckVm[];
  readonly capacitySafe: boolean;
  readonly sensor: { readonly label: string; readonly result: string; readonly verified: boolean };
  readonly scan: { readonly action: ControlAction; readonly enabled: boolean; readonly label: string };
  readonly restore: { readonly action: ControlAction; readonly enabled: boolean; readonly label: string; readonly done: boolean };
  readonly authorize: {
    readonly action: ControlAction;
    readonly enabled: boolean;
    readonly blockedReasons: readonly string[];
    readonly consequence: string;
  };
  readonly edges: readonly EdgeVm[];
  readonly edgeRestored: boolean;
  readonly gateOpen: boolean;
  readonly semantic: SemanticVm;
  readonly statusText: string;
}

const RELIEF: Destination = 'relief-channel';
const RELIEF_ROUTE = 'reservoir-to-relief';
const GLYPH: Record<Destination, RouteRowVm['glyph']> = {
  'occupied-street': 'person', 'protected-pump': 'capacity', 'relief-channel': 'sensor',
};

export const fmtKpa = (v: number): string => `${Number.isFinite(v) ? Math.round(v * 10) / 10 : '—'} kPa`;

export function safetyText(safe: boolean): string {
  return safe ? `✓ ${CONTROL.safe}: ${CONTROL.safeLong}` : `✕ ${CONTROL.unsafe}: ${CONTROL.unsafeLong}`;
}

function evidenceText(p: RoutePreview): string {
  const e = p.evidenceSource;
  const ev = e.eventId ? ` · event ${e.eventId}` : '';
  return `${CONTROL.evidence}: ${CONTROL.evidenceAuthored} (fictional) · fixture ${e.fixtureId}${ev}`;
}

function occupancyText(p: RoutePreview, sensorVerified: boolean): string {
  if (p.destination === RELIEF && !sensorVerified) return CONTROL.unknownOccupancy;
  return p.occupied ? CONTROL.occupied : CONTROL.unoccupied;
}

export function edgeStatus(r: PressureRoute): EdgeVm['status'] {
  if (r.approved) return 'approved';
  return r.id === RELIEF_ROUTE && r.physicalPipePresent ? 'missing' : 'unapproved';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/** Structural narrowing of the `unknown` semantic payloads (see src/world/compose.ts and fallback.ts). */
export function semanticVm(sem: FinalGraphView['semantic']): SemanticVm {
  if (sem.status === 'ready') {
    const p = sem.provenance;
    const lines: string[] = [];
    if (isObj(p)) {
      const origin = str(p.origin);
      const digest = str(p.digest);
      if (origin) lines.push(`Origin: ${origin}`);
      if (digest) lines.push(`Digest: ${digest.length > 24 ? `${digest.slice(0, 24)}…` : digest}`);
      if (Array.isArray(p.states)) {
        for (const s of p.states) {
          if (!isObj(s)) continue;
          const ev = Array.isArray(s.evidence) ? s.evidence.filter((x) => typeof x === 'string').join(', ') : '';
          lines.push(`#${str(s.id) ?? '?'} ${str(s.statement) ?? '(no statement)'}${ev ? ` · evidence: ${ev}` : ''}`
            + `${str(s.model_version) ? ` · model ${str(s.model_version)}` : ''}${str(s.privacy_decision) ? ` · ${str(s.privacy_decision)}` : ''}`);
        }
      }
    }
    if (lines.length === 0) lines.push('Provenance reported without detail.');
    return { status: 'ready', heading: CONTROL.semanticReady, label: null, lines };
  }
  const a = sem.authoredEvidence;
  const lines: string[] = [];
  let label: string | null = null;
  if (isObj(a)) {
    label = str(a.label);
    for (const [k, name] of [['source', 'Source'], ['fixtureId', 'Fixture'], ['modelVersion', 'Model'],
      ['calibrationVersion', 'Calibration'], ['privacyDecision', 'Privacy']] as const) {
      const v = str(a[k]);
      if (v) lines.push(`${name}: ${v}`);
    }
    if (Array.isArray(a.states)) {
      for (const s of a.states) {
        if (!isObj(s)) continue;
        const est = s.established === true ? `✓ ${CONTROL.established}` : s.established === false ? `○ ${CONTROL.notEstablished}` : '– unknown';
        lines.push(`${est}: ${str(s.statement) ?? str(s.key) ?? '?'}`);
      }
    }
    const reason = str(a.reason);
    if (reason) lines.push(`Semantic status: ${str(a.semanticStatus) ?? 'unavailable'} (${reason})`);
  }
  if (lines.length === 0) lines.push('No authored evidence was supplied.');
  return { status: 'unavailable', heading: CONTROL.semanticUnavailable, label, lines };
}

export interface ControlVmInput {
  readonly graph: FinalGraphView;
  /** Destinations the simulation recorded as previewed (SimState.pressure.previewed). */
  readonly previewed: readonly Destination[];
  /** Latest TransferRejected reason text from the simulation's events, if any. */
  readonly lastRejection?: { readonly reason: string; readonly destination: string | null } | null;
}

export function buildControlVm(input: ControlVmInput): ControlVm {
  const pv = input.graph.pressure;
  const done = pv.gateOpen;
  const byDest = new Map(pv.previews.map((p) => [p.destination, p] as const));
  const allPreviewed = DESTINATIONS.every((d) => input.previewed.includes(d));
  const rows: RouteRowVm[] = [];
  for (const d of DESTINATIONS) {
    const p = byDest.get(d);
    if (!p) continue;
    rows.push({
      destination: d,
      label: DESTINATION_LABELS[d],
      glyph: GLYPH[d],
      occupancyText: occupancyText(p, pv.channelSensorVerified),
      projectedLoad: p.projectedLoad,
      safeThreshold: p.safeThreshold,
      unit: p.unit,
      loadText: `${CONTROL.projected} ${fmtKpa(p.projectedLoad)} · ${CONTROL.limit} ${fmtKpa(p.safeThreshold)}`,
      safe: p.safe,
      safetyShape: p.safe ? 'check' : 'cross',
      safetyText: safetyText(p.safe),
      reason: p.reason,
      evidenceText: evidenceText(p),
      selected: pv.selectedDestination === d,
      previewed: input.previewed.includes(d),
      preview: {
        action: { kind: 'preview', destination: d },
        // Mirrors story.ts: relief cannot be previewed before it is located; nothing after the transfer.
        enabled: !done && (d !== RELIEF || pv.channelLocated),
        label: `${CONTROL.preview} ${DESTINATION_LABELS[d]}`,
      },
      authorize: d === RELIEF ? { offered: true } : { offered: false, rejectedText: `${CONTROL.authorizeRejected}: ${p.reason}` },
    });
  }
  const relief = byDest.get(RELIEF);
  const cc = pv.capacityChecks;
  const check = (label: string, ok: boolean): CheckVm => ({ label, ok, text: `${ok ? '✓' : '✕'} ${label}: ${ok ? CONTROL.yes : CONTROL.no}`, shape: ok ? 'check' : 'cross' });
  const blocked: string[] = [];
  if (done) blocked.push(CONTROL.gateOpen);
  else {
    if (!pv.channelLocated || !pv.channelSensorVerified || !pv.channelEdgeRestored) blocked.push(relief?.reason ?? CONTROL.capacityNotSafe);
    if (!allPreviewed) blocked.push(CONTROL.previewIncomplete);
    if (allPreviewed && pv.channelEdgeRestored && !pv.capacitySafe) {
      blocked.push(pv.selectedDestination === RELIEF ? CONTROL.capacityNotSafe : CONTROL.selectRelief);
    }
  }
  const sensorVerified = pv.channelSensorVerified;
  const sensorResult = !pv.channelLocated ? CONTROL.sensorUnlocated
    : !sensorVerified ? CONTROL.sensorUnscanned
    : relief?.occupied ? CONTROL.sensorOccupied : CONTROL.sensorClear;
  const reliefSafe = relief?.safe === true;
  const lr = input.lastRejection;
  const statusText = done ? CONTROL.gateOpen
    : lr ? `${CONTROL.rejectedPrefix}${lr.destination ? ` (${DESTINATION_LABELS[lr.destination as Destination] ?? lr.destination})` : ''}: ${lr.reason} ${CONTROL.nothingRouted}`
    : '';
  return {
    rows,
    selectedLabel: pv.selectedDestination ? DESTINATION_LABELS[pv.selectedDestination] : CONTROL.noSelection,
    checks: [check(CONTROL.pumpCheck, cc.pumpWithinTolerance), check(CONTROL.streetCheck, cc.streetUnoccupiedByFlow), check(CONTROL.reliefCheck, cc.reliefWithinTolerance)],
    capacitySafe: pv.capacitySafe,
    sensor: { label: CONTROL.sensorLabel, result: sensorResult, verified: sensorVerified },
    scan: { action: { kind: 'scan-sensor' }, enabled: !done && pv.channelLocated && !sensorVerified, label: sensorVerified ? CONTROL.scanned : CONTROL.scan },
    restore: {
      action: { kind: 'restore-edge' },
      // Mirrors story.ts restore-edge: located, verified, relief preflight safe, not yet restored.
      enabled: !done && pv.channelLocated && sensorVerified && reliefSafe && !pv.channelEdgeRestored,
      label: pv.channelEdgeRestored ? CONTROL.restored : CONTROL.restore,
      done: pv.channelEdgeRestored,
    },
    authorize: {
      action: { kind: 'authorize', destination: RELIEF },
      // Mirrors the five simulation predicates (story.ts authorize); the sim decides on commit.
      enabled: !done && pv.channelLocated && sensorVerified && pv.channelEdgeRestored && allPreviewed && pv.capacitySafe,
      blockedReasons: blocked,
      consequence: relief
        ? `Reservoir pressure will flow into the relief channel: projected ${fmtKpa(relief.projectedLoad)} against a safe limit of ${fmtKpa(relief.safeThreshold)}. `
          + 'Load on the protected pump falls and the floodgate opens for the tram. This transfer cannot be undone.'
        : 'Relief channel preview unavailable.',
    },
    edges: pv.routes.map((r) => ({
      id: r.id, from: r.from, to: r.to, status: edgeStatus(r),
      label: r.id === RELIEF_ROUTE ? (r.approved ? CONTROL.restoredEdge : CONTROL.missingEdge)
        : `${NODE_LABELS[r.from] ?? r.from} → ${NODE_LABELS[r.to] ?? r.to}: ${r.approved ? 'approved' : 'not approved'}`,
    })),
    edgeRestored: pv.channelEdgeRestored,
    gateOpen: done,
    semantic: semanticVm(input.graph.semantic),
    statusText,
  };
}
