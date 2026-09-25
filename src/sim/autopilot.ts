/**
 * Deterministic scripted bot that turns a plan of high level steps into per-tick InputCommands.
 * It only reads committed SimState (never mutates it), so tests and e2e can reuse it to drive the
 * real simulation from spawn to the tram crossing. Movement never uses look2: the target is rotated
 * straight into the current yaw frame.
 */
import type { ControlAction, InputCommand } from '../contracts/input';
import { IDLE_COMMAND } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import type { Vec3 } from '../contracts/math';
import type { MachineState, SimState } from '../contracts/sim';
import { RULES } from './ctx';
import type { V3 } from './frame';
import { add, axisToVecV, bodyCenter, contains, dist, dot, len, scale, sub, surfaceBasis, tangential } from './frame';

export type BotStep =
  | { kind: 'goto'; to: Vec3; tol?: number; label?: string }
  | { kind: 'shift'; anchor: string }
  | { kind: 'interact' }
  | { kind: 'control'; action: ControlAction }
  | { kind: 'wait'; ticks: number }
  | { kind: 'waitFor'; label: string; until: (s: SimState) => boolean; timeout?: number }
  | { kind: 'fight'; machines: readonly string[] }
  | { kind: 'keeper'; useOverdrive?: boolean };

export interface Autopilot {
  /** Next command for this committed state, or null when the plan is complete. */
  next(s: Readonly<SimState>): InputCommand | null;
  readonly stepIndex: number;
  readonly done: boolean;
}

const KEEPER_PHASE_ANCHOR: Record<number, string> = { 1: 'anchor-keeper-left', 2: 'anchor-panel', 3: 'anchor-keeper-right' };
const STEP_BUDGET = 60 * 90;

function machineCenter(ms: MachineState): V3 {
  return add(ms.pos, scale(axisToVecV(ms.up), 0.5));
}

export function moveToward(s: Readonly<SimState>, to: Vec3, stopAt = 0): [number, number] {
  const p = s.player;
  const b = surfaceBasis(p.up, p.yaw);
  const delta = tangential(sub(to, p.pos), p.up);
  const d = len(delta) - stopAt;
  if (d <= 1e-4) return [0, 0];
  const k = Math.min(1, d / (RULES.walkSpeed * RULES.dt)) / len(delta);
  return [dot(delta, b.right) * k, dot(delta, b.forward) * k];
}

