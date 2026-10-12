# Sector Stronghold expansion

## Player experience

- Entry to sector strongholds and the Obsidian Stronghold unlocks at **level 50**. Anbu treasury raids remain **level 100**; the entry prompt and Anbu challenge explain the separate requirements. Both use the saved server level.
- Village defenders can use their own stronghold entrance, matching server admission. Their Anbu shows a protected village vault; enemy treasury raids still require an enemy-held sector.
- The [level-50 entry and integration review](underground-review/entry-level-50-review.md) records the October 12 boundary, defender, mobile, multiplayer, regression, and build checks.
- The [Anbu async recovery, queue, and CI review](underground-review/anbu-async-queue-ci-review.md) records server-owned reconnects, interrupted admission, concurrent-combat preservation, UTC attempt accounting, queue exclusion, and the full CI test suite.
- The [real-Postgres follow-up](underground-review/postgres-integration-review.md) runs the 14 database cases and the full canonical suite: **14,781 passed with zero skips or failures**. `npm run test:ci:postgres -- --pg-bin=PATH` repeats the full check using an isolated local Postgres 16 cluster.
- The [final quality and integration review](underground-review/goal-final-quality-review.md) records the larger mobile cave playfield, bounded scenery renderer, actual Postgres multiplayer and Anbu/cave API checks, and the final **14,784-test CI pass with zero failures or skips**.
- The [CPU, memory and graphics resource review](underground-review/resource-leak-review.md) records background-walk cancellation, avatar frame cleanup, stable resources across repeated visits, and repeatable browser audits.
- Shared 37 x 23 interior with 12 named chambers, three wings and alternate routes.
- Full-screen camera follows the player; overview toggle, minimap and chamber discovery counter provide orientation.
- Tap-to-walk, WASD/arrows and mobile direction buttons.
- Players inside appear in the roster; players in visible chambers also appear on the map. Attacks use the normal server-authoritative sector PvP session and rewards.
- Interior players and outdoor players cannot attack through the stronghold boundary.
- Successful adjacent movement adds 4% threat. Step 25 starts a server-sealed patrol. Three patrol loadouts alternate; their level is the saved player level minus 10.
- Patrols use current HP/chakra/stamina and settle consumed items and physical outcomes through the existing ledger. Patrols do not consume daily final-Anbu raid attempts or award war-vault loot.
- A won patrol resets threat and returns to the same tile. A loss/retreat resets the visit to its entry point and shows a saved-outcome panel with a return-to-sector button.
- Exploration, threat and pending patrols persist across reloads/re-entry for 24 hours. The final Anbu requires adjacent vault proximity with no unresolved patrol.

## Mobile and integration finishing pass

- The map and movement controls stay inside the viewport, including 320px phones and landscape. Safe-area padding protects the bottom controls.
- Mobile players use a scrollable dialog; a crowded roster cannot push movement off-screen. Player markers have 44px targets, shared tiles show an occupant count, and inspection precedes an attack.
- Entry, player inspection, and the Anbu confrontation use native dialogs for focus containment, Escape dismissal, and scrollable small-screen content.
- The overlay uses the shared modal layer below the combat layer. Browser tests check that Arena buttons are actually clickable through the host overlay.
- Requests have deadlines. A failed exit resumes polling, background polls do not swallow movement, and unmounted exploration ignores late responses.
- Server-issued admission binds movement/polling to the active exploration tab. Leaving clears admission; late requests and superseded tabs cannot re-enter or move the player.
- Battle presence survives exploration unmounting. Defeat/retreat clears interior presence; final-boss admission still requires the vault position and a cleared patrol.
- Fight recovery is account-scoped and preserves saved fights through temporary outages. A stale settlement snapshot cannot overwrite newer character data or trap the result screen.

## Validation

