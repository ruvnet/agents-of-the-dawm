# Agents of the Dawm: Floodline

Status: proposed original vertical slice script. Target duration: 12 to 15 minutes for a first completion without a retry. The timing below totals approximately 14 minutes and 15 seconds. It is a pacing target, not a countdown shown to the player.

## Premise and boundaries

At dawn, a storm control network called DAWM locks a floodgate to protect a pump. A tram with four people is stranded beyond the gate. The physical relief channel that could safely take the pressure still exists, but its connection disappeared from DAWM's current district map. Tala Venn, a municipal field agent, traverses the floodworks, verifies the channel, corrects the map, and authorizes the transfer. Kest, a remote dispatcher, supplies observations and reads back safety checks. The machines defending the lock are maintenance equipment following the incomplete map. DAWM is a constrained infrastructure system, with text status rather than a speaking personality.

Gravity anchors are industrial equipment. Each marked anchor rotates the local down direction between two predetermined surfaces. The same movement affects Tala, loose objects, and maintenance machines. The player can see both landing surfaces and the proposed direction before committing. This mechanic serves rescue, navigation, cover, and combat; it does not grant unrestricted flight. The district sensor is fictional, authored game evidence; no real person, sensor, or infrastructure is measured by the browser.

The world, characters, dialogue, equipment, iconography, architecture, music, and plot are original. The referenced games supply broad mechanic and rendering research only. Do not use any CONTROL character, agency, faction, signature weapon, distinctive visual motif, or story beat. Do not reuse Tidewater's island, fishing loop, boat, whale, characters, scenery, audio, or assets. Record provenance and license before any deliberate reuse of source code or third party assets.

## Scene and interaction script

All dialogue plays over interactive control. A player action can interrupt or defer a line, but never blocks movement. Lines marked `once` do not replay after a checkpoint retry. Tutorial prompts appear near the relevant object and can be dismissed or disabled on replay. The gate and tram have no real time failure condition.

### 1. West approach, 0:00 to 1:10

**View:** Camera starts behind Tala on a narrow ceramic storm barrier. The sea lies to the left, a vertical inspection lattice to the right. A distant tram bell and four illuminated passenger windows establish the rescue goal without requiring passenger rigs. Dawn light silhouettes a sealed gate through spray.

**Player action:** Move toward the gate, inspect a waist high pressure map, then follow a lit conduit to the first anchor. The map shows reservoir pressure, protected pump, locked gate, and an unconnected outline where the relief channel should be. It never assigns a false expiration time.

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S01 | First player movement, once | Kest | “Tala, the tram is stopped beyond the gate. Four people aboard.” |
| S02 | Tram enters view, once | Tala | “Why will the gate not open?” |
| S03 | Inspect pressure map, once | Kest | “DAWM locked it to protect the pumps. Its map shows nowhere safe to send the pressure.” |
| S04 | Close map, once | Tala | “Then we find the missing route.” |

**Objective:** Reach the inspection anchor. **Checkpoint:** Spawn.

### 2. Inspection wall, 1:10 to 2:30

**View:** A white crescent on the floor and a matching crescent on the inspection wall show the only two valid gravity states. The destination is fully visible. Thin white seams form a walkable path up the wall. The horizon remains legible in the default camera mode.

**Player action:** Stand inside the crescent, preview the destination, pulse the anchor, then walk up to a dry ledge. The first shift occurs without enemies. A charge cell on the ledge introduces the tool reserve. Prompt: `PREVIEW DOWN` followed by `SHIFT DOWN`; localized button glyphs replace literal key names.

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S05 | Enter anchor zone, once | Kest | “Use the inspection anchor. Wait for its crescent to turn white.” |
| S06 | Complete first shift, once | Tala | “So down is a setting.” |
| S07 | Begin wall walk, once | Kest | “Only inside a marked field. Follow the white seams.” |

**Failure:** A fall into the canal returns Tala to the dry ledge after a short fade, with the anchor in its most recent valid state. The tutorial resumes at the appropriate prompt. **Checkpoint:** Upper ledge.

### 3. Maintenance deck, 2:30 to 4:15

**View:** A deck of oxidized mesh overlooks the gate motor. Two small Skimmer service machines have interpreted local flood protocol as a keep clear order. One remains stationary until the player acts. The second moves along a short visible patrol.

