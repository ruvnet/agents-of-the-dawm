import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSector01 } from '../../src/contracts/fixtures';
import type { LevelManifest, PressureView, RoutePreview, WorldEvent, WorldEventType } from '../../src/contracts';

export const WASM_PATH = fileURLToPath(new URL('../../src/wasm/pkg/worldgraph_wasm_bg.wasm', import.meta.url));
export const wasmBytes = (): Buffer => readFileSync(WASM_PATH);
export const wasmSha256 = (): string => createHash('sha256').update(wasmBytes()).digest('hex');

/**
 * Real-module loader for Node: imports the generated wasm-bindgen JS and instantiates it with the
 * actual built .wasm bytes (the `--target web` initializer accepts `{ module_or_path: BufferSource }`).
 * The adapter's own `await mod.default()` is then a no-op because the module is already initialised.
 */
export async function realLoader(): Promise<unknown> {
  const mod = await import('../../src/wasm/pkg/worldgraph_wasm.js');
  await mod.default({ module_or_path: wasmBytes() });
  return mod;
}

export const manifest = (): LevelManifest => loadSector01();

export function ev(type: WorldEventType, tick: number, key: string): WorldEvent {
  return { id: `${type}:${tick}:${key}`, tick, type, key, payload: {} };
}

/** The canonical success trace of the five semantic story events. */
export const storyEvents = (): WorldEvent[] => [
  ev('ChannelLocated', 1200, 'channel-marker'),
  ev('SensorVerified', 5400, 'relief-sensor'),
  ev('EdgeRestored', 5460, 'relief-channel'),
  ev('TransferAuthorized', 5520, 'control-screen'),
  ev('GateOpened', 5580, 'locked-gate'),
];

/** Pressure view as the simulation would report it (authored fixture values). */
export function pressureView(m: LevelManifest): PressureView {
  const previews: RoutePreview[] = m.pressure.previews.map((p) => ({
    destination: p.destination,
    occupied: p.occupied,
    projectedLoad: p.projectedLoad,
    safeThreshold: p.safeThreshold,
    unit: 'kPa',
    safe: p.destination === 'relief-channel',
    reason: m.pressure.reasons[p.reasonKey]!,
    evidenceSource: { origin: 'authored-simulation', fixtureId: m.pressure.fixtureId },
  }));
  return {
    routes: m.pressure.routes,
    previews,
    selectedDestination: 'relief-channel',
    channelLocated: true,
    channelSensorVerified: true,
    channelEdgeRestored: false,
    playerAuthorized: false,
    capacityChecks: { pumpWithinTolerance: true, streetUnoccupiedByFlow: true, reliefWithinTolerance: true },
    capacitySafe: true,
  };
}
