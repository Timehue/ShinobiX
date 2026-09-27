# The Find: implementation and review

Implemented against `origin/main` at `47964f89ff3ae466affb74d42feeffb3e889682d`, verified against the remote on 2026-09-27. Work is isolated on `codex/the-find-gathering`. No deployment or schema change.

## Presentation

Five original painted environments and ten original transparent inventory icons follow the main-story cinematic paintings and the current hunt-material/relic icon references. The final assets replace the earlier photographic studies. Their prompts, references and source filenames are recorded in [art-prompts.json](art-prompts.json).

The gathering interface uses neutral charcoal surfaces, ivory text and restrained brass selection accents. Green menu backgrounds are intentionally excluded. It uses the game's shipped Inter and Marcellus typefaces, compact material cards and a separate reward/action area. Desktop displays the complete regional-material option; smaller phones scroll the choices while keeping collection controls visible.

The Find uses TriggeredVisualNovel with biome-specific prose, a full first introduction, a skippable repeat scene and a separate explicit material choice. The preview shows the exact yield before collection. Closing keeps the find in the map's Saved Finds list; claiming commits only once. The choice screen supports keyboard focus, Escape, mobile scrolling and reduced motion.

## Authority and economy

- The server seals sector, registered biome and the 15% rare-trace roll during the same save mutation that records the tile. Unclaimed finds are server-owned and persist independently of the rolling exploration receipts and their TTL.
- A player may hold 24 unresolved finds. At the limit, ordinary exploration asks them to resume a find; already sealed pet/dungeon outcomes can still settle.
- An ordinary harvest grants three of one chosen common material. Taking the sealed regional trace grants two common plus one regional material. Gathering pays no ryo and costs no second exploration.
- Claims authenticate the owner, validate the sealed choice and settle under the save lock. A receipt replays the original yield without a second grant; altered choices cannot reclaim it.
- Eight materials and the two authorized supply containers are catalogued and stackable. They have no generic craft-point value or sale value.

With chest capacity available, the ordinary overall outcome rates are:

| Level | Dungeon | Pet | Chest | Battle | Quiet | Gathering |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Under 50 | 0% | 5% | 14.25% | 49.6% | 11.15% | 20% |
| 50+ | 2% | 4.9% | 13.965% | 48.308% | 10.827% | 20% |

When chests are capped, the conditional final roll is recalculated so gathering remains 20% overall. Exact boundary tests cover both level bands and chest states. The existing 150-player/day and shared 1,500-sector/day limits still apply.

| Recipe | Added exact ingredients | Retained cost |
| --- | --- | --- |
| Field Rations | 1 Field Herb | 1 Beast Meat + 30 ryo; 5 packs |
| Campaign Rations | 2 Field Herbs | 1 Frost Pelt or Ash Scale + 80 ryo; 20 packs |
| Smoke Bomb | 1 Binding Fiber | 25 craft points |
| Rejuvenation Potion | 2 Field Herbs | 250 craft points |
| Shuriken ×3 | 2 Iron Sand | 15 craft points, no ryo |
| Elderbranch Katana | 6 Heartwood Bark + 100 Binding Fiber | 700 points + 3,500 ryo; effective level 65 |
| Black Lotus Dagger | 6 Shadow Thread + 100 Iron Sand | same |
| Frostfang Oathblade | 6 Rime Crystal + 100 Iron Sand | same |
| Embercoil Scythe | 6 Ember Ore + 100 Iron Sand | same |
| Tempest Fang Blade | 6 Stormglass Shard + 100 Binding Fiber | same |
| Village Supply Bundle | 5 Ration Packs + 3 each common material | 30 ryo; donates 10 provisions |
| Village Supply Crate | 20 Ration Packs + 10 each common material | 100 ryo; donates 40 provisions |