- Client and server TypeScript checks.
- Focused ESLint on the stronghold feature.
- 121 unit/integration and wiring tests passed: authenticated route dispatch, identity rejection, connectivity, valid steps, exact patrol threshold, tab/exit fencing, victory/defeat/retreat and settlement replay, presence isolation, real two-player PvP session/join flow, capability gates and WorldMap/Arena integration.
- Chromium and WebKit: 320 x 568, 390 x 844, 430 x 932, 844 x 390 and 1920 x 1080. Checks include 18-player crowds, 44px primary controls, viewport fit, dialog focus/dismissal, keyboard/touch controls, overview, attack pending state and exactly 25 steps to a patrol.
- The browser harness mounts the actual exploration, Anbu host and MissionArenaFight with production styles, viewport contract and portal layering. It verifies fight recovery, patrol victory/defeat transitions, stale character responses, failed report retries and visible/clickable battle controls.
- The browser API is a deterministic local fixture using a real server-built combat session; backend tests separately exercise the actual handlers against isolated in-memory storage. Screenshots use fallback tile styling; live war-vault texture keys are preserved. Physical phones and a deployed multiplayer environment were not tested in this pass.

Run browser QA from `shinobij.client`: `node scripts/stronghold-browser-qa.mjs`.

Latest evidence: [browser results](audit/results.json), [small phone](audit/webkit-320x568.png), [phone](audit/chromium-390x844.png), [landscape](audit/chromium-844x390.png), [Anbu dialog](audit/webkit-boss-landscape.png), [combat](audit/chromium-combat.png).

## Death’s Gate: Obsidian Stronghold

- Sector 99 offers a reskinned shared stronghold to level-50 players from every village. It uses the same capability gate, interior presence, twelve-room layout, mobile controls, patrol settlement and reconnect handling as sector strongholds.
- Obsidian masonry, volcanic props, ember colors and twelve renamed chambers distinguish the interior. The southeast Blood Altar is an open dueling chamber, with no village Anbu or war treasury. A saved Anbu fight from another sector does not interrupt entry here.
- Movement still adds 4% threat per step. Cinder Sentries, Ash Stalkers and Obsidian Wardens use the volcanic combat environment. Patrols do not gain extra rewards.
- PvP wins inside grant **4× normal base Ryo, combat stat growth and Jutsu XP**, versus 2× elsewhere in Death’s Gate and 1× in other sectors. Both real players must be inside when the server creates an authorized world battle. Browser-supplied bonus fields are ignored; the sealed battle stamp survives location changes and reward recovery.
- The stat-growth daily budget, repeat-opponent reductions, mastery caps and existing reward eligibility checks remain in effect. Aura Dust, bounty payments, item/drop chances, mission rewards and war rewards are not multiplied by the stronghold bonus.
- Fixed the previously missing PvP Jutsu XP settlement: an eligible non-ranked PvP winner receives 10 base XP per distinct successfully cast jutsu (20 in Death’s Gate, 40 inside Obsidian), before repeat-opponent reductions and mastery caps. Rejected casts, repeated casts, uncast jutsu, Legacy signatures, NPC fights and losses do not earn this XP. It is credited in the same atomic transaction and replay receipt as base Ryo, and appears in the victory notice.
- Browser validation now contains **40 checks** across Chromium/WebKit at 320×568, 390×844, 430×932, 844×390 and 1920×1080, with zero page errors. Added checks cover the visible reward banner, PvP confirmation, movement, overview, walkable Blood Altar and unrelated saved-Anbu isolation. Review: [small phone](audit/webkit-obsidian-320x568.png), [phone](audit/chromium-obsidian-390x844.png), [landscape](audit/webkit-obsidian-844x390.png), [desktop](audit/chromium-obsidian-1920x1080.png).
- The final regression runs passed **208 tests** (125 combat/reward/stronghold/client-receipt checks plus 83 Anbu/presence/art checks). New backend integration drives actual admission, session creation, both joins, rejected/valid casts, KO, claim and claim recovery. It verifies 4×/2×/1× payouts, client-forgery rejection, no duplicate credits, unchanged unrelated rewards, interior/outdoor isolation and no patrol bonus. Client/server type checks and focused lint also pass. Testing uses local fixtures and isolated in-memory storage; this is not a deployed multiplayer or physical-device certification.

