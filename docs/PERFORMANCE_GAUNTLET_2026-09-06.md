# ShinobiX performance gauntlet — 2026-09-06

For the release adapted to current production main, see [live-main integration](PERFORMANCE_LIVE_MAIN_2026-09-06.md). This document retains the original development-checkout measurements.

The subsequent [performance follow-up](PERFORMANCE_FOLLOWUP_2026-09-06.md) addresses the baseline lint/test failures, reduces roster/archive save transfers, and adds player-flow and resource verification. The measurements and remaining-debt list below describe the initial gauntlet checkpoint.

## 1. Executive summary

This pass reduced avoidable work in startup, travel, screen polling, roster rendering, combat initialization, shared content, era progress, and war target selection. It preserved the checkout's existing narrative changes. No combat, pet, Chronicle, progression, visual styling, or economy rules were changed. No schema migration, deployment, credential change, or production-data mutation was performed.

The starting code already had substantial optimizations: lazy gameplay/admin screens, split React/Three/Sentry bundles, sector-indexed presence, versioned saves, single-flight server frame caches, bounded storage caches, on-demand story assets, and compressed image/audio delivery. The remaining opportunities addressed here were repeated work inside that architecture.

Four implementation/re-audit rounds covered client polling and timers; shared database reads; combat/era initialization; and map/war navigation. A final source search and review found no additional demonstrated improvement with comparable safety and impact in the traced paths. This is a repository and local-browser result, not certification of production latency or physical Android memory use.

## 2. Implemented changes

| Priority | Files | Original cost | Implementation and evidence | Risk |
|---|---|---|---|---|
| P1 | `shinobij.client/src/App.tsx` | Every sector change restarted the full public-roster request; hidden tabs also polled. Old responses could finish after the effect retired. | Removed the unused sector dependency; wait for session restoration; use visible polling, timeout, and cancellation. Desktop and mobile browser tests confirm travel adds **zero** roster requests. | Low |
| P1 | `shinobij.client/src/lib/poll.ts` and screen callers listed below | Slow async polls and foreground events could overlap. Hidden screens retained waking timers. Mount fetches were outside the poll's ownership. | Await returned promises; one active poll; no timer while hidden; one immediate foreground refresh; cleanup cannot schedule another poll. An optional immediate fetch covers mount as well. Deterministic tests include unresolved requests, 20 visibility toggles, rejection, and cleanup. | Medium: cadence is measured from completion; slow networks receive fewer redundant polls. |
| P1 | `App.tsx`, `screens/CentralHub.tsx`, `lib/use-public-bloodlines.ts` | Every logged-in player fetched the bloodline gallery at startup and every five minutes, although only the Ancient Archives displayed it. | Fetch only while the archive is open. Abort retired requests; refresh on reopen. Browser tests verify zero pre-open requests, one on open, none after closing and advancing five minutes, and one fresh request on reopen. | Low; gallery is read-only presentation data. |
| P2 | `lib/roster-merge.ts`, `App.tsx` | The full roster used nested case-insensitive `findIndex` scans and normalized inside a React state updater. | A name-to-position map preserves first-match behavior, ordering, replacements, duplicates, and every incoming row. Normalize once outside the updater. Synthetic 2,000-player merge: **122.629 ms → 0.215 ms** median. | Low; old/new results are compared directly. |
| P2 | `lib/shared-now-store.ts`, `lib/use-shared-now.ts` | The shared one-second clock never stopped after its last subscriber left and continued updating hidden UI. | A subscribed external store releases the interval and visibility listener on last unsubscribe; hidden tabs stop ticking; remount/foreground reads current wall time. Test runs 100 mount/unmount cycles. | Low; display clock only. |
| P2 | `App.tsx` | Built-in/custom AI presentation arrays were rebuilt on every unrelated App render. | Memoize this derivation using both `creatorAis` and `temporaryStoryAi`. Same-id built-in overrides remain image-only. | Low; no simulation or definition precedence change. |
| P2 | `screens/WorldMap.tsx` | Switching selections could leave obsolete guard-list requests running and allow their results to overwrite the current selection. | Cancel both guard-list read effects on selection change/unmount; ignore late resolution and cancellation errors. | Low; authoritative attack validation remains on the server. |
| P2 | `api/game-state.ts` | Village and clan-pet collection batches ran sequentially. | One ordered batch feeds both projections; 12 concurrent handler calls share one build and retain the response/ETag contract. | Low; cache policy and response fields unchanged. |
| P1 | `api/_admin-content-records.ts`, `_admin-jutsu-catalog.ts`, `_admin-item-catalog.ts`, `_admin-ai-catalog.ts` | Concurrent combat catalogs independently fetched the same two admin saves: up to six slot reads. | One shared in-flight batch reads both slots. Each catalog keeps its existing 60-second policy and its own merge rules. No new persistent cache is introduced. Tests verify recency, tombstones, AI data, and fresh subsequent raw reads. | Medium; definition-source ordering is tested. |
| P1 | `api/_content-store.ts` | Published content read every field separately. | One `mget` with a compatibility/failure fallback to the original per-field reads. A missing field still cannot suppress available fields. | Low; unchanged field validation and fallback. |
| P1 | `api/_era.ts` | Contribution rendering performed 15 sequential counter/receipt reads, followed by trigger reads. | One batch for counters and receipts; state and trigger reads run concurrently with it. Numeric normalization, ledger validation, compacted totals, and pending receipts remain identical. | Medium; malformed ledgers still fail closed. |
| P1 | `api/towers/start.ts` | Each party member's save was fetched separately at preflight and again after leasing the accounts. | Batch within each phase. The second read remains after lease acquisition, alongside independent admin-definition loading. | Medium; the authoritative reread, fees, leases, and compensation remain separate and intact. |
| P2 | `api/clan-boss/assault-start.ts` | Ally save reads ran serially after definition loading. | Batch ally saves concurrently with definitions; reuse the host record already held by this path. | Medium; party preparation and progress/attempt locks are unchanged. |
| P1 | `api/_merc-auto.ts`, `api/_merc-roam.ts` | Target selection fetched each online player's save and then each eligible player's cooldown serially. | One save batch, then one cooldown batch for enemy candidates; no reads for an empty list. Deployment still independently rechecks cooldown and village under the target save lock. | Medium; eligibility, ordering, tie-breaking, and spending rules are unchanged. |

