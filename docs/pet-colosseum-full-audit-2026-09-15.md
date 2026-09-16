# Pet Colosseum model and gameplay audit — September 15, 2026

This audit began with the facing of Umbra Fox and Worldroot, and Raijin Hound's damaged face, then expanded to the complete Colosseum catalog and its battle lifecycle. The measurements below are fresh local runs against the working tree. They do not reuse the larger simulation counts from the September 9 audit. No live account, production storage, deployment, or paid transaction was used.

## Status and coverage

| Area | Completed coverage | What it establishes |
|---|---|---|
| Catalog structure | 160 identities resolving to 159 runtime model assets | Every current catalog identity has an audited model; shared assets are counted once. |
| Pose screening | 22,978 sampled poses checked for finite data, clip completeness, and bounds | A numerical screen, not a visual animation certificate. The initial local edge-stretch screen produced 9,680 warnings across 154 catalog identities; a warning is not itself a confirmed defect. |
| Catalog visual review | All 160 identities, four views each: front idle, side idle, front contact, side contact | 640 rendered views reviewed across 40 sheets. This catches facing and visible contact-pose problems but does not inspect every frame of every animation. |
| Gameplay and API | 261 passing tests across 27 files | Commands, combat rules, client reconciliation, authenticated session ownership, completion, settlement, and retry regressions in isolated storage. |
| Fresh complete simulations | 15,360 completed bouts | Every catalog template as lead, three formats, four levels, four opponent tiers, two seeds. |
| Controlled damage probes | 351,740 damaging observations | Opening, charged, and Guard-ordered signature probes, separately from complete bouts. |

All 30 additional face repairs have been visually approved and promoted. The combined model regression suite passes 72 tests; client and server type checks pass. The three confirmed foreleg defects below remain open. Final numerical pose advisories and derivative reproducibility results are recorded in the final integration section.

## Facing corrections

The resolver now compensates for the imported mesh's actual forward direction. Umbra Fox receives a −45° correction. Worldroot loses its stale 180° correction. Raijin Hound retains the established showdown orientation while its native face is repaired.

The full-roster review found additional corrections:

| Identity | Pet | Added yaw correction |
|---|---|---:|
| rare-42 | Thunder Jerboa | −22.5° |
| rare-43 | Static Meerkat | −45° |
| rare-46 | Stoneback Tapir | −45° |
| rare-48 | Terra Porcupine | −22.5° |
| rare-49 | Bramble Capybara | −45° |
| legendary-0 | Glacier Wolf | −45° |
| legendary-2 | Umbra Fox | −45° |
| legendary-5 | Azure Kirin | −22.5° |
| legendary-6 | Ember Phoenix | −22.5° |
| legendary-10 | Void Raven | +22.5° |
| legendary-12 | Frost Lynx | −45° |
| legendary-14 | Ancient Crane | −45° |
| mythic-3 | Solar Stag | +90° |
| starter-fire-r | Ember Wolf | −90° |
| starter-water-l | Abyssal Leviathan | −45° |
| starter-lightning-r | Bolt Fang | +45° |

These are source-model corrections added to any existing authored animation-bank offset. Candidate views were compared at alternative angles where necessary; for example, −45° overrotated Thunder Jerboa/Azure Kirin, while +22.5° centered Void Raven more accurately than +45°. Existing directional regression fixtures now resolve real model configurations rather than only checking isolated angle arithmetic.

## Raijin Hound face repair

Raijin Hound had two separate defects. The original face had no readable eyes or nose even in the bind pose. Its +X-facing muzzle also mixed pelvis and head weights because its rig and original weight envelope followed a different axis. Animation pulled neighboring face triangles apart.

The native source and showcase GLBs now preserve the original body surface, UVs, atlas, inverse binds, and animation bank, while rebinding the facial region cohesively to the head with a smooth neck transition. Nine semantic features restore both eye outlines, gold eyes, pupils, glints, and the nose. They are grouped into four added material primitives; all added vertices have full head influence and valid position, normal, UV, joint, and weight attributes. The original irregular mouth silhouette is retained.

The production renderer preserves those authored facial colors instead of applying the generic lightning-body tint. The repair is deterministic and cache-versioned. Its durable regression verifies source/showcase parity, feature attachment, and bounded original-muzzle deformation across all 13 clips. The source model, battle LOD, and impostor atlas were regenerated. The 29,808-triangle source reduces to 9,998 triangles, with approximately 98.89% minimum measured silhouette overlap.

The software impostor baker now resolves the material on each primitive. This preserves the textured body and untextured eye/nose colors in the same asset. A byte-for-byte check of an unchanged single-material model passed, and the initial targeted Hound atlas rebuild preserved all 158 other manifest entries.

