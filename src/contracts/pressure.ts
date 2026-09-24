/** ADR 0003 pressure graph and final display contract. Game simulation is the authority. */
export interface PressureRoute {
  id: string;                 // stable game ID, e.g. 'reservoir-to-relief'
  from: string;
  to: string;
  physicalPipePresent: boolean;
  approved: boolean;          // false in the initial game fixture
  safeCapacity: boolean;      // calculated from bounded authored scenario data
}

export type Destination = 'occupied-street' | 'protected-pump' | 'relief-channel';
export const DESTINATIONS: readonly Destination[] = ['occupied-street', 'protected-pump', 'relief-channel'];

export interface RoutePreview {
  destination: Destination;
  occupied: boolean;
  projectedLoad: number;      // finite, nonnegative, scenario fixture
  safeThreshold: number;      // finite, nonnegative, same unit
  unit: 'kPa';                // fixed in the first slice; shown with both values
  safe: boolean;              // deterministic preflight, never UI-authored
  reason: string;             // stable localized reason from authored copy
  evidenceSource: {
    origin: 'authored-simulation';
    fixtureId: string;        // versioned fictional scenario, not live sensing
    eventId?: string;         // verified game event, where applicable
  };
}

export interface CapacityChecks {
  pumpWithinTolerance: boolean;
  streetUnoccupiedByFlow: boolean;
  reliefWithinTolerance: boolean;
}

export interface PressureView {
  routes: readonly PressureRoute[];
  previews: readonly RoutePreview[];  // exactly one for each destination
  selectedDestination: Destination | null;
  channelLocated: boolean;
  channelSensorVerified: boolean;
  channelEdgeRestored: boolean;
  playerAuthorized: boolean;
  capacityChecks: Readonly<CapacityChecks>;
  capacitySafe: boolean;    // all required checks true for selected relief
}

export interface FinalGraphView {
  pressure: Readonly<PressureView>;
  semantic: { status: 'ready'; provenance: unknown } |
            { status: 'unavailable'; authoredEvidence: unknown };
}

/** Authored scenario values for one destination (fixture input, before simulation preflight). */
export interface PreviewFixture {
  destination: Destination;
  /** Occupancy as authored; the relief channel is only known clear after the in-world sensor scan. */
  occupied: boolean;
  projectedLoad: number;
  safeThreshold: number;
  /** Residual load on the protected pump if this destination takes the transfer. */
  pumpLoadAfter: number;
  pumpThreshold: number;
  reasonKey: string;
}

/** Validates the ADR 0003 preview rule: exactly three unique, finite, consistently-unitised previews. */
export function validatePreviews(previews: readonly RoutePreview[]): string[] {
  const errors: string[] = [];
  if (previews.length !== 3) errors.push(`expected exactly 3 previews, got ${previews.length}`);
  const seen = new Set<string>();
  for (const p of previews) {
    if (seen.has(p.destination)) errors.push(`duplicate preview ${p.destination}`);
    seen.add(p.destination);
    if (!DESTINATIONS.includes(p.destination)) errors.push(`unknown destination ${String(p.destination)}`);
    for (const [k, v] of [['projectedLoad', p.projectedLoad], ['safeThreshold', p.safeThreshold]] as const) {
      if (!Number.isFinite(v) || v < 0) errors.push(`${p.destination}.${k} must be finite and nonnegative`);
    }
    if (p.unit !== 'kPa') errors.push(`${p.destination}.unit must be kPa`);
    if (!p.reason) errors.push(`${p.destination}.reason missing`);
    if (p.evidenceSource?.origin !== 'authored-simulation' || !p.evidenceSource.fixtureId) {
      errors.push(`${p.destination}.evidenceSource must be authored-simulation with fixtureId`);
    }
  }
  return errors;
}
