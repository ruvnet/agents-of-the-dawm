// Coordinator-owned bootstrap (C1). Composition root: every module is created here and injected.
import { loadSector01, dialogueEn } from './contracts/fixtures';
import { createSimulation } from './sim';
import { createRenderer } from './render';
import { createSemanticAdapter, composeFinalGraphView } from './world';
import { createInput, createUi, defaultSettings, mergeSettings } from './ui';
import { createAudioEngine } from './audio';
import { createNarrativeDirector, objectiveFor, playedFromState } from './narrative';
import { createSaveStore } from './storage';
import { startGame, type GameHandle } from './app/game';
import { createAutopilotInput } from './app/autopilot-input';

declare global {
  interface Window { __floodline?: GameHandle & { ready: true } }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo');
  const route = demo === 'lower' ? 'lower' : demo === 'upper' ? 'upper' : null;
  const speed = Math.min(8, Math.max(0.25, Number(params.get('speed') ?? '1') || 1));
  const root = document.getElementById('ui-root')!;
  const host = document.body;
  const manifest = loadSector01();

  const handle = await startGame(root, host, {
    manifest,
    createSimulation,
    createRenderer,
    createSemanticAdapter: () => createSemanticAdapter(),
    composeFinalGraphView,
    createInput: () => createInput(),
    createUi: () => createUi({ manifest }),
    createAudioEngine: () => createAudioEngine(),
    createNarrativeDirector: () => createNarrativeDirector(dialogueEn),
    objectiveFor: (s) => objectiveFor(s),
    playedFromState: (s) => playedFromState(s),
    createSaveStore: () => createSaveStore({ manifestId: manifest.id }),
    defaultSettings,
    validateSettings: (u) => mergeSettings(u),
    inputOverride: route ? (m) => createAutopilotInput(m, route) : undefined,
    speed,
    seed: 1047,
  });
  // Read-only debug/e2e handle: exposes committed state and evidence, never a mutation path.
  window.__floodline = Object.assign(handle, { ready: true as const });
  if (params.get('autostart') === '1' || route) void handle.start('new');
}

boot().catch((e) => {
  const root = document.getElementById('ui-root');
  if (root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#0b1622;color:#f3efe6;pointer-events:auto';
    box.textContent = `Floodline could not start: ${e instanceof Error ? e.message : String(e)}. Reload the page to retry.`;
    root.append(box);
  }
  console.error(e);
});
