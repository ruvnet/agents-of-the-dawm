# ADR 0001: Original scope, rights, and release boundary

Status: Proposed  
Date: 2026-09-24  
Owners: Creative lead and project maintainer  
Related: [script](../creative/vertical-slice-script.md), [delivery plan](../plan/sparc-delivery-plan.md)

## Context

The requested game draws on the gravity traversal and melee spectacle of [CONTROL Resonant](https://store.steampowered.com/app/3669870/CONTROL_Resonant/) and the browser world engineering of [Tidewater](https://github.com/dgreenheck/tidewater). Remedy describes large authored zones rather than a seamless open world. Tidewater is a fishing game with a custom WebGPU renderer, not a gravity action engine. The target repository was empty when this proposal began and has no license, code, assets, or prior product commitments.

Ideas and rules for playing can inform a new game. The visual art, characters, dialogue, music, world, branding, and distinctive presentation of either reference must be independently created. [The US Copyright Office distinguishes gameplay ideas from expressive material](https://www.copyright.gov/register/tx-games.html). Tidewater source is MIT licensed, while its assets retain the separate licenses listed in its [credits](https://github.com/dgreenheck/tidewater/blob/main/CREDITS.md). This ADR records a product and provenance boundary, not a claim of clearance for every future asset.

## Decision

Build **Agents of the Dawm: Floodline**, a 12 to 15 minute, single player, third person browser slice in one invented coastal floodworks district. DAWM is an authored municipal water control network. Field agent Tala Venn locates an intact but omitted relief channel, verifies an occupancy sensor, restores the missing approved route, and personally authorizes a pressure transfer to free a tram carrying four people. Gravity rotates only at marked industrial anchors. Maintenance machines are obstacles rather than possessed people. The [script](../creative/vertical-slice-script.md) is the narrative authority.

The first view of the Site is the game or a game native start state with an immediate play action. The slice includes one traversal tutorial, one gantry puzzle, two route variants that reconverge, two regular machine types, a three phase keeper encounter, and a graph based final authorization. There are no account, payment, multiplayer, procedural story, user generated content, real sensor, external model, or live location requirements in the slice.

The initial Sites deployment is private. A public release is a later explicit product decision after rights review, performance evidence, and playtesting. Local saves may use native IndexedDB with a versioned schema and a reset option; no server or analytics are required to play.

## Nonnegotiable invariants

1. Every character, institution, location, line of dialogue, UI mark, music cue, model, and texture in the shipped game is original or has a documented license and provenance. Do not use CONTROL names, FBC imagery, Manhattan, Hiss, the Aberrant, or Remedy media.
2. The relief channel is the single missing approved pressure route that causes the gate lock. The player inspects physical and in-world sensor evidence before restoring that route in the game's pressure graph. `gateOpen` requires `channelLocated && channelSensorVerified && channelEdgeRestored && playerAuthorized && capacitySafe`. WorldGraph records a semantic projection and provenance; its current edge schema has no pressure route relation.
3. An adverse choice is legible before authorization. The occupied street and overloaded pump are shown as unsafe; the empty relief channel is the verified safe option. No hidden irreversible failure prevents completion.
4. Assist settings change reaction demands without changing the story evidence or safety predicate. Human authorization remains an explicit input.
5. Gameplay data is synthetic. Game narration cannot imply the browser measured real people or infrastructure.

## Alternatives considered

| Option | Benefit | Cost and risk | Decision |
| --- | --- | --- | --- |
| Recreate CONTROL Resonant scenes or branding | Immediate recognition | Protected expression, misleading affiliation, native game scale | Reject |
| Reskin all of Tidewater | Existing detailed world | Fishing, ocean, first person movement, and WebGPU assumptions do not supply this game loop | Reject |
| Original compact rescue slice | Clear causal story, testable scope, independent identity | New animation, combat, and gravity engineering | Select |

## Release criteria and evidence

| ID | Requirement | Planned evidence |
| --- | --- | --- |
| P01 | One 12 to 15 minute completeable district | Unfamiliar player finishes scripted route and final authorization without developer intervention |
| P02 | Original rights provenance | Asset register with author, license, source, modification, and attribution; zero unknown entries |
| P03 | Map repair drives rescue | Automated test rejects opening until all four flags and capacity predicate hold; browser playthrough shows the cause |
| P04 | Accessible alternate input | Keyboard, gamepad, and touch path plus remap, captions, reduced motion, and aim assist checks |
| P05 | Local privacy | Network inspection shows no gameplay telemetry or sensor uploads in the initial slice |
| P06 | First public release has reviewed fr-CA interface and captions | Human review of localized terms and full playthrough at 200 percent text size; English voice remains available |

## Consequences and rollback

The game earns its visual identity through ceramic seawalls, oxidized mesh, storm spray, and amber operational marks. It needs original characters, rigs, voices, and sound. A creative review can change names or dialogue without changing physics contracts. If public rights review fails, keep the Site private and replace the specific asset or expression; do not route around the review by obscuring its provenance.