Relevant implementation and regression files:

- `shinobij.client/scripts/repair-raijin-hound-face.mjs`
- `shinobij.client/scripts/raijin-hound-face.test.mjs`
- `shinobij.client/scripts/generate-warfront-pet-impostors.mjs`
- `shinobij.client/src/lib/pet-3d-roster.ts`
- `shinobij.client/src/lib/pet-3d-models.ts`
- `shinobij.client/src/lib/pet-combat-performance.test.ts`

## Full-roster facial animation repairs

The full visual sweep found 30 additional pets with eyes, headbands, beaks, or lower jaws split across head and wing/body influences. The repairs preserve original positions, normals, UVs, topology, materials, animation clips, and bind shape. They update weights inside each reviewed skull/jaw envelope and preserve the original weights outside it. The Wind starters use their rig's canonical coordinates to account for inherited scale; Dust Swift and Void Raven account for their different mesh headings.

Promoted identities:

- Standard: `standard-7`, `standard-10`, `standard-17`, `standard-35`, `standard-36`, `standard-37`, `standard-39`, `standard-44`.
- Rare: `rare-3`, `rare-7`, `rare-10`, `rare-17`, `rare-18`, `rare-27`, `rare-35`, `rare-36`, `rare-37`, `rare-38`, `rare-39`, `rare-44`.
- Legendary: `legendary-1`, `legendary-6`, `legendary-10`, `legendary-14`, `legendary-16`, `legendary-21`.
- Mythic: `mythic-5`.
- Starters: `starter-wind`, `starter-wind-r`, `starter-wind-l`.

These 30 identities occupy 31 edited source files because Ashen Crow has both an original roster source and a runtime showcase copy. The production bytes match every visually approved candidate exactly; hashes are recorded in [reviewed-candidate-parity.json](../output/pet-colosseum-model-audit-20260915/reviewed-candidate-parity.json).

Each repaired candidate was inspected in front/side idle and contact views, with repeated review of incomplete jaw coverage. Independent geometry-hashed beak-surface fixtures now include the outer tips that the first envelope-based checks missed. Those fixtures failed on the incomplete candidates and pass after the final repair. The final face suite passes all 30 bird/bat checks and both Raijin checks across all 13 authored clips at keyframes and midpoints. The persistent implementation is `shinobij.client/scripts/repair-bird-faces.mjs`, with regression coverage in `scripts/bird-faces.test.mjs` and `scripts/fixtures/bird-beak-vertices.json` (1,859 independently selected beak vertices).

Per-identity cache revisions refresh source models and fallback images; LOD URLs also incorporate the source hash. Low-detail model and atlas generation supports a bounded comma-separated identity list, rejects unknown IDs, and preserves unselected manifest records. Atlas writes skip identical content and stage complete files before replacement, following observed Windows write failures during this audit.

## Confirmed command-retry bug and fix

A new regression reproduced a duplicate-turn bug: after orders for displayed round 0 resolved on the server, retrying those same orders advanced combat to round 2. The existing session lock serialized requests but did not identify the round those orders belonged to.

The live client now sends `expectedRound`. Under the session lock, the API compares that marker to the authoritative current round. A stale or future marker returns the current state with no events and does not resolve another round or renew the combat lease. Malformed markers return HTTP 400. Terminal settlement recovery remains available. A lost response therefore refreshes the client state without replaying the missing round's animation.

All shared Showdown battle hosts forward the displayed round: Colosseum, First Pact, World Crisis, Dungeon, and Hollow Gate. Their mode-specific battle rules were not changed. Older clients that omit the marker retain legacy behavior until refreshed; this is deliberate compatibility, not a claim that old callers gain duplicate-turn protection.

Eleven added regressions cover authenticated owned teams and reserves in all formats, forged opponent/reward data, foreign-session isolation, invalid or busy rosters, exactly-once paid settlement, unpaid practice/forfeit, the daily paid-entry cap, sequential/concurrent retries, malformed/future round markers, client HTTP 503 retry retaining round 0, and terminal/expired recovery. The combined 27-file suite passed all 261 tests with no failures, skips, or cancellations.

## Fresh gameplay simulations

The three complete-bout runs each completed 5,120 battles: all 160 catalog templates as leads at levels 1, 25, 50, and 100; Scrapper, Warrior, Champion, and Sparring; and two seeds. Solo used no reserves. Both team formats used two reserves. All 15,360 bouts reached a verdict within the engine cap. The sampled level-1/25 training openers had zero player or AI one-shots.

