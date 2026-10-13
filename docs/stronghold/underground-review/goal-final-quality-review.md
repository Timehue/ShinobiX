# Stronghold and Hollow Gate quality completion review

October 12, 2026. This follows the original underground expansion, level-50 entry,
Anbu recovery/queue fixes, and the [real-Postgres CI run](postgres-integration-review.md).

## Current improvements

- Small-phone cave depth progress is a readable numbered trail. Full floor names
  and traversal status remain available to screen readers; the current floor name
  stays in the heading. Lore remains expandable through a 44px touch target.
- The closed map/journal is a corner control on phones and landscape. Opening it
  still exposes the complete floor map, objectives, legend, pet status and journal.
  A 320×568 phone's ordinary playfield grows from 234px to 314px (34%). Taller
  phones use 58% of viewport height. Controls remain at least 44px and on screen.
- Keys and banked shards use the game's shared compact-number convention, with
  precise values in titles and accessible labels. At-risk loot uses the same
  currency preview and gives its status belt reserved space, including landscape.
- First-entry Anbu checks use a neutral loading message; a known saved raid retains
  its reconnect message. The asynchronous recovery protocol and attempt rules are
  unchanged.
- Terrain raster bounds, backgrounds, fog masks and scenery follow the viewport
  with two tiles of movement overscan. Unmeasured views defer terrain; overview
  mode and floor changes mount the correct board without a distant camera tween.
  SVG coordinates and pattern anchors remain in world units, so room art, masks,
  collision and actor positions retain their alignment. No room or tile is made
  smaller. Invisible collision markers no longer request SVG shadow filters.
- Real-Postgres test modes now cover authenticated multiplayer and underground
  APIs. All use new loopback-only clusters and canonical SQL definitions, with
  automatic shutdown and removal. No production database or player is involved.

## Requirement audit

| Requirement | Authoritative implementation and verification |
| --- | --- |
| Shared dungeon strongholds, twelve connected purposeful rooms | `shared/sector-stronghold.ts`, `shared/underground-floor-features.ts`, `UndergroundSectorTerrain.tsx`; all twelve room paintings and their exact collision bounds reviewed in Chromium/WebKit. |
| Entry 50; Anbu raid 100; own village vault protected | Shared minimums, saved-level API admission, WorldMap entrance projection, Anbu challenge; executable boundary/defender coverage in the complete CI suite and entry-level browser matrix. |
| Existing combat/threat rules and real collision | Server-owned successful steps add 4% threat; step 25 seals a patrol. Walls/architecture spend nothing when rejected. Migration preserves owed threat. API tests and authenticated HTTP checks exercise those paths. |
| Multiplayer, interior/exterior isolation, normal/Obsidian rewards | Four actual authenticated two-browser scenarios on Postgres 16.15 cover peer updates, reconnects, collision, both combat joins, combat movement locks, KO, settlement and replay. 24 players per stronghold each see 23 peers and retain 24% threat after six steps. |
| Village/sector war, garrison, Card/Pet contests, mission/Legacy/Era hooks | `WorldMap.tsx` passes the existing selected-sector attack/contest/garrison handlers into `AnbuVaultRaid` and `StrongholdExplore`. Actual API regression tests cover contest admission/scoring and war-holder rules. Anbu reports retain their capped war-resource, receipt, mission, Legacy and Era authorities. |
| Anbu async snapshot, interrupted admission, queue exclusion | Eight cases run against real Postgres: lost start/commit acknowledgements, preserved concurrent combat, midnight attempt accounting, queue exclusion, and owed patrol recovery. Direct SQL confirms durable records in the Anbu fixture database. |
| Private Hollow Gate, five levels, event Rifts | Standard runs stay solo and five floors. Existing sealed Rift dimensions/depth/bosses/signals/loot remain authoritative. All five standard depth layouts and Rift UI are exercised on mobile; the complete API suite covers generation, progression and receipt/recovery rules. |
| Good travelers and human hunters with existing rules | Seven real-Postgres API cases prove bounded sealed rosters, immutable origins, gift proximity/one-use receipts, Treasure Sense, hunter contact/combat/reward replay, collision, resume and safe legacy-floor upgrades. NPCs use the player's circle-pin component; hunters consume existing battle identities. |
| Professional thematic art placed with purpose | Coherent overhead military rooms have built-in guard, barracks, armory, stores, training, archive, officer, cistern, seal and treasury bays. The cave has ancient rock, water seams, lanterns, perimeter formations and distinct depth palettes. No floating stronghold doors or oblique furniture stamps render. Original prompts and source paintings remain in `docs/art/fortress-room-maps-v3.json`. |
| Mobile input, modal recovery, accessible controls and smooth rendering | Actual components are tested in Chromium/WebKit at 320×568, 390×844, 430×932 and 844×390, including touch movement, dialogs, gifts, intros, map/journal, exits and reauthentication. Geometry tests independently prove raster cropping preserves exact screen coordinates and full viewport coverage. |
| Full suite, builds, lint and unchanged release budgets | Final gate results are recorded below after completion. |

