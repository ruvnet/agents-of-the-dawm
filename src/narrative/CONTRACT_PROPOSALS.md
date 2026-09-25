# W5 contract proposals (audio, narrative, save). Not applied: frozen contracts are unchanged.

## P1: persist played dialogue in `SaveRecord`

`NarrativeDirector.reset(played)` needs the played line IDs after a load, but `SaveRecord` has no field
for them. Workaround: `playedFromState(snapshot.state)` in `src/narrative` derives them from
`state.fired` (`cue:<key>` entries) plus `state.branch`. This works because every dialogue cue the sim
emits is once-only. Proposal: `readonly playedLines?: readonly string[]` on `SaveRecord`.

## P2: caption hook on `AudioEngine`

The contract has no way to tell the audio engine that a caption is showing, so "duck music under
captions" has no input. Workaround: `handleEvents` ducks for the summed caption durations of the
spoken lines a `DialogueCue` triggers, and the engine exposes a non-contract `duck(ms)`. Proposal:
`duckFor(captions: readonly CaptionCue[]): void`.

## P3: `display` flag on `CaptionCue`

D01 is a DAWM on-screen display, not speech, but `CaptionCue` has no `display` flag. The UI must
currently check `speaker === 'DAWM'`. Proposal: `readonly display?: boolean`.

## P4: `'master'` in `AudioBusName`

`AudioBusName` is `'speech' | 'effects' | 'music'`. The master bus is internal. Proposal: add
`'master'` if a UI needs to address it by name. `AudioSettings.master` already covers the slider.

## P5: `UiSettings.locale`

It is `'en'` only. `src/narrative` ships a stub `fr-CA` bundle marked `needsHumanReview`.
Proposal: `'en' | 'fr-CA'` once a translator has reviewed the bundle.

## P6 (informational): extras beyond the contract

- `createSaveStore()` returns `FloodlineSaveStore`, which adds `loadBackup()` (the previous valid record)
  and `probe()` (opens the DB so `available()` reflects a private-mode failure right away).
- `createAudioEngine()` returns `FloodlineAudioEngine`, which adds `duck(ms)`, `currentStem()` and `settings()`.
- `reset()` on the save store clears everything, settings included, as the task specified. If "reset
  progress" should keep settings, the UI should call `saveSettings(current)` after `reset()`.