export function createAutopilot(m: LevelManifest, plan: readonly BotStep[]): Autopilot {
  let i = 0;
  let stepTicks = 0;
  let marker: number | null = null;

  const cmd = (s: Readonly<SimState>, over: Partial<InputCommand> = {}): InputCommand => ({ tick: s.tick, ...IDLE_COMMAND, ...over });
  const advance = () => { i += 1; stepTicks = 0; marker = null; };

  function nearestReadyCell(s: Readonly<SimState>): Vec3 | null {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (const it of m.geometry.interactables) {
      if (it.kind !== 'charge-cell' || (s.puzzles[`cell:${it.key}`] ?? 0) > s.tick) continue;
      const d = dist(s.player.pos, it.pos);
      if (d < bestD) { bestD = d; best = [it.pos[0], it.pos[1] - 0.5, it.pos[2]]; }
    }
    return best;
  }

  function fight(s: Readonly<SimState>, keys: readonly string[]): InputCommand | null {
    const p = s.player;
    const center = bodyCenter(p.pos, p.up);
    const live = s.machines.filter((x) => keys.includes(x.key) && x.active && x.mode !== 'disabled');
    if (live.length === 0) return null;
    const free = live.filter((x) => x.mode !== 'pinned');
    const stunned = free.filter((x) => x.mode === 'stunned')
      .sort((a, b) => dist(center, machineCenter(a)) - dist(center, machineCenter(b)))[0];
    if (stunned && p.charge >= 1) {
      if (dist(center, machineCenter(stunned)) <= RULES.spikeRange - 1) return p.toolCooldown === 0 ? cmd(s, { spike: true }) : cmd(s);
      return cmd(s, { move2: moveToward(s, stunned.pos, 2) });
    }
    if (p.charge < 1) {
      const cell = nearestReadyCell(s);
      if (cell) return cmd(s, { move2: moveToward(s, cell) });
    }
    const target = free.sort((a, b) => dist(center, machineCenter(a)) - dist(center, machineCenter(b)))[0];
    if (!target) return cmd(s);
    if (target.mode !== 'stunned' && dist(center, machineCenter(target)) <= RULES.pulseRange - 0.4) {
      return p.toolCooldown === 0 ? cmd(s, { pulse: true }) : cmd(s);
    }
    return cmd(s, { move2: moveToward(s, target.pos, 1.5) });
  }

  function keeper(s: Readonly<SimState>, useOverdrive: boolean): InputCommand | null {
    const k = s.keeper;
    if (k.phase === 4) return null;
    const p = s.player;
    const center = bodyCenter(p.pos, p.up);
    const km = s.machines.find((x) => x.kind === 'keeper');
    if (!km) return null;
    if (p.charge < 1) {
      const cell = nearestReadyCell(s);
      return cell ? cmd(s, { move2: moveToward(s, cell) }) : cmd(s);
    }
    if (k.sealExposedTicks > 0) {
      if (dist(center, machineCenter(km)) <= RULES.keeperSpikeRange - 1) return p.toolCooldown === 0 ? cmd(s, { spike: true }) : cmd(s);
      return cmd(s, { move2: moveToward(s, km.pos, 4) });
    }
    const threat = s.machines.find((x) => x.kind !== 'keeper' && x.active && (x.mode === 'patrol' || x.mode === 'telegraph')
      && dist(center, machineCenter(x)) <= RULES.pulseRange - 0.4);
    if (threat && p.toolCooldown === 0) return cmd(s, { pulse: true });
    if (useOverdrive && p.overdrive > 0 && k.phase === 1) {
      if (dist(center, machineCenter(km)) <= RULES.overdriveRange - 1.5) return p.toolCooldown === 0 ? cmd(s, { pulse: true }) : cmd(s);
      return cmd(s, { move2: moveToward(s, km.pos, RULES.overdriveRange - 2) });
    }
    const anchorKey = KEEPER_PHASE_ANCHOR[k.phase];
    const def = m.geometry.anchors.find((a) => a.key === anchorKey);
    const st = s.anchors.find((a) => a.key === anchorKey);
    if (!def || !st) return cmd(s);
    const spot: V3 = [(def.volume.min[0] + def.volume.max[0]) / 2, def.volume.min[1], (def.volume.min[2] + def.volume.max[2]) / 2];
    if (!contains(def.volume, p.pos) || len(tangential(sub(spot, p.pos), p.up)) > 0.5) return cmd(s, { move2: moveToward(s, spot) });
    if (st.enabled && st.cooldownTicks === 0 && p.grounded) return cmd(s, { shiftAnchorId: anchorKey! });
    return cmd(s);
  }

  function run(s: Readonly<SimState>): InputCommand | null {
    const st = plan[i];
    if (!st) return null;
    stepTicks += 1;
    const budget = st.kind === 'waitFor' ? (st.timeout ?? STEP_BUDGET) : STEP_BUDGET;
    if (stepTicks > budget) throw new Error(`autopilot step ${i} (${JSON.stringify(st)}) exceeded ${budget} ticks at tick ${s.tick}`);
    switch (st.kind) {
      case 'goto': {
        const p = s.player;
        const d = len(tangential(sub(st.to, p.pos), p.up));
        if (d <= (st.tol ?? 0.12) && p.grounded) { advance(); return run(s); }
        return cmd(s, { move2: moveToward(s, st.to) });
      }
      case 'shift': {
        const a = s.anchors.find((x) => x.key === st.anchor);
        if (!a) throw new Error(`autopilot: unknown anchor ${st.anchor}`);
        if (marker !== null && a.activeSurface !== marker) { advance(); return run(s); }
        marker = a.activeSurface;
        if (a.cooldownTicks > 0 || !s.player.grounded) return cmd(s);
        return cmd(s, { shiftAnchorId: st.anchor });
      }
      case 'interact':
        advance();
        return cmd(s, { interact: true });
      case 'control':
        advance();
        return cmd(s, { control: st.action });
      case 'wait':
        if (stepTicks > st.ticks) { advance(); return run(s); }
        return cmd(s);
      case 'waitFor':
        if (st.until(s)) { advance(); return run(s); }
        return cmd(s);
      case 'fight': {
        const c = fight(s, st.machines);
        if (!c) { advance(); return run(s); }
        return c;
      }
      case 'keeper': {
        const c = keeper(s, st.useOverdrive ?? false);
        if (!c) { advance(); return run(s); }
        return c;
      }
    }
  }

  return {
    next: run,
    get stepIndex() { return i; },
    get done() { return i >= plan.length; },
  };
}

// ------------------------------------------------------------------ authored plans for sector-01

const g = (x: number, y: number, z: number, label?: string): BotStep => ({ kind: 'goto', to: [x, y, z], label });
const ctl = (action: ControlAction): BotStep => ({ kind: 'control', action });

