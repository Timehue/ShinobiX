# Pet model and animation quality audit — October 12, 2026

All 161 production pet identities resolve to working textured, skinned models with their full 13-clip banks. The roster uses 160 distinct runtime assets, including the existing Stone Turtle replacement for Pebble Tortoise.

## Repairs

Continuous skin bindings replace abrupt anatomical weight boundaries in 155 runtime GLBs. The mesh positions, topology, UVs, textures, skeletons, and species animation performances are preserved. Skull-bound facial details retain their rigid head binding. Local corrections address the remaining stretched edges after weight packing.

The requested double-check exposed edges missed by the original spatial sampling and a defect in the repair helper: feathered neighbors could receive different weights across UV copies. The corrected helper synchronizes connected seam copies, preserves rigid head details, and fades the weakest influence smoothly at four-bone palette boundaries. Measured persistent creases receive bounded neighborhood diffusion. Further refinements updated 106 source assets and 92 battle LODs, with fresh cache revisions and atlas certificates.

Animation transitions now preserve the currently displayed blend during interruption and reversal, maintain full combined weight, and retire completed outgoing takes. Guard plays once and holds its planted pose. Walk/gallop selection uses separate acceleration and deceleration thresholds, and secondary body settling follows an exponential response at different frame rates. Rally uses the same transition lifecycle, holds completed takes, and turns toward its finish heading through the shortest arc.

All 160 battle LODs were rebuilt; 25 needed additional local seam repairs after simplification. All 160 animated Warfront atlases were regenerated. Source, LOD, and atlas cache revisions and integrity manifests match the repaired assets.

## Verification

| Check | Result |
| --- | --- |
| Production model structure, materials, and bindings | 161/161 pass |
| Source animation poses | 23,127 evaluated against final public assets; all vertices, triangle edges, and connected UV seams; zero failures or warnings |
| Battle LOD animation poses | 23,127 evaluated against final public assets; all vertices, triangle edges, and connected UV seams; zero failures or warnings |
| Original source deformation warnings | 9,524 samples across 154 identities |
| Browser model gallery | 161 textured identities; zero runtime errors |
| Targeted renderer, asset, animation, and lifecycle tests | 151 pass |
| Geometry and rigid facial binding comparison | Original positions, normals, UVs, and topology preserved; all 170,149 originally rigid head vertices remain rigid |
| Delivery compaction semantic tests | Both pass, including all 320 selected GLBs |
| Colosseum | Five body profiles, all graphics presets, elemental attacks and signatures pass |
| Gauntlet | Delayed loading, ten-pet mobile formation, missing-model fallback, stalled loading, and repeated cleanup pass |
| Rally | All 161 model adapters pass; graphics-loss recovery, renderer recreation, missing-model fallback, and finish presentation pass |
| Warfront | Three sequential reloads reach combat with eight of eight actors ready; zero failures |
| Production builds | Client and server pass |
| Shipping integrity and size checks | Exact 480 selected pet assets verified; client and code budgets pass |

These mode checks use the production renderers in local QA games, including isolated memory-only API fixtures for Rally. Frozen contact, repeated dodges, defeat, victory, and remount behavior are covered by browser captures and the lifecycle regressions.

The final deformation checks evaluate authored keyframes and their midpoints. They cover every vertex, triangle edges above numerical degeneracy tolerance, and coincident UV copies connected along a geometric edge. This is an expanded regression gate, not a certification of every possible continuous-time pose or AAA art direction. The standard `qa:pet-animations` command now enables this coverage.

## Package size

Removing obsolete source streams recovered 10,677,988 bytes across 253 GLBs. Hash comparisons prove that every live mesh, skin, texture, and animation payload remains identical through this compaction. The shipping builder already performs its own equivalent compaction.

The double-check removed another 83,353,132 obsolete bytes left by candidate refinements, preserving every live payload. Versioned backups record the exact inputs to each compaction pass.

The final client artifact after the card lifecycle follow-up measures 536.0 MiB. Its artwork ceiling remains 539 MiB, allowing about 3.0 MiB of headroom for the verified skinning repairs while retaining full UNORM8 weight precision. The exact asset inventory, SHA-256 checks, authoring exclusions, and independent JavaScript/CSS budgets remain enforced.

## Player Beast Seal lifecycle follow-up