Polling call-site updates cover `components/HealerInjuredList.tsx` and these screens: `BattleTowersLobby`, `CentralHub`, `ClanBattlesTab`, `ClanBoss`, `ClanChat`, `ClanSealPool`, `DailyProfessionMissions`, `Messages`, `ShinobiCouncilHall`, `TownHall`, `VillageWarMap`, `VillageWarScreen`, and `WeeklyBossArena`. Existing tower push/fallback consumers continue to use their own request guards. Three now-unused hook lint suppressions were removed.

## 3. Database optimizations

These are logical KV read counts; the Postgres backend normally implements a batch as one indexed statement. The Supabase fallback preserves its existing bounded chunking, ordering, duplicate-key, and expiry handling.

| Path | Before | After |
|---|---:|---:|
| Game-state village + clan-pet collections, both nonempty | 2 sequential batches | 1 batch |
| Concurrent jutsu/item/AI catalog admin slots | 6 individual reads | 1 shared batch |
| Published content, cold load | One read per content field | 1 batch |
| Era contribution totals | 15 sequential reads | 1 batch |
| Tower party saves, N members across both validation phases | 2N reads | 2 batches, retaining both phases |
| Clan Boss ally saves | N ally reads | 1 batch when allies exist |
| Mercenary candidate selection, N players and E enemy candidates | N + E reads | At most 2 batches |

The shared game-state handler test sends 12 concurrent requests and observes one combined collection batch. Its response shape and 304/ETag behavior remain intact. The combined combat catalog test observes two batches total: admin slots and published fields.

No indexes were added or removed. The existing KV schema supplies the key primary key, a prefix-pattern index, and a partial expiry index. No production `EXPLAIN ANALYZE`, index-usage statistics, or database latency measurements were available; there is no evidence here supporting an index migration.

Player saves, battle state, currencies, inventory, claims, and ownership were not newly cached. Required authoritative rereads, transaction/lock ordering, CAS retries, settlement receipts, and recovery paths were retained. The final audit also discarded a proposed cache-invalidation fix after finding that the invalidation helper had no production callers.

## 4. Network optimizations

- Full roster: one travel-triggered request eliminated per sector change; no background polling; overlapping polls are prevented; retired account/session reads are cancelled.
- Bloodline gallery: startup request eliminated; its five-minute poll runs only while the archive is open. No additional freshness cache was added.
- Shared screen polling: background timers stop and foreground events cannot stack another returned async request. Errors recover on a scheduled interval rather than recursively retrying.
- Database-to-server traffic: duplicated admin-slot payload transfers and independent per-row reads are replaced with batches.
- Browser response contracts and image quality are unchanged. No claim is made that HTTP payload bytes for a full roster or save have shrunk.

