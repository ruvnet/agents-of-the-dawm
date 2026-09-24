/**
 * Localisation tables for Floodline narrative text (script "Accessibility and localization").
 *
 * English is the master. Every string is addressed by a stable ID that is independent of product
 * requirement IDs: `line.<dialogue id>` (S01..S31, S16U/S16L, S17U/S17L, D01), `cue.<cue id>` for
 * non-speech captions and `objective.<key>` for objective text. Branch variants are separate keys.
 * Nothing here is generated at runtime: callers look strings up, they never compose instructions.
 */
import { dialogueEn, type DialogueFixture } from '../contracts/fixtures';

export type LocaleId = 'en' | 'fr-CA';

export const OBJECTIVE_KEYS = [
  'reach-inspection-anchor',
  'climb-wall',
  'disable-skimmers',
  'move-gantry',
  'inspect-channel-marker',
  'choose-route',
  'cross-lattice',
  'redirect-conduit',
  'expose-seals',
  'open-control-screen',
  'scan-relief-sensor',
  'preview-destinations',
  'restore-route',
  'authorize-transfer',
  'watch-tram',
  'complete',
] as const;
export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];

/** Original objective copy in the script's terse field-radio tone. */
const OBJECTIVES_EN: Record<ObjectiveKey, string> = {
  'reach-inspection-anchor': 'Reach the inspection anchor.',
  'climb-wall': 'Shift down onto the wall and follow the white seams up.',
  'disable-skimmers': 'Disable the skimmers on the maintenance deck.',
  'move-gantry': 'Shift the gantry rail to bridge the gap.',
  'inspect-channel-marker': 'Inspect the channel marker on the far bank.',
  'choose-route': 'Choose a route to the lock: the upper lattice or the lower conduit.',
  'cross-lattice': 'Cross the upper lattice to the lock.',
  'redirect-conduit': 'Turn both valves to raise the conduit platform.',
  'expose-seals': "Expose and break the keeper's three seals.",
  'open-control-screen': 'Open the control screen.',
  'scan-relief-sensor': 'Scan the relief channel sensor.',
  'preview-destinations': 'Preview all three destinations.',
  'restore-route': 'Restore the reservoir to relief channel route.',
  'authorize-transfer': 'Authorize the pressure transfer.',
  'watch-tram': 'Watch the tram cross.',
  complete: 'The tram is through. Study the wider map.',
};

export interface StringBundle {
  readonly locale: LocaleId;
  /** True until a human translator has reviewed the bundle (script: technical terms need review). */
  readonly needsHumanReview: boolean;
  readonly strings: Readonly<Record<string, string>>;
  /** Terms a reviewer must confirm before a public release. */
  readonly glossary?: Readonly<Record<string, string>>;
}

export function buildEnglishBundle(fixture: DialogueFixture = dialogueEn): StringBundle {
  const strings: Record<string, string> = {};
  for (const l of fixture.lines) strings[`line.${l.id}`] = l.text;
  for (const c of fixture.cues) strings[`cue.${c.id}`] = c.text;
  for (const k of OBJECTIVE_KEYS) strings[`objective.${k}`] = OBJECTIVES_EN[k];
  return { locale: 'en', needsHumanReview: false, strings };
}

export const EN_BUNDLE: StringBundle = buildEnglishBundle();

/**
 * fr-CA stub. DRAFT ONLY, flagged for human review; dialogue lines are intentionally left
 * untranslated so they fall back to the English master until a translator supplies them.
 */
export const FR_CA_BUNDLE: StringBundle = {
  locale: 'fr-CA',
  needsHumanReview: true,
  strings: {
    'cue.C-surge-horn': "[sirène d'alerte]",
    'cue.C-tram-bell': '[cloche du tram]',
    'cue.C-water-surge': "[déferlement d'eau]",
    'cue.C-orientation': "[carillon d'orientation]",
    'cue.C-shift-reject': '[bascule refusée]',
    'cue.C-gate': '[la vanne de crue s’ouvre]',
    'objective.reach-inspection-anchor': "Atteindre l'ancre d'inspection.",
    'objective.open-control-screen': "Ouvrir l'écran de contrôle.",
    'objective.authorize-transfer': 'Autoriser le transfert de pression.',
    'objective.watch-tram': 'Regarder le tram traverser.',
  },
  glossary: {
    anchor: 'ancre',
    'relief channel': 'canal de décharge',
    'pressure transfer': 'transfert de pression',
    keeper: 'gardien',
  },
};

export const BUNDLES: Readonly<Record<LocaleId, StringBundle>> = { en: EN_BUNDLE, 'fr-CA': FR_CA_BUNDLE };

/** Look up a string by stable ID; falls back to the English master, then to the ID itself. */
export function t(id: string, locale: LocaleId = 'en'): string {
  return BUNDLES[locale]?.strings[id] ?? EN_BUNDLE.strings[id] ?? id;
}