| Controlled probe | Levels | Damaging observations | Low-level result |
|---|---|---:|---|
| Every same-rarity opening attacker/defender pair | 1, 25, 50, 100 | 140,000 | Zero one-shots at 1/25; maximum 86.4% / 85.3% of full HP |
| Ready damaging techniques/signatures | 1, 25, 100 | 166,740 | Zero one-shots at 1/25; maximum 89.4% / 89.1% |
| Signatures against a target ordered to Guard | 1, 25, 100 | 45,000 | Zero one-shots at all sampled levels |

The Guard probe preserves turn priority: a faster attacker can act before Guard. Higher-level ordinary techniques produced some one-shots under the existing progression rules. This audit did not alter balance.

The full test inventory, commands, runtime, results, and simulation JSON are in [the logic audit evidence](../output/pet-colosseum-logic-audit-20260915/README.md), with [the compact summary](../output/pet-colosseum-logic-audit-20260915/summary.json). The run used Node 24.15.0; the repository pins Node 22.

## Evidence and limitations

The local catalog manifest and render record are `shinobij.client/.tmp/colosseum-full-audit/catalog.json` and `renders.json`. The 40 sheets and per-pet source PNGs are in that directory's `sheets/` and `pets/` folders. Candidate facing comparisons are in `yaw/`, `yaw-half/`, and `custom/`; skull-repair comparisons are in `bird/`. Initial structural and pose screening records are `shinobij.client/.tmp/pet-model-certification/structural-audit.json` and `shinobij.client/.tmp/pet-animation-audit/all-pet-motion-audit.json`. These `.tmp` artifacts are local review evidence, not guaranteed release files. Raijin before/after and production-renderer captures are in `shinobij.client/.tmp/model-facing-qa/`.

The representative browser audit mounts the production `PetShowdownBattle` component in a local harness with scripted turns and engine-generated event fixtures. It passed 18 rendering cases covering all three formats, low/medium/high graphics, and 1440×900/390×844 viewports. It also exercised touch selection of the third opponent, target/Guard/Rest completion, reduced motion, landscape controls, desktop drafting/undo/switch/targeting, forfeit Escape/Keep fighting, quality switching, concede/reentry, signature/KO/victory presentation, and practice labeling. Three active-playback unmount/remount cycles released the counted WebGL contexts, handles, timers, animation frames, and intervals. Spectator failures pause with retry, and an empty-event response carrying an advanced nonterminal state restores the command menu at the new round.

The maintained VFX checker passed all six cases, covering five body profiles and elements, four rarity bands, three graphics presets, physical and special signatures, seven GLB identities, and ten separately verified fallback sprites. It validates the engine signature name, element, delivery, landed-target presentation, contact timing, arena image change, and suppression of overlapping generic set pieces. Solar Stag, Ember Wolf, Abyssal Leviathan, and Bolt Fang also passed a production 2v2 facing smoke check with the opposing teams swapped; all four faced the opposing formation with correct load paths and no runtime errors. Those are idle formation checks, not an animation certificate. The browser agent's final client TypeScript compile, ESLint, and checker syntax checks passed.

Browser evidence and the precise limitations are recorded in `shinobij.client/.tmp/colosseum-browser-audit/README.md`, `matrix-report.json`, `mobile-report.json`, `flows-report.json`, `terminal-lifecycle-report.json`, `duplicate-round-recovery.json`, `vfx-six-report.json`, and `facing-new-report.json`. No live matchmaking, persistence, or reward settlement was exercised by the browser harness. Reentry/rematch/leave callbacks reload the renderer and do not certify production lobby routing. The replay host wrapper was not independently mounted, and mobile checks used Chromium emulation rather than physical devices.

Catalog coverage and representative browser coverage are different claims. The catalog contact sheets cover every identity at two sampled poses and two viewpoints. Browser battle checks exercise selected matchups, controls, quality settings, and playback paths; they do not certify all possible visual combinations or every animation frame. The numerical local-stretch flags require interpretation because jointed limbs and authored deformation can legitimately stretch edges.

Two simulation seeds and selected companion teams do not exhaust all team, gear, trait, level, and move-order combinations or establish statistical win-rate balance. API tests use isolated in-memory storage and synthetic identities. Paid terminal tests seed authoritative terminal sessions to isolate settlement; full combat completion is exercised separately in simulations. This does not certify production database behavior, distributed lock timing, real network-loss recovery, or live account behavior.

## Remaining model-animation findings