/** Spawn through map, first shift, wall walk, ledge, deck, gantry, marker, to the junction. */
export const PLAN_OPENING: readonly BotStep[] = [
  g(10, 0, 1, 'first-move'),
  g(18, 0, 2.5, 'pressure-map'),
  { kind: 'interact' },
  { kind: 'wait', ticks: 30 },
  { kind: 'interact' },
  g(28, 0, 3, 'anchor-a1'),
  { kind: 'shift', anchor: 'anchor-a1-inspection' },
  g(28, 15.2, 4, 'over-the-wall-top'),
  { kind: 'shift', anchor: 'anchor-a2-ledge' },
  g(31, 14, 6.5, 'ledge-charge-cell'),
  g(37, 14, 5.5, 'deck'),
  { kind: 'fight', machines: ['skimmer-d1', 'skimmer-d2'] },
  g(50, 14, 3, 'deck-charge-cell'),
  g(50, 14, 5.5, 'anchor-gantry'),
  { kind: 'shift', anchor: 'anchor-gantry' },
  { kind: 'waitFor', label: 'gantry settled', until: (s) => s.puzzles['gantry-settled'] === 1, timeout: 600 },
  g(56.5, 14, 5.5, 'on-gantry'),
  g(62.5, 14, 5.5, 'far-bank'),
  g(63, 14, 8, 'far-charge-cell'),
  { kind: 'fight', machines: ['hauler-far'] },
  g(72, 14, 8, 'channel-marker'),
  { kind: 'interact' },
];

export const PLAN_UPPER: readonly BotStep[] = [
  g(78, 14, 5.5, 'junction'),
  g(83, 14, 5.5, 'choose-upper'),
  g(84, 14, 8, 'upper-charge-cell'),
  g(88, 14, 5.5, 'anchor-lattice'),
  { kind: 'shift', anchor: 'anchor-lattice' },
  { kind: 'fight', machines: ['skimmer-u1', 'skimmer-u2', 'hauler-upper'] },
  g(102, 14, 5.5, 'overdrive-cell'),
  g(107, 14, 0.5, 'converge'),
];

export const PLAN_LOWER: readonly BotStep[] = [
  g(78, 14, -5, 'junction'),
  g(83, 14, -5, 'choose-lower'),
  g(84, 14, -4, 'lower-charge-cell'),
  g(90, 14, -3.5, 'valve-1'),
  { kind: 'interact' },
  g(88, 14, -6, 'anchor-conduit'),
  { kind: 'shift', anchor: 'anchor-conduit' },
  g(88, 19, -8, 'valve-2-on-wall'),
  { kind: 'interact' },
  g(88, 15.5, -8, 'back-to-anchor'),
  { kind: 'shift', anchor: 'anchor-conduit' },
  { kind: 'waitFor', label: 'platform raised', until: (s) => s.dynamics.some((d) => d.key === 'conduit-platform' && d.pose === 1 && !d.moving), timeout: 600 },
  g(91, 14, -5, 'platform-edge'),
  g(100, 14, -5, 'mid-lower'),
  g(107, 14, -5, 'converge'),
];

export function planArena(useOverdrive: boolean): BotStep[] {
  return [
    g(111, 14, -6, 'arena-charge-cell'),
    { kind: 'keeper', useOverdrive },
    g(120, 14, 13, 'control-screen'),
  ];
}

/** Final control-screen sequence in script order (scan, previews of all three, restore, authorize). */
export const PLAN_CONTROL: readonly BotStep[] = [
  ctl({ kind: 'open-panel' }),
  ctl({ kind: 'scan-sensor' }),
  ctl({ kind: 'preview', destination: 'occupied-street' }),
  ctl({ kind: 'preview', destination: 'protected-pump' }),
  ctl({ kind: 'preview', destination: 'relief-channel' }),
  ctl({ kind: 'restore-edge' }),
  ctl({ kind: 'authorize', destination: 'relief-channel' }),
  { kind: 'waitFor', label: 'tram crossed', until: (s) => s.tramCrossed, timeout: 600 },
  { kind: 'wait', ticks: RULES.widerMapDelayTicks + RULES.moreOutlinesDelayTicks + 5 },
];

export function fullPlan(route: 'upper' | 'lower'): BotStep[] {
  return [...PLAN_OPENING, ...(route === 'upper' ? PLAN_UPPER : PLAN_LOWER), ...planArena(route === 'upper'), ...PLAN_CONTROL];
}

/** Test/e2e convenience: drive a simulation with a plan until done. Returns commands issued. */
export function drive(sim: { state(): Readonly<SimState>; step(c: InputCommand): unknown }, pilot: Autopilot, maxTicks = 60 * 60 * 20): InputCommand[] {
  const out: InputCommand[] = [];
  while (!pilot.done) {
    if (out.length >= maxTicks) throw new Error('autopilot: tick budget exhausted');
    const c = pilot.next(sim.state());
    if (!c) break;
    sim.step(c);
    out.push(c);
  }
  return out;
}

