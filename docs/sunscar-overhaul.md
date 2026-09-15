# Sunscar Festival — implementation and validation

Local implementation, September 2026. The festival now presents Pet Rally, Caravan Run and the existing Broker. The existing player Exchange remains available. Chronicle Showdown, the Card Shop and their shared systems are preserved. No deployment or commit was performed.

## 1. Pet Rally

A playable, forward-moving 3D race with smooth lane steering, timed jumps, held Burst, terrain penalties, obstacles, gates, ramps and risk/reward shortcuts. Keyboard controls are A/D or arrows, Space, Shift and E; touch exposes the same five actions. A small HUD shows place, progress, stamina, technique and time. Countdown, pause, checkpoint recovery, race standings and the final championship receipt are integrated.

The player's owned pet is selected by its unique instance ID and resolved against the canonical catalog. Five deterministic species archetypes redistribute a normalized 300-point budget across speed, acceleration, agility, endurance and stability. Rarity, trained combat stats and equipment confer no race advantage. Explicit species overrides support future balancing.

Fire's Heat Burst, Lightning's Flash Step, Wind's Tailwind, Earth's Iron Charge and Water's Flow State each have one major use per race. Eight named rivals have fixed pets, colors, racing personalities and introduction/finish dialogue. Their seeded AI steers, jumps, bursts and takes shortcuts under the same simulation rules, with imperfect decisions and configurable difficulty.

Unlimited practice offers all four courses without rewards or daily consumption. The daily Grand Prix uses three distinct server-selected courses and the same three rivals, locks the selected pet after starting, awards 10/7/5/3 points and breaks ties by combined time. Six prestige ranks, official best times, harder rival tiers, cosmetic race effects and existing-framework titles provide progression without combat bonuses. The latest finish board remains viewable after reload.

## 2. Caravan Run

Ten contracts include ordinary merchant deliveries, medical relief, fragile goods, a noble household and two three-part story chains: Missing Shipment and the Black Ledger. Each daily board offers three contracts, always including an accessible standard delivery. Reputation gates harder work; completed chain stages unlock subsequent chapters.

Preparation selects three employer-provided packs and an optional owned companion. Runs contain 9–11 legs on a seeded branching map with connected roads, scouting fog, inspectable stops, pan/zoom controls and four illustrated regions. Cargo, supplies, morale, actual health/chakra/stamina, weather, tools, discoveries, crew decisions and employer objectives change the outcome. Choices state their costs and consequences before committing. Earlier decisions can unlock later encounters.

The journey supports camps, hazards, merchants, travelers, ruins, treasure, combat, rare discoveries, a readable journal, retirement, saved delivery receipts and resuming an unfinished route. Battles use the existing solo-PvE service and unchanged `MissionArenaFight` UI. Real character condition, equipped jutsus/items and normal companion summon rules apply. Damage, healing, item expenditure, pet costs and defeat/hospital outcomes persist through the normal settlement path. Defeat ends the delivery with zero Ryo; victory opens the next road.

## 3. Models, rigs and animation

Reused all 160 supported model configurations: 145 roster pets plus 15 starter/evolution configurations, with the existing certified Warfront LODs and texture atlases. The supplied GLBs already contain genuine skinning and authored bone animation for quadruped, biped, avian, heavy and serpentine morphologies; no replacement rig or static-mesh running approximation was needed.

The new Rally adapter clones skeletons and animation clips, strips whole-skeleton root translation while preserving local joint motion, fits different body proportions and crossfades gameplay-driven ready/start/run/sprint/jump/airborne/land/stagger/technique/victory/defeat states. Existing guard, gallop, gallop-jump, hit reaction, victory and rest clips provide morphology-appropriate equivalents. Technique locomotion continues while element effects communicate activation. Finish positions separate all four pets, face them toward the viewer and widen the camera for phone aspect ratios. Mixers, cloned materials and skeletons are disposed when unloaded; immutable source assets remain cached.

## 4. Four courses

| Course | Length | Play and setting |
| --- | ---: | --- |
| Sunscar Grand Circuit | 1,020 m | Balanced market, dune and ramp sections; pavilions, flags and a grandstand finish |
| Scorpion's Spine | 930 m | Narrow canyon lanes, hazards and precision shortcuts |
| Burning Dunes | 1,180 m | Open sprint sections, deep-sand penalties and Burst management |
| Caravan Clash | 960 m | Merchant carts, barrels, stalls, narrow passages and frequent obstacles |