The expanded review confirmed a separate foreleg problem in **Frost Cub (`standard-21`), Coral Serval (`rare-32`), and Storm Lion (`legendary-8`)**. In the sampled contact pose, a solid idle foreleg flattens into a broad triangular sheet or thin hanging strip. These are independent limb-binding defects; the head-only repairs do not address them. They remain open. Preserved evidence: [Frost Cub](../output/pet-colosseum-model-audit-20260915/remaining-limbs/standard-21.png), [Coral Serval](../output/pet-colosseum-model-audit-20260915/remaining-limbs/rare-32.png), and [Storm Lion](../output/pet-colosseum-model-audit-20260915/remaining-limbs/legendary-8.png).

Mist Lynx (`rare-12`, sheet 16) has sharply folded, somewhat flattened contact forelegs, but its front view retains recognizable paws. This is a suspected issue needing motion review, not a confirmed tear from these still images. Other numerical limb/feather stretch flags also remain untriaged. This audit therefore does not certify every animation as visually clean.

## Final integration results

- **Source and runtime models:** 30 additional facial repairs across 31 source GLBs, all visually approved and byte-identical to the reviewed candidates. Thirty per-identity revisions invalidate prior model caches. The original Raijin repair remains validated.
- **Derived assets:** all 30 selected LODs pass the existing triangle, bounds, and silhouette gates. All 30 atlases reproduce byte-for-byte (2,159,066 bytes total). Each full 159-entry manifest retains its 129 unselected entries exactly. All 159 source hashes and 318 derivative hashes match. See [derivative verification](../output/pet-colosseum-model-audit-20260915/derivative-manifest-verification.json), [LOD check](../output/pet-colosseum-model-audit-20260915/lod-check30.log), and [atlas check](../output/pet-colosseum-model-audit-20260915/impostor-check30.log).
- **Structural audit:** all 160 identities / 159 assets pass decoded positions, normals, UVs, topology, joints, weights, inverse binds, keyframes, and required clip checks. No hard failures, duplicate-anatomy flags, or missing-tail-weight findings. See [structural JSON](../output/pet-colosseum-model-audit-20260915/structural-audit.json).
- **Full-pose screen:** all 22,978 sampled poses have valid finite data and acceptable coarse bounds. Residual local-stretch advisories affect 9,545 pose samples across 154 identities, down from 9,680. No repaired pet's advisory count increased; unrepaired counts are unchanged. The scanner intentionally returns exit 1 for these advisories, so this is **not a clean full-animation quality certification**. See [numerical summary](../output/pet-colosseum-model-audit-20260915/numerical-audit-summary.json). The confirmed and suspected limb findings above remain open.
- **Model regressions:** `node --import tsx --test` across the model resolver, roster, combat performance, impostor/LOD selection, animation assets, Raijin repair, and bird repair suites passes **72/72**. The separate **32/32** face-only run is a subset of those checks. See [final test log](../output/pet-colosseum-model-audit-20260915/model-tests-final.log).
- **Gameplay regressions:** **261/261** tests across 27 files pass, alongside the fresh simulations described above. No engine balance or economy rules were changed.
- **Browser:** all 18 rendering/layout cases, touch and command flows, retry recovery, terminal presentation, cleanup, six maintained VFX cases, and both-side facing checks pass. Preserved browser reports are in [the browser evidence folder](../output/pet-colosseum-model-audit-20260915/browser/README.md). These retain the representative/local-harness limitations already stated.
- **Build and code checks:** client `tsc -p tsconfig.app.json --noEmit` and server `tsc -p tsconfig.cpanel.json --noEmit` pass. The focused production Vite QA build passes. Scoped ESLint, Node syntax checks, and diff whitespace checks pass. The full application release/deployment pipeline was not run.

At completion of the September 15 audit, changes were local and had not been deployed. The evidence paths above refer to the retained local audit workspace.

## Main release integration � September 16, 2026

Prepared against live main `175dbd6b4`, preserving its WebGL fallback and newer game changes. Clean-checkout validation with main's locked dependencies passes 72 model tests, 261 gameplay tests, the full production build and size gates, client lint (zero errors; existing warnings), and 90 local release-certification checks. The runtime audit helper is included so all-model certification is reproducible from a clean checkout.

The derivative consistency check also found Crystal Bear's previously published atlas still referenced its old LOD. Its atlas was regenerated from the repaired LOD already on main. All 159 atlases were regenerated deterministically; the 127 outside this release's 31 repaired pets and Crystal Bear remain unchanged. All 636 source/LOD/atlas hash references now match.

The foreleg findings and audit limits above remain open. Production rollout is verified separately using CI, post-deploy health, and public asset checks; local release certification uses synthetic data and never runs against production.
