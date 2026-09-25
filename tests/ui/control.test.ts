import { describe, expect, it } from 'vitest';
import type { ControlAction, FinalGraphView, Simulation } from '../../src/contracts';
import { composeFinalGraphView } from '../../src/world/compose';
import { buildControlVm, semanticVm } from '../../src/ui/control/vm';
import { controlHtml } from '../../src/ui/control/view';
import { graphSvg } from '../../src/ui/control/graph-svg';
import { CONTROL } from '../../src/ui/strings';
import { manifest, mutate, newSim, step } from '../sim/helpers';

/** A real simulation standing at the control screen after the keeper, channel located. */
function atScreen(): Simulation {
  const sim = newSim(1047);
  mutate(sim, (s) => {
    s.keeper.phase = 4;
    s.flags.channelLocated = true;
    s.player.pos = [120, 14, 14];
    s.player.up = '+y';
  });
  return sim;
}

const graphOf = (sim: Simulation): FinalGraphView => composeFinalGraphView(sim.pressureView(), null, manifest);
const vmOf = (sim: Simulation) => buildControlVm({ graph: graphOf(sim), previewed: sim.state().pressure.previewed });

/** Would the simulation accept `authorize relief` right now? (trial on a snapshot, then restored) */
function simWouldAuthorize(sim: Simulation): boolean {
  const snap = sim.snapshot();
  const ev = step(sim, { control: { kind: 'authorize', destination: 'relief-channel' } });
  sim.restore(snap);
  return ev.some((e) => e.type === 'TransferAuthorized');
}