## 5. Frontend and startup

The traced startup path is `main.tsx` → live-capability provider and App shell → saved identity/session restoration → parallel own-save/battle-lock recovery → versioned character hydration → current screen and its image categories. App's normal world/game-state polls remain gated by character, visibility, capability admission, and restoration state. Shared admin definitions remain post-restore data; the bloodline gallery now waits for its actual consumer.

The production manifest confirms `AdminPanel`, `BloodlineMaker`, `WorldMap`, `CentralHub`, `PvpBattleScreen`, and `PetColiseum` are dynamic entries outside the initial import graph. Three.js and Sentry also remain lazy. Existing pointer-down route warming, on-demand story JSON, image manifests, and compressed audio delivery were retained. No additional speculative prefetching or artwork conversion was necessary.

| Measurement | Initial measured build | Final measured build |
|---|---:|---:|
| Initial JS/CSS graph, raw | 1,450,024 B | 1,450,633 B |
| Initial JS/CSS graph, gzip | 383,724 B | 383,982 B |
| Initial files | 18 | 18 |
| Budgeted product JS/CSS, raw | 8,179,489 B | 8,179,930 B |

The bundle is effectively unchanged: the bounded polling machinery adds 609 raw startup bytes. This pass's startup benefit is request removal and reduced work, not a bundle-size reduction. All existing size gates pass; this pass changed no size budget. Global CSS still measures roughly 592 kB raw / 116.5 kB gzip.

The reproducible CPU benchmark is `node --import tsx scripts/benchmark-roster-merge.mjs`:

| Incoming players | Original median | Optimized median | Instrumented name reads, old → new |
|---|---:|---:|---:|
| 500 | 7.378 ms | 0.089 ms | 235,025 → 530 |
| 2,000 | 122.629 ms | 0.215 ms | 3,938,525 → 2,030 |

These are nine-run medians after warmup on local Node 24.15.0, with identical output asserted. They are synthetic CPU measurements, not Android frame-time or production API measurements.

## 6. MMORPG systems

| System | Result |
|---|---|
| World traversal | Sector movement no longer refetches the full roster. Map selection retires obsolete guard reads. Dynamic travel, ownership, and movement authority remain server-owned. |
| Combat loading / PvE | Shared definition reads are deduplicated and batched. Tower and Clan Boss party snapshots require fewer reads. |
| Combat actions / PvP | Engines, move/version validation, active battle state, and target authority unchanged. Existing action/lease regression suites exercised. |
| Post-combat | Receipt, reward, save-version, recovery, and compensation ordering preserved. Era contribution aggregation is cheaper; no reward is acknowledged earlier. |
| Inventory / equipment / shops / bank | Inventory and economy transactions unchanged. Shared item-definition reads benefit from batching, including tombstones and player-forged item exclusion. |
| Jutsu / bloodlines / legacies | Jutsu catalog reads share the combat batch. Bloodline archive loads on demand. Era totals retain exact-once ledger handling. Training/ownership mutations remain unchanged. |
| Pets / Home / Barn / breeding | Polling in related lobbies benefits from the shared helper. No battle, breeding, ownership, trait, or progression rules changed. Existing bounded media/voice resources retained. |
| Missions / training | Profession mission polling cannot overlap or run hidden; display countdowns release resources. Claims, completions, and progression rates unchanged. |
| Clans | Chat, battle-list, party, and seal-pool polling improved. Clan Boss initialization batches independent data. Clan resources remain authoritative. |
| Village / Town Hall / hospital | Council and Town Hall polling share the safer scheduler. Healer-list cleanup rejects retired responses. Treasury and heal transactions unchanged. |
| Sector wars | Shared frame batching and mercenary candidate batching reduce reads. Locked target validation and all war rules preserved. |
| Celestial / Battle Towers | Separate preflight and post-lease snapshots remain; each uses one batch. Ready-room/push and settlement contracts retained. |
| Shinobi Chronicle Showdown | No card rules, hidden-state projection, or action protocol changes. Existing rule/security tests remain part of the full suite. |
| Admin / creators | Privileged screen code stays lazy; normal-player combat pays less for reading authored definitions. No editor UI or publishing semantics changed. |

## 7. Mobile

Reduced radio activity comes from removing offscreen gallery traffic, hidden screen polls, and travel-triggered roster requests. Slow connections no longer create concurrent returned-promise polls. Roster merging does much less main-thread work, and hidden countdowns stop updating React. Both new user-flow tests passed in Chromium desktop and a 390×844 mobile/touch viewport.