The player's 3D pet entries and withdrawals now share the Colosseum's physical Beast Seal card. The shared controller handles opening summons, held knockout poses followed by recall, respawns, interrupted summons, playback pause and rewind, and reduced motion. Colosseum switches retain their authoritative outgoing/incoming sequence. Gauntlet, the arena renderers, both Warfront graphics routes, Rally, companion selection, and evolution use the same lifecycle. A skill cut-in is a camera view of an already summoned fighter and does not summon a second copy.

Warfront holds its combat clock until the player cards have finished releasing their pets. Rally retains the player model for recall before returning to the race desk and preserves checkpoint saving and renderer recovery. Companion swaps keep each loaded outgoing model until recall ends; cancelled downloads never block the next pet. Its compact camera pulls back to keep the paper above the pet visible, then eases back to the portrait. Evolution retains its authored spin, white-out and final colour reveal around the card handoff.

Verification for this follow-up:

- 53 focused animation, card lifecycle, Warfront presentation and import-boundary regressions pass.
- Desktop, mobile and reduced-motion browser runs pass five summon/recall cycles each, paused recall, held KO, delayed GLB loading, rapid swaps and finite effect geometry cleanup under React StrictMode.
- Evolution recall, release and settled screenshots were inspected; companion card framing and complete swaps were inspected on desktop and mobile.
- Gauntlet cold loading, missing/stalled model recovery, repeated cleanup and the warmed ten-pet mobile formation pass.
- Warfront passes two fresh reloads with eight combatants ready and combat reached after the opening summons.
- Rally finish, saved return with recall, context loss, paused 3D restoration, model failure and renderer allocation recovery pass.
- The production client build and shipping inventory/size checks pass. Final camera and swap code receive an additional targeted TypeScript check.

Evidence: `.tmp/pet-card-qa/`, `.tmp/pet-card-final-unit.log`, `.tmp/pet-card-production-build.log`, `.tmp/pet-card-final-bundle.log`, `.tmp/pet-card-dist-verification.log`, `.tmp/pet-card-build-size.log`, `.tmp/pet-card-final-camera-typecheck.log`, `.tmp/pet-card-rally-finish.log`, `.tmp/pet-card-rally-integration.log`, and `shinobij.client/.tmp/pet-card-warfront.log`. The reusable browser check is `shinobij.client/scripts/verify-pet-card-lifecycle.mjs`, served by `petvfx.html?cards=1`. Review screenshots are retained as `card-recall-mobile.png` and `card-evolution-release.png` in the screenshot directory.

## Summon / desummon integration double-check

The follow-up trace found genuine departure gaps: result, replay and scene-exit callbacks could unmount living player pets before their recall; Wild Binding's capture result and Rally's finish board sit outside their battle/race renderers; Hollow Gate settlement can also close its child fight. Gauntlet's missing-model standees had no card lifecycle. These routes now share a mounted-pet recall coordinator. It waits for visible player pets, freezes combat presentation, and only then invokes the departure callback. Hidden bench pets and unloaded/retired renderers do not block departure. Nested parent/child gates share their completion without awaiting themselves, and failed requests release the gate so the pet can return.

| Surface | Player presentation | Departure routes traced and connected |
| --- | --- | --- |
| Showdown / Colosseum | GLB and illustrated fallback; opening, existing switch seal, KO recall | Exit, rematch and forfeit, including shared callers in First Pact, Dungeon, World Crisis, and Tactics |
| Wild Binding | Same Showdown actor registry | Battle departures and the external capture-result `onResolved` callback |
| Hollow Gate | Same Showdown actor registry | Concession, retry/Exit, and automatic `onSettled` handoff |
| Gauntlet | GLBs and fallback standees; all player entrances complete before combat | Continue from idle results; missing/stalled rendering recovery |
| Warfront | Skinned GLBs, WebGL impostors and default Canvas2D | Automatic clash-to-interlude recall, final verdict, spectator Skip to result, Leave |
| Rally | Player GLB; original checkpoint/save semantics retained | Explicit saved return, error return, finish-board Return to desk and Next race |
| Evolution | Old pet recall and evolved-pet release | Continue, completed-scene click and Escape through `onClose` |
| Legacy duel / frame battle / arena | Player-side 3D and standee actors | Exit, fight-again, connection-lost departure, external and internal replay controls |
| Companion portrait | Retained outgoing/incoming models | Identity swaps finish recall before release; compact camera keeps the card visible |

