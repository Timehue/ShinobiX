# Sector Stronghold expansion

## Player experience

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

- Sector 99 now offers a reskinned shared stronghold to level-100 players from every village. It uses the same capability gate, interior presence, twelve-room layout, mobile controls, patrol settlement and reconnect handling as sector strongholds.
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

## Suggested follow-up

Add limited, guarded supply caches to optional chambers so taking a longer route offers a deliberate reward. Keep those rewards tied to the existing server economy and daily limits.
