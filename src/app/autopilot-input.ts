import type { ControlAction, InputCommand } from '../contracts/input';
import { idle } from '../contracts/input';
import type { LevelManifest } from '../contracts/manifest';
import type { InputDevice, InputSampleContext, InputSource } from '../contracts/ui';
import { createAutopilot, fullPlan } from '../sim/autopilot';

/**
 * Demo / e2e input: the W1 scripted bot plays the slice through the real simulation.
 * Enabled only by the `?demo=upper|lower` query parameter; never in normal play.
 */
export function createAutopilotInput(manifest: LevelManifest, route: 'upper' | 'lower'): InputSource & { done(): boolean } {
  const pilot = createAutopilot(manifest, fullPlan(route));
  return {
    attach() {},
    sample(ctx: InputSampleContext): InputCommand {
      const cmd = pilot.next(ctx.state);
      return cmd ? { ...cmd, tick: ctx.tick } : idle(ctx.tick);
    },
    queueControl(_a: ControlAction) {},
    previewAnchorKey: () => null,
    activeDevice: (): InputDevice => 'keyboard',
    dispose() {},
    done: () => pilot.done,
  };
}
