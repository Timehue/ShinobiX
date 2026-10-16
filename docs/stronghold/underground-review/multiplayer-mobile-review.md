# Physical floors, multiplayer and mobile review — October 11–12, 2026

> Raw evidence files linked from this page (logs, transcripts, screenshots) were removed on 2026-10-16 to cut repository weight. Retrieve one with `git show 5124ba3f2:<path>`.

Strongholds now follow the sectors' painted overhead floor approach. Coherent stonework and recessed architectural stations replace isolated oblique furniture sprites. Barracks sleeping bays, fitted armories, quartermaster stores, records, water reserves, command stations and secured treasury cabinetry occupy explicit wall bays. All twelve connected rooms, the Anbu approach and Obsidian Blood Altar retain their gameplay rules.

## Implementation and fixes

- `shared/underground-floor-features.ts` defines purposeful room plans and grid-aligned ground footprints. Stronghold stations reserve three edge cells in one row, with clear midpoint entrances and central travel lanes. A feature is rejected if it covers a door, spawn or event, overlaps another footprint, or disconnects any remaining open floor. Both client navigation and server movement enforce those footprints. Cave NPC movement uses the same physical walk mask.
- Stronghold furnishing geometry is cached for the two floor types, with copies returned to callers. Existing visits inside a newly solid footprint relocate to the nearest safe floor without resetting the visit ID, steps, owed threat or patrol. Cave architecture is sealed per floor and restored on resume; a rolling-release upgrade avoids placing it under a player or traveler.
- Multiplayer testing exposed movement after PvP join while presence flags were stale. Stronghold entry, movement, intel, vault access and exit now consult authoritative battle evidence. State polling reports the block to the client. The player's own patrol remains recoverable.
- Mobile headers, war prompts and controls use less space. Direction controls remain large touch targets, and the duplicated cave location panel no longer covers the avatar on phones. All important floor/resource and war actions remain available.
- Unseen tile elements are omitted, with explicit grid coordinates and row sizing preserving geometry. This reduces initial room tile elements from 851 to roughly 50–60. Fog memory and the full-map overview retain their existing rules.
- Desktop stronghold framing shows both station rows from the chamber center; phones retain their established world scale and player-following camera. Legacy shrine tile textures and standalone stronghold passage images are removed from the rendered floor. Cave passage artwork remains tied to actual corridor mouths.
- Art generation used the built-in ImageGen tool. The fourteen room/shell source paintings, exact prompts, runtime texture strips and source previews are recorded in [fortress-room-maps-v3.json](../../art/fortress-room-maps-v3.json). Architectural wall bands render inside the exact collision footprint. Only discovered room art loads. Compact floor/strip textures total 826,398 bytes, down from 2,403,868 bytes of full source maps; full reference paintings and three retired floor/wall/passage assets are preserved outside the runtime public directory.

## Actual authenticated multiplayer HTTP tests

[Multiplayer results](sector-style-multiplayer-results.json) exercise four cases: normal and Obsidian strongholds in Chromium and WebKit, each using two separately authenticated mobile browser contexts against the actual public API handlers and isolated memory storage. The checks cover peer positions, exterior isolation, move/threat synchronization, leave/re-entry, stale tab leases, offline recovery, PvP admission, both joins, movement blocked during combat, KO, 1×/4× reward settlement and reward replay without duplicate credits.

Combat's final board positions and opponent HP are set deterministically to exercise KO/settlement. Admission, actions and rewards use actual handlers. Exploration uses actual authenticated HTTP requests throughout. No live accounts or production storage are used.

Each stronghold also passes a 24-player concurrent HTTP test with six steps per player and 192 measured entry/step/state requests. All peers receive the other 23 interior players and exactly 24% threat after six steps. With an added 120 ms server response delay, measured local request p95 is **170.6 ms** for Sector 12 and **140.6 ms** for Obsidian.

## Mobile and visual tests

- **72 mobile browser checks**, Chromium and WebKit at 320×568, 390×844, 430×932 and 844×390. Includes both strongholds, solo caves, all five standard depths, event Rifts, walking, map/journal, gifts, intros, exit and modal recovery. [Mobile results](sector-style-mobile-results.json).
- **88 room/integration browser checks**, including every stronghold room, exact painted-bay/collision alignment in both engines, Anbu proximity/raid trigger, sector contest callbacks and NPC pin sizing. [Room results](sector-style-room-results.json).
- **32 final walking checks** use the completed artwork and navigation rings. Targets are selected before frame timing begins; samples exclude locator setup, screenshots and modal captures. The highest sampled p95 is **26 ms**; the longest individual frame is **133.3 ms** in the smallest-phone cave sample at 4× Chromium CPU slowdown. [Walking results](sector-style-walking-results.json). These are local diagnostic samples, not physical-device frame-rate certification.
- A small-phone sample initially exceeded the unchanged 100 ms p95 limit. The world-size Obsidian CSS filter was replaced with a direct tint, and discovery updates no longer repeat full room-bound searches. The final walking gate passes. Initial failure.
- Final paired-browser Chromium p95 is **16.8 ms**, with its longest frame **49.9 ms** at 4× CPU slowdown; WebKit p95 is **30 ms**. [Final sample](sector-style-multiplayer-results.json). The baseline before tile culling recorded 200/300 ms worst frames. [Baseline](multiplayer-before.json).
- **50 existing stronghold interaction checks** and **17 repeated entry/exit/resource checks** pass with zero page errors. [Interaction results](sector-style-legacy-results.json), [cleanup results](sector-style-resource-results.json).
- The API/client regression scope passes **694 tests in 45 suites**, including collision rejection without resource cost, connectivity across standard/Rift floor shapes, battle authority and legacy migration. Regression log.
- Client/server builds, focused lint, distribution verification and normal/production-configured bundle gates pass. The runtime artifact is **531.8 MiB**, under the unchanged 532 MiB ceiling. Production startup is **1,423,114 bytes raw / 395,348 bytes gzip**; the startup gates were not increased. Client build, server build, distribution, production size, lint.

Screenshots: rooms [1–4](sector-style-rooms-1.png), [5–8](sector-style-rooms-2.png), [9–12](sector-style-rooms-3.png), [Anbu vault](sector-style-anbu-vault.png), [small-phone stronghold](sector-style-stronghold-phone.png), [small-phone cavern](sector-style-cavern-phone.png), [two-player stronghold](sector-style-multiplayer-normal.png), [two-player Obsidian](sector-style-multiplayer-obsidian.png).

## Reproduction and limits

From `shinobij.client`:

```text
node --import tsx scripts/stronghold-multiplayer-qa.mjs
node --import tsx scripts/underground-sector-browser-qa.mjs --quick --mobile
node --import tsx scripts/underground-sector-browser-qa.mjs --quick --mobile --walk-only
node --import tsx scripts/underground-sector-browser-qa.mjs
node --import tsx scripts/stronghold-browser-qa.mjs
node --import tsx scripts/stronghold-browser-qa.mjs --resources
```

The browser suite uses actual components and deterministic cave/war UI fixtures. API integration tests separately exercise the real cave handlers. Multiplayer tests use real authentication and HTTP handlers with synthetic test players and isolated memory storage. Physical phones/controllers, production database/network load and live-account sessions are not certified by this local review.