Track data owns path/elevation, sections, terrain, hazards, gates, ramps and shortcuts. Instanced props, warm lighting, dust trails, element effects, conservative chase-camera motion and existing game audio establish the festival setting. Terrain shoulders were corrected during visual QA so dunes do not swallow the drivable road.

## 5. Encounter inventory

All 48 encounters are authored in `shared/sunscar/caravan-events.ts` with specific choices, costs, outcomes and optional continuation flags.

| Category | Encounters |
| --- | --- |
| Travelers (8) | A wheel in the sand; The stamped crate; The wrong landmark; A message still sealed; The Black Caravan; A shinobi without a shadow; Home sewn on a sleeve; A drum without a strap |
| Events (9) | An empty driver's seat; The red binding; An unfamiliar patrol; The inspection rope; A marker facing east; Something inside the crate; A dark line behind the wagon; The bridge keeper; The road he remembered |
| Merchants (5) | Nera remembers; A scale with two pans; The traveling wheelwright; A price for silence; The last cool jar |
| Hazards (5) | A field of glass; The white hour; The moving wall; Water in the dry channel; Stone under the wheels |
| Camps (4) | The well behind the wall; Coals beneath the ash; Above the sand; Two drivers, one fire |
| Ruins (5) | Below the old cistern; The listening stones; The last watch ledger; A bell under the dunes; The buried shrine |
| Pet encounters (3) | A fox beside the road; The road is a nest; Tracks that shine at dusk |
| Treasure (2) | A box beneath the cairn; Coins in the wash |
| Combat (2) | A toll paid in steel; Movement on the ridge |
| Bosses (3) | The Dune Raider Captain; The Sand Wyrm; The Scorpion Queen |
| Elites (2) | A better-paid escort; The seal at the arch |

## 6. Bosses and rare content

Five major opponents are Dune Raider Captain, Sand Wyrm, Scorpion Queen, Rogue Shinobi Escort and Buried Shrine Sentinel. They reuse existing authoritative AI kits and level curves with Sunscar encounter identities; dangerous contracts can guarantee an appropriate final opponent. The Queen has a new portrait and transparent full-body combat illustration, supplied through the existing image override contract.

Four low-weight rare events introduce the luminous pet trail, buried shrine, Black Caravan and lost shinobi. The trail uses the actual wild-encounter chance, daily 150-attempt limit, capture flow, traits and capacity rules. The server verifies the active run and discovery proof. A player may leave an unapproached trail, including when the daily cap blocks it; an existing encounter must be recovered and resolved normally. No guaranteed rare pet or duplicate capture is created.

## 7. Persistence and migrations

No SQL migration or new database table is required. `sunscarRally` and `sunscarCaravan` live in the existing Supabase KV player save and are declared server-owned in both ownership manifests. Generic client saves cannot forge, erase or rewind these domains. Versioned exact compare-and-set mutations atomically save progression with each currency reward and receipt. Existing stored legacy JSON properties can remain inert; there were no dedicated obsolete tables to drop. Historical migrations were preserved.

## 8. APIs, authority and recovery

- `/festival/rally` and `/api/festival/rally`: read progress, practice, prepare, begin and input checkpoints.
- `/festival/caravan` and `/api/festival/caravan`: read/recover, depart, travel, choose, retire, combat, combat-result, pet-return and pet-skip.
- Existing solo-PvE and wild-pet APIs handle the actual battles and captures. New routes are registered in the standalone server as well as the serverless API layout.

Both domains require token-bound player authentication, ownership checks and rate limits. Rally runs at deterministic 60 Hz; the server replays bounded input packets, verifies official elapsed time and computes all placements/rewards. The client cannot submit a winner or reward. Checkpoints save about every five seconds, pause after ten seconds of unacknowledged progress, retry safely and rebase onto accepted authoritative state. Preparing/loading consumes no daily race entry; an accepted start remains resumable.

Caravan persists its generated map and resolved choices. Version checks plus stable request IDs/fingerprints prevent repeated choice effects and save-scumming. Battle session IDs bind to the exact expedition/node. Existing physical-combat receipts and a separate expedition completion receipt safely recover a crash between their writes. Assigned pets cannot be released, transferred, bred, trained or dispatched out from under an active festival assignment. Both mode desks refresh daily eligibility at the next server-derived UTC reset.

