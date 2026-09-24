# W4 (UI and controls) contract notes and proposals

Frozen contracts are untouched. These are the choices W4 made where the contracts leave room, plus proposals.

## Documented choices (integration must match)

1. **`InputCommand.pause` is a one-tick edge.** `sample()` sets `pause: true` on the tick Esc/P/Start
   (or the touch pause) is pressed, or when pointer lock is lost unexpectedly (browsers swallow Esc
   while locked). The simulation treats `pause` as a level, so **the app owns the paused level**: on a
   pause edge it toggles its own `paused` flag, passes it in `UiFrame.paused`, and sends `pause: true` to
   the sim while paused. `GameUi` calls `hooks.onPause(false)` from Resume / Esc / B / Start.
2. **While `uiCapturing`, pause is dropped as well**: only queued `control` actions pass. Each modal owns
   its own Esc / gamepad B (pause: resume; control screen: cancel confirm, else `close-panel`; settings,
   script, confirm: back). This prevents a double toggle.
3. **Modal state is derived from each `UiFrame`**: pause menu from `paused`, control screen from
   `state.pressure.panelOpen`, ending from `state.tramCrossed` (not the one-shot `TramCrossed` event).
   `capturing()` is true for any of these, the start screen, settings, the script panel, the reset
   confirm and the fatal state. It must be true while the panel is open, because the sim closes the
   panel if the player walks out of radius.
4. **`open-panel` sender.** `updateInteractables` has no `control-screen` case, so pressing interact
   at the control screen does nothing in the sim. `sample()` therefore adds `control: {kind:'open-panel'}`
   to the interact edge when the player's body centre is within the control-screen radius and the panel
   is closed. The coordinator may veto this and send `open-panel` itself.
5. **Call `sample()` every tick, including while paused or capturing.** Latches and the gamepad's
   previous state are consumed there. Skipping samples while paused can turn a menu press into a game
   action on resume.
6. **Authorize is mirrored conservatively.** The VM enables Authorize only when
   `channelLocated && channelSensorVerified && channelEdgeRestored && all three previewed && capacitySafe`.
   `capacitySafe` is computed for the *selected* destination. If the street or pump was previewed last, the
   sim's `authorize` (which re-selects relief) would succeed, but the UI shows "preview the relief
   channel last to select it". The UI does not decide safety itself.
7. **DAWM display.** `CaptionCue` has no `display` flag. Cues with `speaker === 'DAWM'` are rendered as
   the on-screen system display (D01), not as a subtitle, and are repeated on the ending panel.

## Proposals

- **P1: `UiFrame.previewed` or `PressureView.previewed`.** The authorize predicate needs
  `state.pressure.previewed`, which `FinalGraphView` does not carry. The UI reads it from `frame.state`.
  Adding it to `PressureView` would make the final display contract self-contained.
- **P2: `UiFrame.manifest` (or `createUi(opts)` as a contract).** Interact prompts, "anchor nearby"
  prompts and crescent glyph names need geometry. W4 takes an optional `createUi({ manifest })`.
  Without it the UI falls back to `ShiftPreviewed` payload axes and shows no interact prompt.
- **P3: sim `control-screen` interact case.** Prefer moving note 4 into `progress.ts`
  (`case 'control-screen': applyControl(open-panel)`) so the input layer holds no story logic.
- **P4: default look keys.** The task card asks for "arrow/QE look keys", but arrows move and E is
  interact. The defaults are Q/R yaw and PgUp/PgDn (Numpad 8/2/4/6) pitch. All of these are remappable.