No physical Android device, APK/Play Store package, constrained-memory hardware, or live mobile network was available. No Android FPS, battery, or long-session heap claim is inferred from desktop emulation.

## 8. Long-session stability

Fixed: an orphaned shared countdown interval; background poll timers; overlapping returned async polls; retired roster/gallery reads; and stale map-selection guard responses. Tests cover 100 clock mount/unmount cycles, rapid visibility changes, unmount during an unresolved poll, bounded error retry scheduling, and five minutes of simulated closed-archive time.

Reviewed existing resource ownership includes the presence singleton and handler sets, channel removal, module-scoped asset caches, capped claim outboxes, bounded sound voices/definitions, object-URL revocation, and server request/rate-limit retention. No additional accumulating interval or network/timer effect without a dependency array was found by the final AST inventory. These checks do not establish that every possible retained DOM/heap object is leak-free.

## 9. Verification

- Production build: **pass**, including server compilation, client TypeScript project build, story-content validation, Vite, legal prerender, dist verification, and size gates.
- Targeted combat/catalog/party/era group: **556 passed**. Targeted mercenary/content-contract group: **34 passed**. Final performance/cache handler checks: **10 passed**. Poll, countdown, and roster tests also pass.
- Browser checks: **4 passed**, desktop and mobile; archive on-demand lifecycle and zero extra full-roster requests during travel.
- Full regression run: **8,847 passed / 1 failed**, with zero cancelled tests. The baseline had **8,830 passed / 1 failed**. Both failed only at `shinobij.client/src/lib/pet-duel-stage-director.test.ts:97`, “Storm Focus should resolve from a visible distance break.” The failing test and implementation were not changed. This run included three additional tests for the subsequently discarded cache-invalidation proposal; the restored original cache was then rechecked successfully in the final ten-test handler/cache group.
- Lint: **changed-file lint passes**. The full checkout reports **23 existing errors** in untouched files and one existing warning in `chroniclepreview.tsx`. The affected files match HEAD. Three warnings introduced by now-obsolete polling suppressions were removed. Existing errors concern `NindoEditor`, `PetWarfrontRite`, `PetWarfrontRiteStage3D`, `pet-duel-cinematic`, and `AdminLegacyPanel`.
- Existing warnings: Vite's future native config-loader compatibility warning; the product JS/CSS size advisory below its enforced ceiling; Babel's large-file note for `PetColiseum`; terminal color-environment warnings during browser testing.
- Dependencies already existed and were reused by the repository build script. The sandbox initially blocked Node/esbuild process spawning; checks were rerun with the required execution permission. No dependency versions changed.

The final repository-wide hotspot search covered `useEffect`, intervals/timeouts, listeners, subscriptions/channels, SQL, Supabase, fetch/axios, promise concurrency, map/filter/sort, and production logging. AST inventory: **1,683 runtime source files, 739 effects, 263 loops containing awaits**. The broad textual search matched **6,838 lines in 998 files**. No `SELECT *` or axios call was found in the searched runtime source. Remaining serialized waits were reviewed for retry, lock, settlement, or infrequent maintenance ordering rather than blindly parallelized.

Local raw logs, the inventory, and benchmark JSON are under `.tmp/performance-gauntlet/`. Regression tests and the benchmark script are retained with the source; logs are local artifacts. Changes remain uncommitted.

## 10. Remaining performance debt

1. **Full public roster and bloodline generation still scale with registered saves.** The server caches/projections reduce repeat work, but rebuilding these views still reads the registry and many complete save blobs. Pagination or dedicated derived records would require coordinated consumer/freshness changes. Actual production row counts and payload profiles are needed to choose that migration.
2. **Global CSS and the aggregate product remain large.** The size gates pass, privileged and 3D routes are lazy, and initial bytes did not materially grow. Further splitting of global styling needs route-wide visual/cascade validation; no styles were moved blindly in this pass.
3. **Production presence remains single-process.** The current in-memory presence interface and deployment invariant are explicit. Horizontal scaling requires shared presence infrastructure; no multi-instance deployment is certified here.
4. **The existing pet-stage test failure and lint errors remain.** They prevent claiming a clean release gate. Changing unrequested presentation/rule code or suppressing errors to turn the checks green would not be a performance optimization.
5. **Production and device profiling remain outstanding.** Live database plans, endpoint p95/p99 and payload histograms, throttled Android startup, background recovery, and hours-long heap traces were not available locally. No unmeasured improvement is presented as a production latency result.