Cooking retains its 40-pack daily cap. Packs, bundles and crates share the existing 40-provision donation cap. Containers route only to village provisions, preserve the flat 500-per-item merit basis, and refuse clan donation. When Village Stores is disabled, crafting/donation refuses and preserves the inventory. The existing debit-first donation saga provides retry recovery.

## Scope and integration

Shared economy definitions live in `shared/gathering-materials.ts`, with biome and choice validation in `shared/gathering.ts`; sealing and claiming live under `api/world/`. The VN, API client and choice UI are separate modules; WorldMap only wires discovery and resumption. Forge, cooking, Town Hall, catalog generation and save-ownership mirrors use the new definitions.

Field Signs/huntSector, existing pet/chest/dungeon presentation priority, the level-90 named forge and the Fate Shard shop path remain unchanged.

## Verification

Verified on 2026-09-27 with independent dependencies installed from this worktree's root and client lockfiles. The final revision replaces the green interface with the neutral charcoal presentation shown in the screenshots. No built `dist/` files are part of the change.

| Gate | Result |
| --- | --- |
| Catalog generation | Regenerated from starter-items; server catalog and stackable mirror validated by tests |
| Root unit/API suite | 12,461 passed, zero failed or skipped in the subsequent functional audit, including the new continuous economy journey |
| Client lint | Zero errors; 14 existing warnings |
| Production build | Root build passed; final client rebuild, distribution validation and size checks also passed |
| Full browser regression, final UI | 1,339 passed, 693 existing project/fixture skips, 14 timeouts. All 14 timed-out cases passed a separate single-worker rerun without code changes |
| Gathering browser checks | 21/21 passed across all seven browser/viewport projects in the functional audit, including discovery order, authenticated claims, lost-response retry, refresh recovery and shipped-art decoding |
| Strict combat layout, final UI | 20 passed, 10 existing project skips, zero failures; capture phase after and strict mode enabled |

The full run's 14 failures were navigation/content waits, browser-context teardown and overall test timeouts on Central Hub, First Contract, First Pact, Guides, companion screens, activity guidance, clan recovery and login. The isolated rerun passed all 14 in 1.9 minutes. Original traces remain under `shinobij.client/test-results/restyle-smoke/`; rerun evidence is under `restyle-recheck/`. The full and strict suites both ran against the same fixed final build.

Size budgets were not raised: final initial JS/CSS is 388,662 B gzip against a 389,000 B ceiling, and budgeted product JS/CSS is 8,839,548 B against 8,880,000 B. This leaves little startup headroom for future unrelated additions.

Review screenshots: [first VN scene](evidence/vn-desktop.png), [desktop choice](evidence/choice-desktop.png), [phone choice](evidence/choice-mobile.png). The 360px and 390px views were inspected. Desktop shows the full regional-material option without clipping; smaller phones scroll the choices independently of the collection controls. Secondary text and button color pairs measure at least 6.3:1 contrast on their solid backing surfaces. Keyboard focus, native radio/checkbox semantics and reduced-motion support are retained.

Detailed local logs are under the ignored `tmp/the-find/`: `npm-test-locked.log`, `restyle-lint.log`, `restyle-build.log`, `restyle-final-build.log`, `restyle-gathering.log`, `restyle-final-visual.log`, `restyle-smoke.log`, `restyle-recheck.log`, and `restyle-combat.log`.


## Functional integration audit, 2026-09-27

No additional game-code defects were found. This audit adds regression coverage without changing gameplay or the certified production build:

- The authenticated exploration handler seals a real find; claiming its Iron Sand supplies the authenticated shuriken forge. Exact points and ingredients are spent, three shuriken are granted, and no ryo is charged. Replaying either the craft or the original claim cannot restore spent materials or repeat the output.
- Four sealed common finds are claimed through the settlement endpoint. Their herbs cook into five ration packs through the cafeteria endpoint, then combine with fiber and iron into a Village Supply Bundle through the forge endpoint. Donating that actual bundle stocks ten provisions, spends the bundle, advances the shared donor counter by ten and awards the unchanged per-item merit. Insufficient ingredients leave the save untouched; a donation replay cannot debit or stock twice. The final persisted save retains the correct remaining ingredients and cleared finds.
- A built-client browser journey starts from Explore Tile and verifies the dungeon → pet → exploration request order with one stable request ID. A gathering result opens the choice UI. Claims carry player authentication; a simulated server commit with a lost response can be retried without duplicate rewards, and the completed find stays cleared after refresh. The scene and item WebPs decode at their intended dimensions in every tested browser.
- Existing checks cover biome sealing, exact outcome thresholds, queue limits, concurrency, recipe quantities and level gates, save authority, disabled stores, donation caps and credit-recovery failures. The focused run passed 85 tests; the complete root run passed all 12,461 tests. The three browser journeys passed all 21 cases across seven browser/viewport projects.

The browser suite uses deterministic API fixtures to verify client behavior; the economy journeys call real authenticated handlers against isolated in-memory storage. No live player accounts or production service were modified. Earlier full smoke and strict combat-layout evidence above applies to the same unchanged game code and build.

Audit logs: `tmp/the-find/functional-focused.log`, `functional-journeys.log`, `functional-full-unit.log`, `functional-browser-probe.log`, `functional-browser.log` and `functional-lint.log`. Browser traces/screenshots are under `shinobij.client/test-results/functional-find/`.


## Main integration release checks, 2026-09-27

Merged current remote main at ac735d21a6bd8bcdb5538c665a049ed945296dc3, retaining its six tower commits. The save-ownership parity conflict was resolved by retaining both gathering fields and battleTowerRecords. The generated design-token handoff now includes The Find's breakpoints.

The baseline main CI failure in BattleTowerFight.aaa-presentation.test.ts was a stale assertion rejecting a screen-reader-only status identifier. The corrected test still forbids the retired visible strip and requires the accessible status message; all 32 related tower contracts pass. No tower gameplay behavior was changed.

The merged revision passed all 12,535 unit/API tests, full client lint (zero errors, 14 existing warnings), and all 21 gathering browser cases. The real Express Village Stores desktop browser journey also passed after supplying its fixture with the newly required three herbs and asserting their exact consumption. Compilation, story checks, distribution verification, and JavaScript/CSS size gates passed.

Runtime packaging excludes the unused elemental-impact-atlas-source.png authoring master; its WebP runtime export is retained. After that exclusion, the merged client artifact measures 537,479,788 B (512.6 MiB). The total runtime-asset allowance is now 514 MiB to accommodate approximately 1.2 MB of new gathering scenes/icons. This does not raise the initial JavaScript/CSS limits: the final initial graph is 388,707 B gzip against 389,000 B, and product JS/CSS is 8,860,474 B against main's existing 8,910,000 B limit.

These integration checks supplement the earlier full smoke and strict combat-layout runs; those two full suites were not repeated during this merge. Logs are under tmp/the-find/main-merge-*.log and main-release-*.log. Live deployment confirmation is performed after the authorized main push.


## Production image follow-up

The first pushed revision exposed a production-only bundle overrun. The final fix separates the small supply-routing module into shared/gathering-supplies.ts and removes an unused gathering re-export from the eagerly loaded exploration recovery module. Recipes and biome data now stay off startup.

The complete root build was rerun with the exact public placeholder VITE settings from the production-image workflow. It passes at 388,314 B initial gzip (unchanged 389,000 B limit) and 8,918,449 B total product JS/CSS. The total product allowance is 8,950,000 B for the added gathering feature, with roughly 31 KB of production margin; startup limits were not raised. Runtime assets remain within the documented 514 MiB allowance.

The final dependency split passed all 12,535 unit/API tests, scoped lint, all 21 gathering browser cases, and the real Express Village Stores browser journey. Production-parity evidence: tmp/the-find/production-final-build.log, production-drain-unit.log, production-final-browser.log, and production-final-stores.log.
