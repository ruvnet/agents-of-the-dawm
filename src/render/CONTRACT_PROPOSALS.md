# Renderer contract proposals (W2.RENDER.01)

Frozen contracts were not edited. These are proposals for the coordinator.

## P1. Freeze the yaw convention (blocking for camera/sim agreement)

`PlayerState.yaw` and `InputCommand.move2` ("relative to player yaw on the current surface") do not
say where yaw 0 points on each surface. The renderer currently uses, in `src/render/interpolate.ts`
(`referenceTangent`, `surfaceBasis`):

- Reference tangent R: world `+x` when up is `±y`; world `+y` when up is `±x` or `±z`.
- `forward = rotate(R, up, yaw)` (right-handed Rodrigues; positive yaw turns left).
- `right = forward × up`.

Why: the spawn pose (`+y`, yaw 0) then faces `+x` along the district with the inspection wall (`+z`)
on the right, matching the script's west-approach view; on the `-z` wall of anchor A1, yaw 0 walks
up the wall toward the ledge.

Proposal: move `referenceTangent`/`surfaceBasis` into `src/contracts/math.ts` so the simulation's
movement and the renderer's camera share one definition. If the simulation picks a different
convention, only this function needs to change in the renderer.

## P2. Optional `CameraSettings.reducedFlashes`

The script lists "reduced flashes" separately from reduced camera motion. The renderer supports it
(`seamIntensity`, `flashOpacity` take a flag) but `CameraSettings` has no field, so it currently
follows `reducedMotion`. Proposal: add `reducedFlashes: boolean`.

## P3. Collected pickups are not in `SimState`

Charge / overdrive cells cannot be hidden after collection because `SimState` has no collected set
(only `fired`, whose key format is not specified). Proposal: either document that collection keys
appear in `fired` as `pickup:<interactableKey>`, or add `collected: string[]`.

## P4. Render-time WebGPU failure after init

Once a canvas has a `webgpu` context it cannot provide `webgl2`. The renderer warms WebGPU up on a
scratch canvas before touching the game canvas, which catches backend-level failures (observed:
three 0.186 throws on `createView({ swizzle })` in Chromium 140-class builds). A later render-time
failure is reported through `onDeviceLost` with the reason; the app should then re-create the
renderer on a fresh canvas with `preferred: 'webgl2'`. Proposal: document this recovery in the
`RendererAdapter` contract comment (no type change).
