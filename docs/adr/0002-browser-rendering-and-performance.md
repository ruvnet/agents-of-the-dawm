# ADR 0002: Browser rendering, Tidewater reference, and performance budgets

Status: Proposed  
Date: 2026-09-24  
Owners: Rendering lead and performance reviewer  
Related: [ADR 0001](0001-original-scope-and-ip.md), [ADR 0004](0004-gravity-simulation-and-rescue-contract.md)

## Observed baseline

[Tidewater](https://github.com/dgreenheck/tidewater) uses its own WebGPU and WGSL engine. Its [GPU initializer](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/engine/gpu/GPU.js) throws when `navigator.gpu` or an adapter is absent. In a cloud browser check the public game stopped at 0 percent with `No WebGPU adapter found`; gameplay and frame rate could not be measured there. The README claims a 60 fps target at 2560 by 1267 on an Apple M5 Pro and warns that first launch may spend a minute or more compiling hundreds of shaders. Those are the project's claims, not independent benchmark results.

The source has a useful [pipeline cache and asynchronous shader compilation](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/engine/render/MeshRenderer.js), [post processing chain](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/post/PostFX.js), and [staged loader](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/App.js). Its renderer relies on its own binding and WGSL composition model. Directly moving those shaders into Three.js would require a port. Its [render scale is explicitly adjusted by hand](https://github.com/dgreenheck/tidewater/blob/1438b1abfcaee3267092b75573014f4d9b4a983c/src/App.js#L709-L718), despite the README's looser dynamic resolution description. The tracked `public/` assets total about 54 MB of uncompressed repository bytes; this is not a measured transfer or Sites build size.

## Decision

Use a Vite and TypeScript client build on Sites. Start the rendering spike with [Three.js `WebGPURenderer`](https://threejs.org/manual/pages/webgpurenderer), whose documented WebGL2 backend is the fallback. The renderer is still marked experimental by its maintainers, so keep rendering behind a small adapter and make a one room proof the first gate. If its fallback or essential post effects fail on the target matrix, switch the adapter to the maintained `WebGLRenderer` for the slice and reserve WebGPU effects for a later version. A rendering backend change must not change `SimState` or story flags.

Study Tidewater's staged loading, atmosphere, spatial sound, level of detail, pass timing, and pipeline warmup. Build an original lightweight storm sea, coast, and district rather than copying its island, whale, boat, vendor models, textures, or full engine. Any source code actually copied later carries the MIT notice; each imported asset needs its own rights check. Keep the first playable scene independent of optional sky and water detail.

## Startup and quality policy

1. Render the player, anchor, floor, objective, and input affordance before optional distant coast, spray, post effects, or music finish loading. The progress UI reports readiness for control, not a fictitious percentage of all assets.
2. Detect WebGPU, WebGL2, device loss, available memory indicators where exposed, and reduced motion preferences. Select a quality tier. If WebGPU is absent, the WebGL2 path must reach the same gameplay ending. If both renderers fail, show an actionable browser compatibility state without a blank canvas.
3. Track rolling CPU and GPU frame times when GPU timing is supported. Adjust internal scale within a bounded range with hysteresis and a cooldown; lower optional post effects before making collision or input slower. Never use a quality change to alter simulation ticks.
4. Stream original assets as a critical pack and optional packs with integrity checks. Target 3 to 5 MiB for first playable transfer and 20 to 30 MiB additional visual content. These are proposed budgets, subject to real build and network measurement.
5. No inference request, remote asset generator, or WorldGraph semantic update runs in the render callback. The simulation has a fixed tick and the graph updates at discrete story events.

## Alternatives and tradeoffs

| Approach | Delivery | Reach | Principal risk |
| --- | --- | --- | --- |
| Fork Tidewater wholesale | Reuses water and lighting sooner | WebGPU only | Ocean specific initialization, first person Y gravity and large startup payload require major rewrites |
| Three.js dual backend adapter | Rebuild visual effects, keep one scene API | WebGPU plus WebGL2 | Renderer maturity and effect parity must be proved |
| WebGL2 only | Lowest compatibility uncertainty | Broadest target devices | Less headroom for advanced GPU effects |

The selected dual backend spike has a strict exit: if fallback parity is not demonstrated early, commit to the WebGL2 slice rather than spending the content schedule on shader ports.

## Measurable gates

| ID | Target on named reference devices | Evidence |
| --- | --- | --- |
| R01 | First controllable frame within 20 seconds desktop and 30 seconds mobile at an emulated 50 Mbps, cold cache | Browser trace with device, GPU, browser version, source SHA, transfer bytes, and shader time |
| R02 | Desktop p95 frame time at most 16.7 ms at default quality; mobile p95 at most 33.3 ms at reduced quality | 5 minute scripted traversal and combat replay; report median and p95 on each device |
| R03 | WebGPU and forced WebGL2 complete the same seeded route and final predicate | Cross backend browser test with identical simulation state hash |
| R04 | Quality adjustment changes render cost without changing tick count, collision or ending | Fixed seed replay before and after forced quality shift |
| R05 | No indefinite blank screen or unrecoverable load error | Simulated adapter failure, device loss, corrupt optional asset, and retry path |

Targets are proposals until hardware measurements exist. Named devices and exact quality presets are fixed in the first prototype's evidence record, not retroactively changed to make a failing gate pass.

## Deployment and rollback

Sites hosts the static build and starts private. A previous saved Site version is the deployment rollback point. Keep a known good WebGL2 adapter and a low quality preset as runtime recovery. Record build asset hashes and retain the previous release archive so a broken shader or model can be reverted without changing saved game schema.