Screenshots: [desktop entry](audit/chromium-obsidian-1920x1080.png), [full map](audit/chromium-obsidian-map-1920x1080.png), [phone](audit/chromium-obsidian-390x844.png).

## Final integration review

- Player portraits, rival portraits, initials and group markers share one visible avatar size. Rival buttons retain a transparent minimum 44px touch area; tapping that padding opens inspection without moving the player.
- The browser harness now checks avatar dimensions and touch targets in both strongholds, including actual cached player/rival images.
- Fixed keyboard movement bypassing the full-map overview lock. Keyboard and direction buttons now follow the same movement gate, with browser regression coverage.
- Connected the local player's portrait to the existing world-map avatar cache fallback, so a temporarily empty character portrait does not hide an already-loaded image.
- Rechecked route registration, global request authentication, capability gates and the WorldMap-to-PvP callback. The 208 backend/client regression tests and 40 browser checks passed after review.

## CPU and GPU lifecycle audit — September 15, 2026

- Fixed Arena settlement deadlines surviving successful completion and automatic report retries continuing after the fight unmounted. Attempts now clear their timers, cancel backoff and pass cancellation through stronghold patrol/Anbu requests. Four automatic attempts and manual retry remain available while mounted; server settlement receipts remain recoverable.
- Fight recovery requests now abort on exit. Unchanged presence responses reuse visited-tile data; current visibility only recalculates when position or layout changes. This removes repeated fog-of-war history calculations from idle polling.
- A fullscreen stronghold now unmounts the covered outdoor scenery, animated actors and outdoor peer renderer while retaining the stronghold host. The Canvas/WebGL effects are restored when the interior closes.
- Browser measurements confirmed zero leftover settlement timers and zero report retries after exit. Twelve exploration entry/exit cycles and eight combat entry/exit cycles in each stronghold kept retained resources bounded; exploration returned to the same DOM/listener/layer counts after collection. Idle CPU profiles no longer contain visibility computations. Exterior tests covered ordinary animation with both 2D and 3D scenery: active frame loops and WebGL contexts dropped to zero inside, then scenery resumed on exit.
- Validation: 77 focused regression tests, 40 Chromium/WebKit mobile/desktop checks, client TypeScript and focused ESLint passed. Local fixture tests use the actual React exploration, Arena and exterior renderers. They do not certify physical-device VRAM use or every screen in the game.

Reproduce from `shinobij.client`: `node scripts/stronghold-browser-qa.mjs --resources`. Evidence: [before](audit/resource-before.json), [after](audit/resource-after.json), [resource checks](audit/resource-results.json). CPU sampling profiles are beside these files. Measurements include browser instrumentation and garbage collection overhead; they are diagnostic samples rather than production frame-rate benchmarks.

## Main integration validation — September 15, 2026

- Integrated with current main while preserving newer sector weather, landmark placement, combat balance and Sunscar settlement changes.
- 287 focused backend/client regression tests passed, including the real authenticated two-player admission, cast, KO, claim and replay chain.
- 40 Chromium/WebKit browser checks and 14 resource lifecycle checks passed. The audit artifacts above were refreshed from this release checkout; `before` profiles retain the earlier baseline.
- Server/client TypeScript, focused ESLint, the production client build, distribution validation and size budgets passed. Generated tooling metadata was regenerated and verified after integrating main; 74 additional post-rebase combat, Sunscar and wiring checks passed.
- Resource checks permit garbage collection to reduce retained listeners and reject increases; exact equality incorrectly treated successful collection as a leak.

## Production build correction — September 15, 2026

The first Production Image run failed the aggregate product-size budget: 8,510,542 B versus an 8,500,000 B limit. The credential-free local build omitted production-enabled code and missed the overrun. Rebuilding with the exact public `VITE_*` fixture variables in `.github/workflows/production-image.yml` reproduced it locally at 8,510,888 B.