Raw model certification previews and skill cut-in camera projections remain inspection/projection views. They do not create another gameplay pet.

The final controller uses React state for render phases and stable initial transforms; the frame driver owns continuous Three.js transforms. A scene exit can finish a card from paused or demand rendering, and leaving during a KO hold starts a full recall rather than consuming its flight time. A delayed incoming model that commits during departure joins that same recall gate. Card meshes retire after completion. Recall participants unregister and release pending waits during renderer teardown.

Verification covers 52 targeted state, animation, Warfront presentation and import/LOD-boundary tests; lint of the coordinator/controller and affected external owners; a full client type-check plus a final targeted type-check; and browser runs on desktop, mobile and reduced motion. Browser checks include paused demand exits, duplicate exit presses, failed-exit recovery, repeated mounts, 15 summon/recall cycles, KO hold, delayed/rapid swaps, an actual GLB committing during scene recall, companion/evolution framing, real-model and fallback Gauntlet Continue, Warfront automatic and skipped verdicts, and Rally's idle finish-board recall with renderer release. All verified battle verdicts and saved results remain unchanged.

Current evidence: `.tmp/pet-scene-recall-unit.log`, `.tmp/pet-card-coverage-lint.log`, `.tmp/pet-scene-recall-typecheck.log`, `.tmp/pet-card-coverage-final-typecheck.log`, `.tmp/pet-scene-recall-qa/`, `.tmp/pet-card-coverage-lifecycle-browser.log`, `.tmp/pet-gauntlet-loading-qa/`, `.tmp/warfront-card-departure-qa/`, and `.tmp/rally-finish-qa/`. Repeatable browser scripts are `verify-pet-scene-recall.mjs`, `verify-pet-card-lifecycle.mjs`, `pet-gauntlet-loading-qa.mjs`, `verify-warfront-card-departures.mjs`, and `sunscar-rally-finish-qa.mjs` under `shinobij.client/scripts/`.

The full production build passes; the final controller changes also pass a fresh Vite production rebuild, runtime minification, legal-page prerender, final targeted TypeScript check and shipping inventory/size checks. Evidence is `.tmp/pet-card-coverage-production-build.log`, `.tmp/pet-card-coverage-final-bundle.log`, `.tmp/pet-card-coverage-dist.log`, and `.tmp/pet-card-coverage-size.log`. Reviewed recall frames are retained in `docs/screenshots/pet-quality-2026-10-12/` as `card-scene-exit-mobile.png`, `card-gauntlet-fallback-recall.png`, `card-warfront-skip-recall.png`, and `card-rally-finish-board-recall.png`.

## Further art polish

The existing generated anatomy and species rigs limit further AAA polish. Deliberate retopology, more precise anatomical joint placement, facial animation, and bespoke locomotion would improve close-up performances further. Tempest Roc (`starter-wind-l`) retains its established illustrated fallback for large portraits because its GLB still falls below that portrait identity bar.

## Evidence and repeat checks

- Browser screenshots: `docs/screenshots/pet-quality-2026-10-12/`.
- Full source and LOD pose reports: `shinobij.client/.tmp/pet-animation-audit/`.
- Final gallery contact sheets: `shinobij.client/.tmp/pet-quality-review/double-check-final/`.
- Baseline and repaired motion captures: `.tmp/pet-motion-evidence/`.
- Original source backups and promotion receipts: `shinobij.client/.tmp/pet-quality-originals/`.
- Compaction proofs: `shinobij.client/.tmp/pet-stream-originals/receipt.json`.

Run `npm run qa:pet-models` and `npm run qa:pet-animations` from `shinobij.client` for the source checks. Audit battle meshes with `node ../node_modules/tsx/dist/cli.mjs scripts/audit-all-pet-animation-poses.mjs --full-geometry --asset-root=public/pet-models/warfront-lod --label=lod`. After rebaking LODs, repeat the full pose audit, repair any measured seams before `--certify-existing`, and regenerate the matching impostor atlases. Run `node scripts/verify-dist.mjs` and `node scripts/check-build-size.mjs` from the repository root against the final build.
