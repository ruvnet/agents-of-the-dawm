# W1 contract proposals (not applied; frozen contracts untouched)

## P1: reason copy for non-pressure rejections (`sector-01.core.json` → `pressure.reasons`)

The simulation emits `TransferRejected` with a `reasonKey` for control-screen actions that fail before
any pressure preflight. These keys have no authored copy, so `payload.reason` currently falls back to the
key itself. Proposed additions:

```diff
   "reasons": {
+   "reason.panel.keeper-active": "The keeper still holds the pressure lock.",
+   "reason.panel.out-of-reach": "Stand at the control screen to use it.",
+   "reason.panel.closed": "Open the control screen first.",
+   "reason.preview.incomplete": "Preview all three destinations before authorizing.",
```

Workaround in `src/sim/story.ts`: `reason: reasons[key] ?? key`.

## P2 (informational): documented choices the contracts leave open

- `InputCommand.pause` is treated as a level (paused while true). Paused ticks still advance `tick`
  and perform no game action (see `src/sim/index.ts` header).
- Player anchors pick the target surface as "the surface whose `up` differs from the player's current
  `up`"; `AnchorState.activeSurface` records the last committed surface.
- For machine targets (`keeper`, `hauler`), `AnchorSurface.dynamicPose` indexes `MachineDef.patrol`.
- `surfaceBasis(up, yaw)` (exported from `src/sim`) now matches the renderer convention: reference tangent +x on ±y, else +y; yaw rotates it about up by the right-hand rule (positive yaw turns left);
  right = forward × up. Worth freezing in src/contracts so sim and render cannot drift.
