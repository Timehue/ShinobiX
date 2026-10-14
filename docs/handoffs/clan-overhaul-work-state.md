# Clan overhaul — completed work and verification

Last reconciled: 2026-10-13. This checkpoint replaces the historical progress/handle lists. Their retained copy is `artifacts/clan-overhaul/work-state-history-2026-10-13.md`.

## Status and authority

The authorized overhaul is implemented and checked in this worktree. No verification process remains active. No commit, push, PR or deployment was performed.

Tyler authorized completing the plan, making needed artwork, tying its systems together, balancing clans/Exchange and double-checking the work. The controlling simplification is four rival-clan queues plus a physical golden shrine with random pet/card/combat rules. Any eligible clan can be declared on. Compound raids, ward objectives, offline AI defenders and village-war organization remain outside this scope.

Canonical ownership:

- [Overall plan](../clans-and-clan-wars-plan.md): wider clan meaning, Hall, projects, investments, identity and Exchange.
- [War design](../clan-war-overhaul-design.md): lifecycle, eligibility, queues, scoring, shrine, defenses and rewards.
- `shared/clan-war-campaign.ts`: campaign parameters, frozen eligibility, budgets, matching and safe projections.
- `api/clan/war/_campaign-*`, the registered queue route and existing PvP/MPvP/pet/Chronicle hosts: server admission, trusted outcomes, recovery and settlement.
- `shared/clan-program.ts` and registered `api/clan/program.ts`: verified Hall goals, material project and assignments.
- `shared/clan-exchange-catalog.ts`: server/storefront catalog and new-purchase prices.
- `shared/clan-campaign-history.ts` / `clan-campaign-standings.ts`: campaign history, quarterly/lifetime prestige and shared ranking ties.

## Delivered baseline

- **Lifecycle:** seven-day-old clans with four eligible level-15 members; membership 48 hours and activity within seven days. Leadership declares using personal or pooled Honor Seals, 100 normally / 90 Warmonger. Both clans are reserved atomically. Preparation lasts 24 hours and conflict 72 hours. One campaign per clan, three-day recovery, seven-day pair cooldown. Frozen roster, departure credit, preparation withdrawal, active surrender, dissolution and exact-instance admin service recovery are covered. Legacy HP wars/battles/rewards retain their rules.
- **Queues:** shinobi 1v1, shinobi 2v2, pet Showdown and Chronicle. Opposing humans queue, confirm readiness and use existing battle hosts. Legal builds seal at admission. Normal wins grant 100, or 200 for a two-player team. Each clan has 20 normal player slots per war-day, each member five across all modes. No unanswered-inbox or offline points.
- **Golden shrine:** six sealed appearances, one random two-hour window in each twelve-hour block, balanced shuffled pet/card/combat specialties and valid wilderness sectors. Thirty-minute general notice; purchased Scout levels improve intelligence. Physical world entry, a clan-bound 12×12 courtyard, distinct room/presence leases, native movement and battle return are implemented. Five shared matches per appearance, two/member; a win gives 100 bonus points using a separate budget. Original two golden-shrine WebPs were reused from the independent village-war worktree, which was not modified.
- **Rewards:** 25 personal CP per completed scored match, another 25 for a win, 75 for participating campaign winners; the existing shared 1,000-CP weekly cap applies. Clan XP is 1,200 winner / 400 other side, with the capped purchased War Room bonus. Played winning participants earn one unique Legendary War Crate. Existing 20% one-scroll scored shinobi 1v1 drops include shrine combat; late/unscored fights do not pay. Inventory, CP and currency ledger commit with protected receipts. Empty/service-canceled campaigns grant no competitive completion rewards.
- **Logistics and identity:** optional leadership activation spends 30 rations once per war-day, seals +10% match CP at admission and changes no score. Twenty-four campaign records, contribution recognition, quarterly prestige (3 win / 1 draw), equal-record shared ranks and permanent banners after three seasonal victories are implemented.
- **Hall:** Overview is the default opening tab, with notices, activities, war state, own mentoring and voluntary/leadership-coordinated assignments. Eight verified campaign matches earn 300 shared Clan XP; three banked cooperative boss assaults earn 450. A weekly 40-common-material project caps members at ten, earns 500 Clan XP and unlocks a permanent decoration after four completed weeks. Repeat-safe material funding uses the registered debit saga; retained payments preserve their original week and departure recovery. These goals create no new personal CP faucet.
- **Exchange:** shared prices are Chūnin chest 350 CP, Honor Seals 650, weapon cache 1,800, armor cache 2,200, Kage's Coffer 1,500 and one-time permanent crest frame 500. Existing gates, odds, gear-step rules, limits and old paid recovery terms are preserved. The purchased cosmetic is visible in Hall/Exchange and survives a lost response/reload.

Meaningful final fixes include actual four-player battle activation, safe account-bound viewer caching, trusted result reconciliation before closure, exactly-once service refunds/crates, legitimate `constructor` / `__proto__` names, monotonic closure timestamps and correct late-fight scroll response projections. No SQL/schema migration or auth/rate-limit policy change was required.

## Final verification

Results are separate runs and overlap; do not add their counts as unique coverage.

