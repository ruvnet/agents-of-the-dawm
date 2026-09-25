/**
 * three.js realisation of the EffectTimeline: shift flash, pulse ring, spike trail, surge seam
 * pulse, seal-break sparks, gate opening and tram crossing. Render-only.
 */
import { Group, Mesh, Vector3 } from 'three';
import type { SimState } from '../contracts/sim';
import {
  effectProgress, flashOpacity, gateOpenAmount, seamIntensity, tramTravel, type ActiveEffect, type EffectTimeline,
} from './effects';
import type { MaterialSet } from './materials';
import type { SharedGeometry } from './primitives';
import { box } from './primitives';
import type { SceneHandles } from './scene-build';
import type { V3 } from './vec';

const SPARKS = 10;

export class EffectsView {
  readonly group = new Group();
  private readonly flash: Mesh;
  private readonly ring: Mesh;
  private readonly spike: Mesh;
  private readonly sparks: Mesh[] = [];

  constructor(private readonly mats: MaterialSet, geo: SharedGeometry) {
    this.group.name = 'effects';
    this.flash = new Mesh(geo.sphere, mats.flash);
    this.ring = new Mesh(geo.torus, mats.pulse);
    this.spike = box(geo, mats.spike, [0, 0, 0], [1, 1, 1]);
    for (let i = 0; i < SPARKS; i++) {
      const s = box(geo, mats.spark, [0, 0, 0], [0.12, 0.12, 0.12]);
      s.visible = false;
      this.sparks.push(s);
    }
    this.flash.visible = this.ring.visible = this.spike.visible = false;
    this.flash.renderOrder = this.ring.renderOrder = this.spike.renderOrder = 20;
    this.group.add(this.flash, this.ring, this.spike, ...this.sparks);
  }

  update(
    timeline: EffectTimeline, nowMs: number, state: Readonly<SimState>, handles: SceneHandles,
    reduced: { motion: boolean; flashes: boolean }, playerPos: V3, playerUp: V3,
  ): void {
    const live = timeline.update(nowMs);
    const byKind = (k: ActiveEffect['kind']) => live.find((f) => f.kind === k);

    const flash = byKind('shift-flash');
    this.flash.visible = !!flash;
    if (flash) {
      const p = effectProgress(flash, nowMs);
      this.mats.flash.opacity = flashOpacity(p, reduced.flashes || reduced.motion);
      this.flash.position.set(playerPos[0] + playerUp[0], playerPos[1] + playerUp[1], playerPos[2] + playerUp[2]);
      this.flash.scale.setScalar(0.6 + p * (reduced.motion ? 0.6 : 2.4));
    }

    const pulse = byKind('pulse-ring');
    this.ring.visible = !!pulse;
    if (pulse && pulse.origin) {
      const p = effectProgress(pulse, nowMs);
      this.mats.pulse.opacity = (1 - p) * 0.8;
      this.ring.position.set(pulse.origin[0] + playerUp[0], pulse.origin[1] + playerUp[1], pulse.origin[2] + playerUp[2]);
      this.ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...playerUp));
      this.ring.scale.setScalar(0.5 + p * 6);
    }

    const spike = byKind('spike-trail');
    this.spike.visible = !!(spike && spike.origin && spike.dir);
    if (spike && spike.origin && spike.dir) {
      const p = effectProgress(spike, nowMs);
      const len = 14;
      const o = spike.origin;
      const d = spike.dir;
      this.mats.spike.opacity = (1 - p) * 0.9;
      this.spike.position.set(o[0] + d[0] * len / 2 + playerUp[0] * 1.3, o[1] + d[1] * len / 2 + playerUp[1] * 1.3, o[2] + d[2] * len / 2 + playerUp[2] * 1.3);
      this.spike.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(d[0], d[1], d[2]));
      this.spike.scale.set(0.06, 0.06, len * Math.min(1, p * 4));
    }

    // Surge telegraph: floor seams pulse for 3 s before a surge.
    const tele = byKind('surge-telegraph');
    const surge = byKind('surge');
    this.mats.seam.emissiveIntensity = tele
      ? seamIntensity(effectProgress(tele, nowMs), reduced.flashes)
      : surge ? 0.8 * (1 - effectProgress(surge, nowMs)) : 0.05;

    const seal = byKind('seal-break');
    const keeper = handles.machines.get(seal?.key ?? '') ?? [...handles.machines.values()].find((m) => m.kind === 'keeper');
    this.sparks.forEach((s, i) => {
      s.visible = !!(seal && keeper);
      if (!seal || !keeper) return;
      const p = effectProgress(seal, nowMs);
      const a = (i / SPARKS) * Math.PI * 2;
      const origin = keeper.group.position;
      const r = p * 3;
      s.position.set(origin.x + Math.cos(a) * r, origin.y + 4.3 + Math.sin(a * 1.7) * r * 0.6 - p * p * 2, origin.z + Math.sin(a) * r);
      s.scale.setScalar(0.12 * (1 - p) + 0.01);
    });

    if (handles.gate) {
      const amt = gateOpenAmount(state.flags.gateOpen, byKind('gate-open'), nowMs);
      handles.gate.obj.position.y = handles.gate.baseY + amt * handles.gate.height * 0.92;
    }
    if (handles.tram) {
      const t = tramTravel(state.tramCrossed, byKind('tram-crossing'), nowMs);
      const e = t * t * (3 - 2 * t);
      const b = handles.tram.base;
      const tr = handles.tram.travel;
      handles.tram.obj.position.set(b[0] + tr[0] * e, b[1] + tr[1] * e, b[2] + tr[2] * e);
    }
  }
}