## 9. Economy

Rewards use the actual daily-login function: `min(8000, 500 + 100 × level)`, rather than invented standalone amounts. The three-race Grand Prix pays 30–50% of that amount according to final place, once. Practice pays nothing. Caravan base pay is 1.05–1.70 times login value, scaled by delivered cargo and bounded discovered bonuses, with a 10% completed-objective bonus. Failed delivery pays zero Ryo. Paid merchant choices subtract actual currency, and combat uses real inventory costs.

Progression pays cosmetic reputation and ten server-credited titles through the existing title registry. It adds no combat-stat or shard faucet. The Broker remains 75,000 Ryo per pull with its existing daily cap of ten. Generated economy documentation was updated to describe the two real new faucets and remove the obsolete dice sink.

## 10. Tests and evidence

- Full repository suite: **10,433 tests in 1,307 suites passed; zero failures, cancellations or skips** (`.tmp/sunscar-final-tests.log`).
- Shared Rally tests cover deterministic simulation, action limits, checkpoints, placement and skill impact; server tests cover ownership, eligibility, practice, championship and payout replay.
- Shared Caravan tests cover seeded contracts/maps, connectivity, feasible paths, costs, weather, events, continuation flags, objectives and rare weighting.
- Eleven festival API integration tests cover token impersonation, lost acknowledgements, CAS/idempotency, generic-save forgery, real PvE start/resume, terminal settlement, actual potion recovery, pet equipment/consumable costs, no-companion behavior and rare-trail capture/cap/pointer recovery. Additional combat/physical-settlement checks passed (20 tests).
- Ownership, economy, durable settlement, modal exit and permanent-action contract checks passed (80 tests). TypeScript checks and the production build passed. Scoped final feature lint has no findings; the full client lint passed with zero errors and 14 existing warnings.
- All-pet motion audit: **160 models and 6,240 sampled poses passed**. Rally-specific adapter audit: **160 models and 3,360 sampled poses passed**, with normalized skin weights, valid joints, finite animated geometry and movement across all five morphology families. Node texture decoding is outside this geometry audit; real texture loading is covered in browsers.
- Browser feature flows: all three official races, touch controls, lost checkpoint response, reload/resume, verified final payout; complete nine-leg Caravan delivery, lost choice response, reload, actual battle screen; Scorpion Queen victory and defeat through normal UI actions, return, saved state and reload. No runtime errors in these runs. A dedicated host-rerender regression check recreates App's save callback every 100 ms: neither mode issues extra reads, and Caravan retains its inspected road and accepts travel. Stable callback refs prevent an API-read/render loop.
- Strict combat layout matrix: **20 passed, 10 configured skips**, including a successful isolated retry of its single initial WebKit failure. The unchanged strict assertion passed on retry (`.tmp/sunscar-combat-layout-final.log`, `.tmp/sunscar-combat-isolated-retry.log`).
- Cross-browser smoke: all seven browser projects completed with **529 passes and 456 configured skips** across 985 scheduled cases. Five projects contributed 328 passes and 352 skips, including successful isolated retries of two Firefox timing failures; the final desktop Chromium/WebKit run contributed 201 passes and 104 skips with no failures. Evidence: `.tmp/sunscar-e2e-smoke-recovery.log`, `.tmp/sunscar-smoke-isolated-retry.log` and `.tmp/sunscar-desktop-smoke-final.log`. High-concurrency attempts had timing failures and are not represented as clean passes. No smoke/layout assertions were relaxed for retries.

## 11. Performance

The new code is modular and lazy loaded, with no new package dependency. Race simulation stays in refs; React HUD updates are limited to 10 Hz. Rendering reuses existing model LODs/atlases, instanced scenery, capped DPR (1–1.5), 1,024-pixel shadows and a small dust pool. Owned WebGL resources, animation mixers, listeners, timers and input captures are cleaned up. Caravan mutates a persisted run instead of rerolling the map on each click, uses one request per choice and avoids routine polling.