| Check | Terminal result | Evidence under `artifacts/clan-overhaul/` |
| --- | --- | --- |
| Complete final root suite, all three sequential shards | **15,040 passed, 24 database-dependent skips, zero failures/cancellations**; 15,064 total. Shards 5,016 + 4,833 + 5,191. | `unit-final-1.log`, `unit-final-2.log`, `unit-final-3.log` |
| Full release build, dist verification and size gate | **Passed.** Product JS/CSS 8.80 MB raw / 2.56 MB gzip; combined tracked product 9.53 MB / 2.76 MB. Existing near-budget warning remains. | `build-release-verified.log` |
| Server build after final server-only reward projection fix | **Passed.** No frontend artifact change. | `server-final-reward.log` |
| Full frontend lint | **Zero errors**, 21 existing warnings. | `lint-certified.log` |
| Release assets | **Passed:** 141 achievement references, 241 badges, 21 Pet Home WebPs. | `release-assets-final.log` |
| Full strict combat matrix | **20 passed, 10 configured skips**, six projects including WebKit; both strict flags enabled. | `combat-certified.log`, `combat-results/` |
| Final rebuilt live clan journey | **3 passed, 1 intentional API-only mobile duplicate skip.** | `final-clan-live.log`, `final-clan-results/` |
| Affected realtime field presence and sector-war journeys | **4 passed.** | `presence-war.log`, `presence-war-results/` |
| Clan/Exchange UI across all seven browser/viewport projects | Initial **41 passed, one cold Firefox initial-load miss**; entire Firefox file then **6/6 passed** without product or timeout changes. | `final-clan-ui.log`, `clan-firefox-recheck.log` |
| Complete stable responsive/accessibility gate | **2,129 passed, 781 configured skips, 4 flaky passes, 4 failures**; full 2,918-case run completed, exit 1. The four terminal failures were story PNG saves reporting UNKNOWN-open; gameplay assertions did not fail. | `responsive-stable.log`, `responsive-stable-results/` |
| Isolated responsive failure families on the same final frontend | **19 passed, 5 configured skips, zero retries**, including every earlier failure: compact/mobile story flows, controller release and WebKit mobile navigation. Used the existing story artifact-directory override. | `responsive-isolation.log`, `responsive-isolation-results/`, `story-recheck-evidence/` |

The full responsive run's four flaky cases were compact controller release, compact pending-story archive, mobile Stormveil screenshot saving and WebKit mobile navigation's transient pending-session access-control console message. All rechecked successfully. Screenshot-save failures were not established as disk-space or permissions defects: the directory was ordinary, files existed, a write probe succeeded and C: had 132.6 GB free. Their isolated captures succeeded under this task's artifact root. The original full gate is not retrospectively claimed green.

The live desktop/mobile journey used real registered QA accounts and authoritative battle results for declaration/payment replay, all four battle hosts, physical shrine/mode/return, separate budgets, weekly contract/project, closure/reward replay, departed winner's crate, duplicate/loser refusal and rematch recovery. Its desktop-only API case checked admin service cancellation, exactly-once fee refund and a new campaign instance. QA helpers are mounted only with NODE_ENV=test + disposable memory KV + CLAN_CAMPAIGN_QA=1 and existing full admin authority; no fixture-created score or currency.

Desktop/mobile Hall, Exchange, preparation and golden courtyard renders were inspected, including crest-frame delivery and responsive scrolling. No horizontal overflow was observed. Canonical source links resolve and final diff checks passed.

## Evidence cleanup and limits

All 88 historical audit files rewritten by the test suites were preserved under `regression-evidence/` and restored to their initial clean state. Intentional runtime-mode documentation remains. The two completed owned preview snapshots (14311/29131) were removed after their runners exited. No other chat, process or worktree was changed. A deliberately stopped earlier responsive run used mismatched source/dist manifests after a mid-run rebuild; it is excluded from final evidence.

Database-dependent tests did not exercise a throwaway live Postgres here. The passing strict combat run preceded only later name-counter/server reward fixes that do not change ordinary-name screen layout. Automated tests and source arithmetic do not establish human enjoyment, queue population, timezone accessibility or fair matchups between unequal builds. Those are measured player-tuning topics, not unfinished implementation. The local full responsive command still recorded exit 1 for capture failures, with all affected cases subsequently passing in isolation.

The implementation and required local checks are complete. Owner review, human pacing sessions and deployment are subsequent actions.

## Icon polish followup

Tyler subsequently requested clearer Clan Hall icons and corrected the generated headband emblems. Seven new transparent 256px WebPs now cover mentorship, roster, boss, boosts, Exchange, notices and chat. Mentor/student and roster forehead plates are plain; the notice seal is also unmarked. Upgrades uses the existing anvil and Guard the existing shield. Overview activity icons are 32px. Changes are limited to `GameArtIcon.tsx`, `ClanOverview.tsx`, `ClanHall.tsx` and the new `public/ui/clan-icons/` assets; backend/gameplay rules are unchanged. The original root unit census above predates this icon-only followup.

New build/dist/size, full lint (zero errors / 21 existing warnings), assets, three existing Hall navigation checks and all 21 Hall browser cases passed. The new full strict combat matrix passed 20 cases with 10 configured skips in 34.5 minutes. The full parallel responsive run completed with 2,103 passed, 781 configured skips, 17 failures and 17 flaky passes, exit 1. A fresh single-worker recheck passed 70 checks with two configured skips and zero retries, covering all 34 original failure/project pairs. Timeouts did not reproduce in that recheck; the original parallel command is not claimed green. No unrelated auth code or test waits were changed. Both source/preview manifests matched throughout.

Evidence, saved artwork paths, generation prompts and exact limits are in `artifacts/clan-icons/verification.md`, `manifest.json`, `prompts.md`, `recheck-coverage.json` and their linked captures/logs. Eight test-generated historical audit snapshots were preserved and restored, and the three completed owned preview snapshots were removed. No verification runner remains active; no deployment was performed.