**Player action:** Use Pulse, the rescue tool's short range stun, on the stationary Skimmer. Use Spike, a deliberate precision shot, to pin a stunned machine to a safe surface for five seconds. Disable the patrol. Both machines end powered down with an amber status light and can be reactivated after the crisis; the encounter does not depict violence against people. Prompts communicate stun, pin, and recover charge through action, not a static instruction screen.

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S08 | First Skimmer wakes, once | Kest | “Flood protocol sees you as an obstruction. Disable those skimmers.” |
| S09 | First Skimmer disabled, once | Tala | “They are doing what the map tells them.” |
| S10 | Encounter cleared, once | Kest | “Then we correct the map.” |

**Failure:** Zero health restarts the encounter at full health and standard charge. The first machine again waits for input. **Checkpoint:** Maintenance deck before encounter and immediately after it.

### 4. Floating gantry, 4:15 to 6:15

**View:** A caged gantry hangs over a nine meter water gap on a rail. Its destination is shown as a pale silhouette when the anchor is previewed. The same anchor can lower the gantry to become cover on the far bank. Water sheets off its underside after each shift.

**Player action:** Rotate the anchor so the gantry moves along its rail and bridges the gap. Cross it. On the far bank, lower it between Tala and one slow Hauler machine, then use Pulse and Spike around that cover. Interact with the old channel marker to reveal the physical relief channel, still connected to the reservoir by pipework. This marker is evidence of a missing map edge, not yet proof that the channel is clear.

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S11 | Preview gantry destination, once | Kest | “The gantry is still attached to its rail.” |
| S12 | Gantry settles across gap, once | Tala | “Change the rail's down; move the bridge.” |
| S13 | Inspect channel marker, once | Tala | “The relief channel is still here.” |
| S14 | Inspect channel marker, once, after S13 | Kest | “The new district map dropped its connection.” |

**Failure:** Falling returns Tala to the closest dry side, subtracts 20 health, and leaves the gantry in a valid settled state. A failed Hauler encounter restarts at the far bank with the gantry usable as cover. **Checkpoint:** Each dry bank.

### 5. Two approaches, 6:15 to 9:20

**View:** An upper lattice and lower conduit are both marked from a common junction. A small map preview describes each route and its concrete boss benefit. Neither route hides a mandatory object, and both converge at the gate lock. The player chooses by entering one route and can backtrack before its first challenge.

| Route | Play | Reward carried to gate lock | Estimated variation |
| --- | --- | --- | --- |
| Upper lattice | Disable two Skimmers and one Hauler in an exposed space. A gravity flip moves the Hauler out of a firing lane. | One overdrive cell grants a free keeper stun. | Approximately 45 seconds shorter than the lower route for a player who wins first try. |
| Lower conduit | Inspect flow arrows, rotate two valves, and shift an anchor to reach a control platform above the water. | Redirected water increases the interval between arena surges from 20 to 30 seconds. | Approximately 45 seconds longer, with fewer enemies. |

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S15 | Enter junction, once | Kest | “Upper route is exposed and defended. Lower route is flooded. Both lead to the lock.” |
| S16U | Choose upper, once | Tala | “I am taking the lattice.” |
| S16L | Choose lower, once | Tala | “I am taking the conduit.” |
| S17U | Clear upper, once | Kest | “That charge cell can stun the keeper through its shield.” |
| S17L | Clear lower, once | Kest | “The valves bought us more time between surges.” |

Only the selected `S16` and `S17` variants play. **Failure:** Upper combat retries from the most recent safe route checkpoint, starting at route entry until the midpoint is reached; lower errors display predicted flow and allow another valve choice with no permanent flood state. **Checkpoints:** Junction, route midpoint, and convergence.

### 6. Gate keeper, 9:20 to 12:45

**View:** A heavy autonomous bulkhead maintenance rig, the Keeper, braces the gate. It has three amber seals and a shield that moves with the local gravity field. Anchor glyphs show the two valid orientations. The floor seams pulse three seconds before a surge, with a distinct low horn and caption. The keeper is disabled mechanically, not portrayed as a villain.

**Player action and encounter phases:**

| Phase | Telegraph and action | Success feedback | Retry boundary |
| --- | --- | --- | --- |
| Seal one | Preview left anchor, shift the keeper's weight sideways, fire one Spike at the exposed seal. | First seal darkens; pressure graph loses one lock segment. | Restart phase one. |
| Seal two | A surge advances along lit floor seams; one Skimmer arrives. Dodge or stand behind a floating panel. Shift the panel with the anchor, then hit the exposed seal. | Second lock segment goes dark. | Restart phase two with the first seal retained. |
| Seal three | Keeper charges the gate on a clear five second windup. Flip the right anchor to pin its chassis against the wall for three seconds, then hit the final seal. | Machine powers down safely; gate stays locked pending pressure transfer. | Restart phase three with two seals retained. |