The final six-cycle course/body-profile audit recorded 28–70 render calls, 128,048–151,118 triangles and 13–14 live textures. Reopening the same course/pet returned exactly 75 live geometries and 14 textures, matching its first visit; every exit removed the Canvas instrumentation. The extra shared cargo atlas adds one small texture and no asset request. Geometry counts vary by course and camera visibility.

Headless Chromium used **SwiftShader software rendering**, with concurrent repository checks: final mobile-sized samples measured 13.8–16.9 FPS. A separate 1440×900 check without a forced renderer also selected SwiftShader and measured 9.8 FPS. These are software-renderer observations, not physical-phone or accelerated-desktop performance certification. Actual target Android/iOS devices and a hardware-accelerated desktop still need profiling before a claimed FPS tier.

Final production build passed: 8,399,365 B total product JS/CSS (2,358,940 B gzip), initial graph 1,434,938 B (379,961 B gzip), lazy Three vendor 1.01 MB raw / 274.2 KB gzip. All startup budgets passed unchanged. The total lazy product ceiling increased from 8.3 MB to 8.5 MB to account for the two new permanent modes; this does not relax startup limits. Build evidence: `.tmp/sunscar-release-build.log` and `.tmp/sunscar-final-client-build.log` (the final callback fix rebuilt the frontend and rechecked the distribution; backend source was unchanged).

## 12. Mobile and visual QA

Follow-up: [Sunscar integration and mobile UX review](sunscar-mobile-ux-audit.md) records the expanded four-size Chromium/WebKit audit, full-game save recovery, battle-history integration, mobile fixes and the Windows WebKit rotation-capture limitation.

Tested desktop 1440×1080, mobile 390×844 and compact 320-pixel layouts. Caravan had no page-width overflow; Rally touch controls stayed onscreen and at least 44 pixels tall. Hub and Caravan axe scans reported zero WCAG A/AA violations in the tested states. Global mute is respected; reduced-motion preferences disable unnecessary scrolling motion. Screenshots were reviewed for terrain intrusion, model animation, legibility, controls and the Queen's actual combat sprite. Final receipts receive focus and scroll into view after delivery or defeat.

Evidence lives in `.tmp/sunscar-visual-qa`, `.tmp/sunscar-flow-qa`, `.tmp/sunscar-caravan-flow-qa`, `.tmp/sunscar-combat-flow-qa`, `.tmp/sunscar-track-cycle-qa` and `.tmp/sunscar-rig-audit`. QA servers use disposable memory saves bound to localhost; their fixtures are absent from production routing. Validation used the provided Node 24.15.0 runtime; the repository pins Node 22 for its normal environment.

## 13–14. Removed replacements

Removed the old `api/festival/sunscar.ts` and `_sunscar.ts` handlers, their obsolete tests, the old client festival service, route registration, dice UI/animations/styles/cost references and unused old festival-only artwork. Removed Miraa's wager daily fields from runtime ownership lists and the obsolete festival challenge glue. Repository runtime searches find no executable Dice of Fate or Miraa wager path.

Kael now introduces racing; Miraa works at the dispatch office. Their names do not retain their obsolete activities. Shared NPC/dialogue components, shared randomness, card inventory, Chronicle Points, card engine/NPCs and Card Shop remain. Unrelated Exchange styles and Broker behavior were preserved. Historical documents/migrations were not rewritten to erase history.

## 15. Art/audio scope and remaining external polish

New optimized WebP artwork includes the festival hero, four-region Caravan atlas, Queen portrait and transparent Queen body. These were generated for this task, visually inspected and compressed from retained originals. Asset provenance: `exec-bdf196fc-fc72-4b44-ad6f-0ce632e8082d.png` (festival), `exec-90f8e09d-4f4f-49db-af13-7affa097d513.png` (journey atlas), `exec-9638fad2-e0d3-41c8-b17e-1f8ab16b0f21.png` (Queen portrait), `exec-5afeccac-4f9f-4ebb-b79d-e460e089d3aa.png` (Queen body), under this task's generated-image directory.

Existing pet assets, game sound cues and ambience are reused. Track scenery is composed from lightweight authored geometry and instancing; it is not a bespoke sculpted cinematic environment pack. Dedicated festival music, voiced rival dialogue, more detailed spectator/caravan props and individually art-directed animation polish across every creature would benefit from specialist art/audio production. The playable racing, branching journey, real combat, persistence and rewards are implemented; these production-art opportunities do not stand in for missing gameplay.