## Evidence

| Check | Result |
| --- | --- |
| Final twelve-room/integration browser matrix | 88 passed; no page/image errors; exact art/collision alignment |
| Real-Postgres authenticated multiplayer | Four two-browser scenarios and two 24-player loads passed; no page errors |
| Real-Postgres Anbu and cave API integration | 15 passed, zero failed/cancelled/skipped; direct SQL persistence verified; clean shutdown |
| Camera/projection invariants | 10 passed, including three new raster-bound/projection checks |
| Final complete mobile and movement checks | 88 passed; 0 page/image errors; 32 walking samples, highest p95 28ms |
| Final stronghold host/Arena and recovery checks | 52 passed; 0 page errors |
| Final five-depth layouts including high balances/loot warnings | 30 passed; 0 page/image errors |
| Final level 50/99/100 and friendly-village UI boundaries | 20 passed; 0 page/image errors |
| Final full CI with Postgres required | **14,784 passed; 0 failed, cancelled or skipped**; 1,708 suites; exit 0 |
| Final client/server builds and focused lint | Passed |
| Full client lint | Passed; 0 errors, 17 existing warnings |
| Tooling handoffs, distribution, deployment, rollback, mission catalog, release assets | Passed |
| Normal and public-production-variable bundle checks | Passed with unchanged budgets |

The Postgres multiplayer loads include 120ms artificial response delay. Local
p95 request times are 282.5ms (normal) and 292.3ms (Obsidian). Mobile two-browser
walking p95 intervals are 16.7–16.8ms under 4× Chromium CPU slowdown and 30ms in
WebKit. These are measured local diagnostics, not deployed capacity certificates.

The production configuration emits 9,537,365 bytes of budgeted product JS/CSS
under the 9,550,000-byte limit. Initial JS/CSS is 1,423,118 bytes raw and 395,352
bytes gzip (limits 1,450,000 and 396,500). The distribution remains 531.8 MiB
under its unchanged 532 MiB ceiling; the server entry is 56.9 KiB.

The broader mobile matrix initially exposed off-screen controls and WebKit frame
stalls. Those failures are retained as diagnostics. The existing 100ms p95
movement limit remains unchanged. Touch targets are selected before sampling;
timing measures actual taps in an explicitly foregrounded page. Final measurements
include visibility/focus and rendered tile counts.
The final mobile matrix's longest individual interval was 427ms despite its 28ms
maximum p95; those short local samples are diagnostics, not a promise of perfectly
uniform physical-device frame pacing. No frame threshold was increased.

Evidence: [room matrix](goal-final-rooms/results.json),
[multiplayer](goal-postgres-multiplayer/results.json),
[multiplayer log](goal-postgres-multiplayer-final.log),
[real API log](goal-postgres-api-final.log),
[depth layouts](goal-final-depths/results.json),
[mobile matrix](goal-final-mobile/results.json),
[final WebKit walking](goal-webkit-walking/results.json),
[Anbu/Arena UI](goal-final-anbu-ui/results.json),
[entry/raid boundaries](goal-final-entry-levels/results.json),
[full CI and database cleanup](goal-final-full-ci.log),
[server build](goal-final-server-build.log), [client build](goal-final-client-build.log),
[client lint](goal-final-client-lint.log), [distribution](goal-final-distribution.log),
[production size](goal-final-production-size.log), [handoffs](goal-final-handoffs.log).

## Repeat and scope

From the repository root:

```powershell
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin --stronghold-multiplayer
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin --underground-api
```

From `shinobij.client`:

```powershell
node --import tsx scripts/underground-sector-browser-qa.mjs --quick --mobile
node --import tsx scripts/underground-sector-browser-qa.mjs --mobile --depths-only
node scripts/stronghold-browser-qa.mjs
```

Room screenshots mount the actual components and styles with deterministic UI
fixtures. Multiplayer uses actual authenticated HTTP handlers; the final combat
board is arranged deterministically for KO/settlement. API interruption tests
inject lost acknowledgements and concurrent advances. This review verifies local
code, assets, persistence and emulated browser behavior. It does not assert a
hosted GitHub workflow run, deployment, physical-device frame-rate certificate,
or a universal AAA production certification.

The completion audit found no remaining implementation or local verification
item in the requested upgrade. Stronghold entry stays 50, raids stay 100, and
Hollow Gate remains private. All final test/database/browser jobs completed;
the disposable servers and clusters were stopped and removed. No deployment,
Git commit or pull request was requested or created in this pass.
