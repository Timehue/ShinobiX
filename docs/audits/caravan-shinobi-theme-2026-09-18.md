# Caravan Run: shinobi escort theme

Caravan Run now presents its existing route-and-resource gameplay as a shinobi escort assignment. Indigo panels, vermilion mission seals, scroll icons, and an illustrated mission header connect the dispatch board to the journey.

- Contracts carry C-, B-, or A-rank escort labels corresponding to the existing three difficulty levels.
- All ten briefs now describe village supply lines, field medics, patrol optics, decoy convoys, or guarded intelligence. Contract IDs, reputation gates, route lengths, rewards, objectives, and story progression are preserved.
- Selected encounter scenes now use shinobi scouts, hand signals, kunai, tripwire, hidden patrol camps, courier scrolls, and sealing tags. Their costs, outcomes, flags, discovery IDs, and combat bindings remain unchanged.
- The route map uses the game's existing vector icons and presents itself as a scout scroll. The mobile decision/map views and accessible touch targets from the earlier polish pass remain.
- New region artwork depicts shinobi escorting cargo through the borderlands, Scorpion Pass, a sealed shrine, and Reedwatch outpost.

## Artwork

Created with the built-in image_gen tool, inspected, then split into four 768×512 WebP files. Only the current region is loaded. The first scene is 65,166 bytes, compared with the previous 456,398-byte atlas; all four new scenes total 270,202 bytes.

- [Borderlands artwork](../../shinobij.client/src/assets/festival/sunscar-shinobi-dunes-v2.webp)
- [Canyon artwork](../../shinobij.client/src/assets/festival/sunscar-shinobi-canyon-v2.webp)
- [Shrine artwork](../../shinobij.client/src/assets/festival/sunscar-shinobi-ruins-v2.webp)
- [Outpost artwork](../../shinobij.client/src/assets/festival/sunscar-shinobi-oasis-v2.webp)
- [Exact generation prompt and export details](../../shinobij.client/src/assets/festival/sunscar-shinobi-v2.txt)

## Verification

The 13 Caravan state tests pass. A comparison of all 10 contract and 48 encounter definitions against the original catalog confirms that all gameplay properties and persistent identifiers are unchanged after removing presentation text. The local Vite harness build, client TypeScript build, and targeted ESLint checks pass.

Fresh-source browser checks pass at 42 layout checkpoints across Chromium and WebKit, with two automated accessibility scans and no reported errors. Coverage includes 320px phones, portrait and landscape touch layouts, tablets, desktop, 44px touch targets, keyboard focus, retry recovery, and loading only the current region's artwork. The complete nine-leg journey also passes, including reload/resume, a lost-response retry, authoritative delivery rewards, mobile combat, and supply-cap feedback. These checks use browser emulation rather than physical devices.

- [Desktop mission board](../../.tmp/caravan-polish-qa/chromium-1440x900-contracts.png)
- [Mobile journey](../../.tmp/caravan-polish-qa/chromium-390x844-decision.png)
- [Small-phone scout scroll](../../.tmp/caravan-polish-qa/chromium-320x568-map.png)

Browser evidence is saved under `.tmp/caravan-polish-qa/`; the complete delivery/reconnect evidence is under `.tmp/sunscar-caravan-flow-qa/`. Browser tests use emulated touch viewports and disposable memory saves. The QA server supports `SUNSCAR_QA_PORT`, and the Caravan browser checks support `SUNSCAR_QA_URL`, so concurrent local tasks can use separate saves.

Changes are local; no deployment was performed.