describe('control-screen view-model mirrors the simulation', () => {
  it('three rows, each with both numbers, the kPa unit, a reason and text+shape safety', () => {
    const sim = atScreen();
    step(sim, { control: { kind: 'open-panel' } });
    const vm = vmOf(sim);
    expect(vm.rows.map((r) => r.destination)).toEqual(['occupied-street', 'protected-pump', 'relief-channel']);
    for (const r of vm.rows) {
      const p = sim.pressureView().previews.find((x) => x.destination === r.destination)!;
      expect(r.loadText).toContain(`${p.projectedLoad} kPa`);
      expect(r.loadText).toContain(`${p.safeThreshold} kPa`);
      expect(r.unit).toBe('kPa');
      expect(r.reason).toBe(p.reason);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.safe).toBe(p.safe); // copied, never recomputed
      expect(r.safetyText).toMatch(p.safe ? /SAFE/ : /UNSAFE/);
      expect(r.safetyShape).toBe(p.safe ? 'check' : 'cross');
      expect(r.evidenceText).toMatch(/authored simulation/);
      expect(r.evidenceText).toContain('sector-01/pressure-scenario-v1');
    }
    expect(vm.rows.find((r) => r.destination === 'occupied-street')!.authorize).toMatchObject({ offered: false });
    expect(vm.rows.find((r) => r.destination === 'protected-pump')!.authorize).toMatchObject({ offered: false });
    expect(vm.rows.find((r) => r.destination === 'relief-channel')!.authorize).toMatchObject({ offered: true });
  });

  it('safety is not colour-only in the rendered markup', () => {
    const sim = atScreen();
    step(sim, { control: { kind: 'open-panel' } });
    const html = controlHtml(vmOf(sim), false);
    expect(html).toContain('UNSAFE');
    expect(html).toContain('✕');
    expect(html).toMatch(/<b>180<\/b> kPa/);
    expect(html).toMatch(/<b>120<\/b> kPa/);
    const svg = graphSvg(vmOf(sim));
    expect(svg).toContain(CONTROL.missingEdge);
    expect(svg).toContain('UNSAFE');
    expect(svg).toContain('LOCKED');
  });

  it('shows the explicit semantic-unavailable label with the authored evidence', () => {
    const sim = atScreen();
    const vm = vmOf(sim);
    expect(vm.semantic.status).toBe('unavailable');
    expect(vm.semantic.heading).toBe('Semantic detail unavailable — authored evidence');
    expect(vm.semantic.label).toMatch(/authored manifest evidence/);
    expect(vm.semantic.lines.join('\n')).toContain('sector-01/pressure-scenario-v1');
    expect(vm.semantic.lines.join('\n')).toMatch(/✓ established: relief-channel physically located/);
  });

  it('shows provenance detail when the semantic status is ready (untrusted shape tolerated)', () => {
    const ready = semanticVm({ status: 'ready', provenance: {
      origin: 'worldgraph-wasm', digest: 'abc123',
      states: [{ id: 10001, statement: 'relief-channel located', evidence: ['e1', 'e2'], model_version: 'm1', privacy_decision: 'synthetic' }, 'junk'],
    } });
    expect(ready.status).toBe('ready');
    expect(ready.lines.join('\n')).toContain('evidence: e1, e2');
    expect(semanticVm({ status: 'ready', provenance: 7 }).lines.length).toBe(1);
    expect(semanticVm({ status: 'unavailable', authoredEvidence: null }).heading).toBe(CONTROL.semanticUnavailable);
  });

  it('authorize is enabled only when the simulation predicates allow it (script order)', () => {
    const sim = atScreen();
    const plan: ControlAction[] = [
      { kind: 'open-panel' },
      { kind: 'scan-sensor' },
      { kind: 'preview', destination: 'occupied-street' },
      { kind: 'preview', destination: 'protected-pump' },
      { kind: 'preview', destination: 'relief-channel' },
      { kind: 'restore-edge' },
    ];
    for (const a of plan) {
      step(sim, { control: a });
      const vm = vmOf(sim);
      expect(vm.authorize.enabled).toBe(simWouldAuthorize(sim));
      if (!vm.authorize.enabled) expect(vm.authorize.blockedReasons.length).toBeGreaterThan(0);
    }
    const vm = vmOf(sim);
    expect(vm.authorize.enabled).toBe(true);
    expect(vm.edgeRestored).toBe(true);
    expect(graphSvg(vm)).toContain(CONTROL.restoredEdge);
    const ev = step(sim, { control: vm.authorize.action });
    expect(ev.some((e) => e.type === 'GateOpened')).toBe(true);
    const done = vmOf(sim);
    expect(done.gateOpen).toBe(true);
    expect(done.authorize.enabled).toBe(false);
    expect(done.rows.every((r) => !r.preview.enabled)).toBe(true);
  });

  it('never offers authorize the simulation would reject, across action orders', () => {
    const orders: ControlAction[][] = [
      [{ kind: 'open-panel' }, { kind: 'restore-edge' }, { kind: 'preview', destination: 'relief-channel' }],
      [{ kind: 'open-panel' }, { kind: 'scan-sensor' }, { kind: 'restore-edge' }, { kind: 'preview', destination: 'relief-channel' }],
      [{ kind: 'open-panel' }, { kind: 'scan-sensor' }, { kind: 'preview', destination: 'relief-channel' }, { kind: 'restore-edge' },
        { kind: 'preview', destination: 'protected-pump' }, { kind: 'preview', destination: 'occupied-street' }],
    ];
    for (const order of orders) {
      const sim = atScreen();
      for (const a of order) {
        step(sim, { control: a });
        const vm = vmOf(sim);
        if (vm.authorize.enabled) expect(simWouldAuthorize(sim)).toBe(true);
        // Mirror is conservative: street previewed last leaves capacitySafe false, so the UI asks
        // the player to preview relief (selecting it) rather than deciding safety itself.
      }
      const vm = vmOf(sim);
      expect(vm.authorize.enabled).toBe(false);
      expect(vm.authorize.blockedReasons.length).toBeGreaterThan(0);
    }
  });

  it('restore and scan buttons mirror their predicates', () => {
    const sim = atScreen();
    step(sim, { control: { kind: 'open-panel' } });
    let vm = vmOf(sim);
    expect(vm.scan.enabled).toBe(true);
    expect(vm.restore.enabled).toBe(false);
    step(sim, { control: { kind: 'scan-sensor' } });
    vm = vmOf(sim);
    expect(vm.scan.enabled).toBe(false);
    expect(vm.sensor.verified).toBe(true);
    expect(vm.sensor.label).toMatch(/authored\/synthetic game evidence, not real sensing/);
    expect(vm.restore.enabled).toBe(true);
    const snap = sim.snapshot();
    const ev = step(sim, { control: vm.restore.action });
    expect(ev.some((e) => e.type === 'EdgeRestored')).toBe(true);
    sim.restore(snap);
  });

  it('rejections from the simulation are surfaced with their reason', () => {
    const sim = atScreen();
    step(sim, { control: { kind: 'open-panel' } });
    const ev = step(sim, { control: { kind: 'preview', destination: 'occupied-street' } });
    const rej = ev.find((e) => e.type === 'TransferRejected')!;
    const vm = buildControlVm({ graph: graphOf(sim), previewed: sim.state().pressure.previewed,
      lastRejection: { reason: String(rej.payload.reason), destination: 'occupied-street' } });
    expect(vm.statusText).toContain('People are present in the street');
    expect(vm.statusText).toContain(CONTROL.nothingRouted);
  });
});
