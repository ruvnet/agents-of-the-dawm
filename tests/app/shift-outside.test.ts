import { describe, expect, it } from 'vitest';
import { loadSector01 } from '../../src/contracts/fixtures';
import { createSimulation } from '../../src/sim';
import { idle } from '../../src/contracts/input';
import { nearestPlayerAnchor } from '../../src/ui/input/accumulator';

describe('VR6: shift pressed outside every anchor reaches the sim and is rejected', () => {
  it('emits ShiftRejected and leaves state intact', () => {
    const m = loadSector01();
    const sim = createSimulation(m, { seed: 1047 });
    const before = sim.hash();
    const key = nearestPlayerAnchor(m, sim.state().player.pos);
    expect(key).not.toBeNull();
    const ev = sim.step({ ...idle(0), shiftAnchorId: key });
    expect(ev.some((e) => e.type === 'ShiftRejected')).toBe(true);
    expect(sim.state().player.up).toBe('+y');
    expect(before).not.toBe(sim.hash()); // tick advanced
    expect(sim.state().player.pos).toEqual(createSimulation(m, { seed: 1047 }).state().player.pos);
  });
});
