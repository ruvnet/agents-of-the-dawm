/**
 * Throwaway browser harness for the UI (not part of the app; the coordinator owns src/app).
 * Mounts createUi/createInput with fixture frames produced by the REAL simulation.
 * Query: ?view=start|hud|control|ending|fatal &stage=fresh|previewed|restored|confirm &scale=1|1.5|2
 *        &semantic=ready &touch=1
 */
import { loadSector01 } from '../../../src/contracts/fixtures';
import type { ControlAction, SimState, Simulation, UiFrame, UiSettings, WorldEvent } from '../../../src/contracts';
import { createSimulation } from '../../../src/sim';
import { isGrounded } from '../../../src/sim/state';
import { composeFinalGraphView } from '../../../src/world/compose';
import { createInput, createUi, mergeSettings } from '../../../src/ui';
import type { CaptionCue } from '../../../src/contracts/narrative';

declare global {
  interface Window { __uiHarness?: { ready: boolean; view: string; errors: string[] } }
}

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'start';
const stage = q.get('stage') ?? 'previewed';
const scale = Number(q.get('scale') ?? '1') as UiSettings['textScale'];
const touch = q.get('touch') === '1';
const manifest = loadSector01();
const sim: Simulation = createSimulation(manifest, { seed: 1047 });
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

function mutate(fn: (s: SimState) => void): void {
  const snap = sim.snapshot();
  const s = structuredClone(snap.state);
  fn(s);
  s.player.grounded = isGrounded(manifest, s);
  sim.restore({ ...snap, state: s });
}

const control = (a: ControlAction): readonly WorldEvent[] =>
  sim.step({ tick: sim.state().tick, move2: [0, 0], look2: [0, 0], jump: false, pulse: false, spike: false, shiftAnchorId: null, interact: false, pause: false, control: a });

let captions: CaptionCue[] = [];
let events: readonly WorldEvent[] = [];
let objective: UiFrame['objective'] = { key: 'reach-anchor', text: 'Reach the inspection anchor.' };
let paused = false;

if (view === 'hud' || view === 'fatal') {
  mutate((s) => {
    const a1 = manifest.geometry.anchors.find((a) => a.key === 'anchor-a1-inspection')!;
    s.player.pos = [(a1.volume.min[0] + a1.volume.max[0]) / 2, a1.volume.min[1], (a1.volume.min[2] + a1.volume.max[2]) / 2];
    s.player.anchorKey = a1.key;
    s.puzzles[`preview:${a1.key}`] = 1;
    s.player.health = 72;
    s.player.charge = 2;
  });
  captions = [
    { id: 'S05', speaker: 'Kest', text: 'Use the inspection anchor. Wait for its crescent to turn white.', durationMs: 60_000 },
    { id: 'C-tram-bell', speaker: null, text: '[tram bell]', durationMs: 60_000 },
  ];
}
if (view === 'control' || view === 'ending') {
  mutate((s) => { s.keeper.phase = 4; s.flags.channelLocated = true; s.player.pos = [120, 14, 14]; s.player.up = '+y'; });
  objective = { key: 'authorize', text: 'Verify the relief channel and authorize the transfer.' };
  const steps: ControlAction[] = [{ kind: 'open-panel' }];
  if (stage !== 'fresh') {
    steps.push({ kind: 'scan-sensor' }, { kind: 'preview', destination: 'occupied-street' },
      { kind: 'preview', destination: 'protected-pump' }, { kind: 'preview', destination: 'relief-channel' });
  }
  if (stage === 'restored' || stage === 'confirm' || view === 'ending') steps.push({ kind: 'restore-edge' });
  if (view === 'ending') steps.push({ kind: 'authorize', destination: 'relief-channel' }, { kind: 'close-panel' });
  for (const a of steps) events = [...events, ...control(a)];
  if (view === 'ending') {
    mutate((s) => { s.tramCrossed = true; });
    captions = [
      { id: 'D01', speaker: 'DAWM', text: 'RELIEF CHANNEL: VERIFIED / PRESSURE TRANSFER: SAFE / GATE: OPEN', durationMs: 60_000 },
      { id: 'S29', speaker: 'Kest', text: 'Pressure down. Gate open. Four people aboard.', durationMs: 60_000 },
    ];
  }
}

function semanticReady(): UiFrame['graph'] {
  const g = composeFinalGraphView(sim.pressureView(), null, manifest);
  return { pressure: g.pressure, semantic: { status: 'ready', provenance: {
    origin: 'worldgraph-wasm', digest: 'sha256:9f2c1e7a4b0d3c55e8a1f0b2c6d7e8f9',
    states: manifest.derivedStates.map((d) => ({ id: d.id, statement: d.statement, evidence: [`authored:${d.subjectKey}`], model_version: 'floodline-authored-sim-v1', privacy_decision: 'synthetic:no-personal-data' })),
  } } };
}

const settings = mergeSettings({ textScale: scale });
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = createInput({ touch: touch ? 'always' : 'never' });
input.attach(canvas);
const ui = createUi({ manifest });
ui.mount(document.getElementById('ui-root')!, {
  onStart: () => undefined,
  onControl: (a) => { events = control(a); },
  onSettings: () => undefined,
  onPause: (p) => { paused = p; },
  onRestartCheckpoint: () => undefined,
  onResetSave: () => undefined,
}, settings, { hasSave: view === 'start' });
ui.setReadiness(view === 'start' ? 'controllable' : 'complete', 'webgl2');

if (view !== 'start') (document.querySelector('[data-fk="play"]') as HTMLButtonElement | null)?.click();
if (view === 'fatal') ui.showFatal('Floodline cannot start here', 'WebGPU device creation failed and WebGL2 is disabled in this browser. Enable hardware acceleration or try the WebGL2 renderer.');

function frame(): UiFrame {
  const f: UiFrame = {
    state: sim.state(), events, captions,
    graph: q.get('semantic') === 'ready' ? semanticReady() : composeFinalGraphView(sim.pressureView(), null, manifest),
    objective, backend: 'webgl2', readiness: 'complete', renderStats: null, semanticStatus: 'unavailable',
    device: touch ? 'touch' : 'keyboard', paused,
  };
  events = [];
  captions = [];
  return f;
}

let first = true;
function loop(): void {
  const ctx = { tick: sim.state().tick, state: sim.state(), manifest, uiCapturing: ui.capturing(), settings };
  input.sample(ctx); // keeps the touch layer context current; commands are not applied in the harness
  ui.update(frame());
  if (first) {
    first = false;
    if (stage === 'confirm') (document.querySelector('[data-act="authorize"]') as HTMLButtonElement | null)?.click();
    requestAnimationFrame(() => { window.__uiHarness = { ready: true, view, errors }; });
  }
  requestAnimationFrame(loop);
}
loop();