The overdrive cell from the upper route supplies one free stun. The lower route lengthens the surge interval. Neither reward bypasses a seal or changes the story outcome. A missed shot repeats its readable telegraph. Aim assistance widens exposed seal time to five seconds. When health reaches zero, restart the current phase with full health and standard charge, without replaying dialogue. Each retry should repeat at most 60 seconds of successful play.

| ID | Trigger | Speaker | Exact English subtitle and voice |
| --- | --- | --- | --- |
| S18 | Enter arena, once | Kest | “The keeper is holding the gate. Expose its three seals.” |
| S19 | First anchor preview, once | Tala | “I can make it fall sideways.” |
| S20 | Seal one disabled, once | Kest | “One down. Its shield follows gravity.” |
| S21 | Seal two disabled, once | Tala | “Last one. Get the district map ready.” |
| S22 | Keeper disabled, once | Kest | “Lock released. The gate still needs somewhere safe to send the water.” |

**Checkpoint:** Arena entry and each completed seal phase.

### 7. Verify, authorize, release, 12:45 to 14:15

**View:** A local control screen offers three pressure destinations in a small spatial graph. The occupied street has a person glyph and exceeds safe impact. The active pump chamber has a capacity glyph and overloads. The old relief channel has an in-world inspection sensor and a capacity within tolerance. Shapes, words, and numeric values reinforce all colors. The player's physical earlier discovery makes the relief channel inspectable.

**Player action:** Activate the relief channel sensor from the control screen. Preview each destination with an explicit predicted consequence. The street and pump routes are rejected by preflight with a reason; the system cannot silently route to either. Restore the missing `reservoir → relief channel` approved pressure route only after the sensor reports no people and sufficient capacity. A separate deliberate input authorizes the diversion. Water flows into the channel, load on the pump falls, and the floodgate opens. The tram crosses as dawn lights the wet ceramic ribs. A compact ending panel offers replay, quality, captions, and credits without a lengthy unskippable sequence.

| ID | Trigger | Speaker or display | Exact English text |
| --- | --- | --- | --- |
| S23 | Control screen opens, once | Kest | “The keeper was guarding the pressure lock.” |
| S24 | Relief channel outline selected, once | Tala | “That missing channel is our outlet.” |
| S25 | Before sensor action, once | Kest | “Scan it first. The last survey is old.” |
| S26 | Sensor verified, once | Kest | “Clear of people. The channel can take this pressure.” |
| S27 | Pressure preview opens, once | Kest | “The street is occupied. The pump chamber overloads. The relief channel stays within tolerance.” |
| S28 | Player authorizes, once | Tala | “The route is restored. I authorize the transfer.” |
| D01 | After authorization | DAWM display | “RELIEF CHANNEL: VERIFIED / PRESSURE TRANSFER: SAFE / GATE: OPEN” |
| S29 | Tram crosses, once | Kest | “Pressure down. Gate open. Four people aboard.” |
| S30 | Wider map appears, once | Tala | “One missing route nearly trapped them.” |
| S31 | Two other unconnected outlines appear, once | Kest | “And I found two more.” |

The graph view is a grounded sequel hook: it shows two further unverified outlines, not two authorized routes or proof of a wider threat. **Failure:** No timed loss. Unsafe route previews cannot commit; they explain the risk and return to selection. Leaving the panel preserves the completed keeper state and resumes at verification. **Checkpoint:** Keeper disabled and final authorization.

## World state and safety invariants

The display is a readable view of deterministic world state. It is not generated dialogue. Relevant nodes are reservoir, protected pump, locked gate, tram, occupied street, and relief channel. A pipe physically connects the reservoir and relief channel at level start, but the approved route graph lacks that edge. This single missing edge explains DAWM's gate lock and the entire rescue. The branch choice changes combat conditions but does not change the safety result.

| State variable | Initial state | Evidence or action | Required final state |
| --- | --- | --- | --- |
| `channelLocated` | false | Inspect physical marker after gantry. | true before the channel can be selected. |
| `channelSensorVerified` | false | Activate the authored in-world sensor at the control panel. | true, including occupancy clear and pressure capacity sufficient. |
| `channelEdgeRestored` | false | Select the inspected channel and confirm the graph correction. | true before authorization. |
| `playerAuthorized` | false | Separate explicit confirmation with consequence preview. | true before valve movement. |
| `gateOpen` | false | Pressure transfer succeeds under all preceding predicates. | true before tram crosses. |

