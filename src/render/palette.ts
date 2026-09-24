/**
 * Original Floodline palette (script "Direction for art"): pale ribbed ceramic, oxidized
 * turquoise mesh, ink-blue water, amber working lights, vermilion emergency glyphs, dawn sky.
 */
export const PALETTE = {
  ceramic: 0xe8e2d4,
  ceramicRib: 0xd3cab6,
  mesh: 0x3e9c8c,
  meshLattice: 0x74c7b5,
  metal: 0x7b8387,
  concrete: 0x9b968b,
  glass: 0x9cc4cc,
  water: 0x152a52,
  waterDeep: 0x0a1633,
  spray: 0xe6eef2,
  amber: 0xffb04a,
  amberDim: 0x4a3418,
  vermilion: 0xe2412c,
  glyphWhite: 0xf8f6ef,
  glyphIdle: 0x8fb3c4,
  glyphDisabled: 0x55606a,
  player: 0xdad6cc,
  playerAccent: 0x2f5d7a,
  ghost: 0xf8f6ef,
  skimmer: 0xb9c2c4,
  hauler: 0x8c8a78,
  keeper: 0x5d6a6e,
  machineDisabled: 0x2d3033,
  skyZenith: 0x4c6f9e,
  skyHorizon: 0xf1b38a,
  sun: 0xffd6a0,
  fog: 0xcdb7ad,
  coast: 0x3c4a5a,
  street: 0x3b3e42,
} as const;

export type PaletteKey = keyof typeof PALETTE;