Against the passing parent, strongholds add 27,151 B total and 207 B raw / 149 B gzip to initial loading. The aggregate allowance is now 8,600,000 B, following the existing 100 KB feature-growth policy. Startup, per-route, per-file and vendor limits are unchanged. Future release validation must include the production-variable size check.

## Full-CI contract correction — September 15, 2026

- The remaining two CI failures were the modal escape-hatch contract and the sector attack callback source contract.
- Stronghold Close, Escape, Cancel and Retreat remain usable during pending requests. Committing attacks and movement remain blocked until the original request settles; dismissing the prompt does not duplicate or discard an admitted fight.
- The callback contract now requires App to return the guarded attack promise, matching the existing implementation and preserving stronghold pending-state protection. The executable server-admission checks are unchanged.
- Both failed contracts and the guarded attack/session tests pass (36 checks). The refreshed browser evidence contains 48 Chromium/WebKit checks, including deliberately stalled PvP and Anbu admission, with no page errors.

## Suggested follow-up

Add limited, guarded supply caches to optional chambers so taking a longer route offers a deliberate reward. Keep those rewards tied to the existing server economy and daily limits.

## Underground sector presentation — October 11, 2026

The subsequent [integration audit](underground-review/integration-audit.md) documents the war/raid/event bindings, recovery corrections, twelve-room visual review and local verification evidence.

The [multiplayer/mobile follow-up](underground-review/multiplayer-mobile-review.md) adds shared furnishing collision, painted wall-bound passages, two authenticated browser clients, 24-player local HTTP tests, compact phone controls and the authoritative PvP movement guard.

Strongholds now use a shared underground scenery layer: painted fortress slate, raised wall faces, static torch pools, chamber seals, passage thresholds and readable objective markers. Obsidian keeps its ember palette and Blood Altar. Markers on the player's tile are offset so a rival does not hide the player's position. The same shared 37 × 23 layout, twelve chambers, presence lease, 4% step threat, 25-step patrol, Anbu proximity gate and rewards remain authoritative.

Rooms use world-scale framing modeled on First Pact: the typical chamber spans the field, a fitting axis centers, and a larger axis follows the player within the room's perimeter. Scale is derived from the floor's room dimensions and viewport, so crossing a floor does not repeatedly zoom. Player and encounter markers have bounded screen sizes instead of growing with the world. Stronghold intel and rosters open on demand, freeing the field's full width; Hollow Gate's map journal sits below its full-width cave scene. The overview still shows the full discovered stronghold, and room framing changes no walking tiles, patrol cost or saved layout.

Hollow Gate uses the scenery layer in cave mode, with natural rock, blackwater seams, crystals and a distinct palette at each depth. A depth strip, larger floor targets and labeled descent/exit/boss markers aid navigation. On phones the depth strip becomes numbered progress, and the closed map/journal sits at the corner of the playfield. Lore, the floor map/journal and relic/event log panels are collapsible. Standard runs remain solo, five-floor expeditions; event Rifts retain their sealed variants, dimensions, floor counts, bosses and rewards. Presentation does not regenerate a saved floor or alter fog, traps, torch use, encounters or loot receipts.

The architectural revision follows the sectors' painted overhead map approach. Stronghold paving, contact lighting and recessed wall stations share a coherent material scale. Sleeping quarters, armories, supply stores, archives, command stations, the cistern and treasury cabinetry occupy explicit physical bays, with clear travel lanes and real corridor mouths. Hollow Gate retains natural cliff stone, shrine lanterns, broken pillars and perimeter formations, with server-sealed collision and NPC movement. The HUD uses themed typography, labeled resources, a restrained depth trail and a small ground destination ring. [Current room artwork and exact prompts](../art/fortress-room-maps-v3.json) accompany the compact floor and wall-band textures. Earlier source paintings are preserved outside the runtime public directory.

