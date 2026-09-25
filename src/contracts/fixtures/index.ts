import core from './sector-01.core.json';
import geometry from './sector-01.geometry.json';
import dialogue from './dialogue.en.json';
import { validateManifest, type LevelManifest, type GeometryManifest } from '../manifest';
import type { DialogueLine } from '../narrative';

/** Compose and validate the bundled sector-01 manifest. Throws on an invalid fixture. */
export function loadSector01(): LevelManifest {
  const composed = { ...(core as object), geometry: geometry as unknown as GeometryManifest };
  const result = validateManifest(composed);
  if (!result.ok) throw new Error(`sector-01 manifest invalid:\n${result.errors.join('\n')}`);
  return result.value;
}

export interface DialogueFixture {
  version: 1;
  locale: 'en';
  lines: DialogueLine[];
  cues: { id: string; speaker: null; text: string; trigger: string }[];
}

export const dialogueEn = dialogue as unknown as DialogueFixture;