The invariant is `gateOpen ⇒ channelLocated ∧ channelSensorVerified ∧ channelEdgeRestored ∧ playerAuthorized ∧ pumpWithinTolerance ∧ streetUnoccupiedByFlow`. Unsafe preview choices never mutate the approved pressure route graph. Failed actions and checkpoint resets cannot produce an open gate without the predicates. The tram never has a separate map classification error. The game's deterministic pressure graph owns route capacity and approval; WorldGraph projects authored topology and the provenance of this repair using its supported semantic state and evidence relations. Record the chosen route, verification evidence, preview result, and authorization in a reproducible event log.

## Direction for art, sound, and camera

The visual identity is a coastal engineering landscape at sunrise: pale ribbed ceramic, oxidized turquoise mesh, ink blue water, amber working lights, and vermilion emergency glyphs. The geometry is curved and tensile, with exposed siphons and lattice walkways. Wide views emphasize sea and sky; vertical shafts emphasize the changing down direction. Avoid an office interior, monolithic brutalism, abstract red corruption, and any borrowed silhouettes or symbols. Water, spray, atmosphere, and reflections are environmental anchors for the scene, while gameplay objects retain simple readable silhouettes.

Music uses three original adaptive stems: a slow pump pulse in exploration, sharper processed hull percussion in encounters, and a warm synthetic chord progression on safe release. Sound events include local surf, pump hum, gantry strain, machine servo, orientation chime, warning horn, water surge, tram bell, and damped underwater sound on a fall. Dialogue is intelligible over these layers through ducking and separate volume sliders. Each shift gives an audio direction cue even when camera roll is disabled.

Default camera eases between anchor states in approximately 0.65 seconds and keeps the next landing surface visible. A no roll option keeps the horizon level, with camera repositioning that does not roll the scene. Reduced camera motion, disabled motion blur, reduced flashes, and field of view control should be available before first play. The camera must not hide an active threat during a shift.

## Accessibility and localization

Support remappable keyboard and gamepad input. Touch uses large context controls, optional aim assistance, and a camera sensitivity setting. Every required action works with one press or hold; no rapid button sequence is required. Tutorials can be revisited. Optional assist halves incoming damage, extends boss exposure timing, and keeps the route choice intact. Anchor surfaces use distinct crescent orientation glyphs and text in addition to color. Captions identify the speaker and include necessary non speech cues, such as `[surge horn]` and `[tram bell]`. Offer separate speech, effects, and music controls and a scrollable script panel.

English is the master script for the first private playable slice. Prepare a fr-CA subtitle and interface bundle for the first public release, with human review of technical terms such as anchor, relief channel, pressure transfer, and keeper. The initial voice plan is English only, with fr-CA subtitles selected independently. Store lines by the stable dialogue IDs above, separate from product requirement IDs; keep punctuation, speaker, trigger, and caption cue separate. Avoid baking English labels into textures. Allow roughly 30 percent more layout width for translated text and show numeric units consistently. Branch variants are separate localized keys. Never synthesize new mission instructions at runtime.

## Bounded production inventory and acceptance

| Category | Slice ceiling |
| --- | --- |
| Playable space | One contiguous district, seven beats, two route variants, one finale. |
| Geometry | One modular seawall and gantry kit with about 20 unique mesh families; repeated pieces may be instanced. |
| Characters | One player rig, two small machine rigs, one keeper rig; tram and four occupants are implied at distance, with no passenger rigs. |
| Interactables | One reusable anchor base with three placement variants, two valves, one channel marker, one control screen. |
| Effects | At most eight families, including spray, water sheet, surge, anchor field, sparks, tool pulse, spike trail, and sunrise haze. |
| Audio | Three adaptive music stems, approximately 18 reusable sound events, two English voice performers, and one silent DAWM display. |
| Script | 31 spoken lines per route, 33 localized English strings including both exclusive route variants, plus one system display and captions. |

Acceptance is a first time player reaching the first gravity shift within two minutes, seeing both route tradeoffs before choosing, completing either route, and explaining that the missing relief channel and explicit authorization allowed the gate to open. Automated story tests should reject any trace that opens the gate without the graph safety predicates. A practical playtest target is a median first completion of 12 to 15 minutes without retries and a boss phase retry cost of no more than 60 seconds. Record actual times, device class, rendering path, caption setting, and route choice; revise pacing only from measured runs.