Current validation passes client/server builds and unchanged startup/artifact budgets, 694 API/client regressions, four authenticated two-browser multiplayer cases, 24-player load cases in both strongholds, 88 room/integration checks, 72 mobile checks, 32 final walking samples, 50 existing stronghold interaction checks and 17 resource/cleanup checks. The [validation report](underground-review/multiplayer-mobile-review.md) includes current screenshots, reproducible commands and test limits. Review the redesigned rooms [1–4](underground-review/sector-style-rooms-1.png), [5–8](underground-review/sector-style-rooms-2.png) and [9–12](underground-review/sector-style-rooms-3.png). Local browser checks do not certify production network load or physical-device performance.

The interior remains part of its parent sector. Stronghold attacks now call WorldMap's existing sector attack handler: eligible Card and Pet war opponents open those games, and other opponents retain ordinary shinobi PvP. The sector's contest table and server-approved garrison are available inside. Server co-location still rejects attacks across the entrance. Village allegiance, current-holder war rules, sealed weather, village treasury settlement, clan raid contribution, Obsidian reward caps and event receipts continue through their existing owners. Solo Hollow Gate does not become a PvP or territorial war instance.

Painted materials are packaged in `shinobij.client/public/underground/`; their built-in Imagegen prompts and provenance are in [the material manifest](../art/underground-sector-materials.json). Scenery is static SVG over authoritative tiles, with explored/visible masks and no additional frame loop. Assigned atlas icons and decorations remain supported.

Reproduce the new visual/input checks from `shinobij.client` with `node scripts/underground-sector-browser-qa.mjs`; `--quick` checks Chromium desktop and phone. The existing `node scripts/stronghold-browser-qa.mjs` covers combat admission, pending actions, crowds, touch targets, overview, recovery and reconnect. Its crowd checks now hold attack completion explicitly so the pending-state assertion does not race a 700ms fixture delay. Backend coverage includes real interior Card/Pet admission, boundary refusal, scoring and exactly-once replay, alongside stronghold patrol/PvP, captured-holder rules and Hollow Gate/Rift receipt and progression regressions.

The Anbu station sits on the authoritative vault tile, ahead of paired reserve strongboxes and a guarded entrance. Approaching the station opens the existing infiltration challenge; the API still requires an adjacent tile, an active interior presence lease, and no owed patrol. Combat uses the appointed defender's sealed snapshot (or the existing Kage fallback). A held defense preserves both war pools; a raid win and cache turn-in retain their server-owned caps and replay receipts. The portrait uses a player-size gold circle pin on the map and the full village portrait in the challenge and fight.

Hollow Gate now seals two friendly roamers and up to three hunters per floor when a current browser opts into the roster. Older browsers keep their fixed floor encounters. Helpers wander every four accepted steps and pause within talking distance: the medic heals 33% max HP once, and the wayfarer offers one Shrine Key or a full torch refill once. Hunters move every two or three steps, pursue through actual passages within nine path steps, and stop pursuing after a verified withdrawal. Their stable identities consume existing battle slots, including exact-once win rewards. Rift signal nodes, Alpha bosses and threat-triggered Chronicle encounters retain their original identities and priority. Movement, gift claims, augments, hunt contact and reconnect state are server-owned. Solo expeditions remain isolated from live multiplayer wars. NPCs share the player's animated circle-pin component; content tiles use painted props over continuous cave material. Character art provenance is in [the wanderer manifest](../art/hollow-gate-wanderers.json).

Physical room plans live in `shared/underground-floor-features.ts`. Stronghold architectural stations reserve three edge cells in one row; the exact footprint controls both movement and painted wall-band bounds. Vault security stations flank the north entrance and sealed reserves occupy the south cabinetry. The renderer loads only discovered room art and omits old oblique furnishing stamps and legacy shrine tile backgrounds. Center travel lanes and gameplay nodes stay clear, with connectivity verified before any feature is admitted. Ordinary cave rooms use at most one perimeter formation; the final sanctum may use a paired colonnade. The [multiplayer, mobile and architecture review](underground-review/multiplayer-mobile-review.md) records the actual test scope and its limits.
