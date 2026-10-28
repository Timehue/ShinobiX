# Progression, combat and economy audit — October 28, 2026

Status: audit and approved sector-purse receipt change complete, including backend regression validation and final live Express browser checks. Full-run failures and their targeted reruns are detailed below. Scope authorized by the owner: all 100 legacy paths and their signatures, global elemental jutsu, Pet Colosseum, daily ryo and current shop/crafting prices, sector-war combat, and 10,000 starting card health.

## Evidence boundary

Audit the current working tree based on `b2e51b0e4`, including existing staged combat and economy work. Those changes predate this audit and must be preserved. Code defaults and deterministic simulations establish implementation behavior; they do not establish production income, live admin overrides, or human competitive win rates. No deployment or SQL migration is part of this audit. The owner separately approved the optional persisted receipt field described below.

This is an audit snapshot, not a replacement source for game rules. Runtime files linked below remain authoritative. No SQL schema, authentication, base payout-rate, pet-stat, shop-price or crafting-fee changes were made by this audit. New human sector-war receipts now gate purse credit on opponent eligibility.

## Changes and decisions

| Area | Finding | Action |
| --- | --- | --- |
| Legacy signatures | Mythic Sundered Seal (`gate-opener`) duplicated legendary Gatebreaker's combat payload. Mythic Last Bastion duplicated legendary Frostbound Shield. | Give direct mythic damage a 42 EP tier; add 40% Absorb to Last Bastion. |
| Legacy movement | The live Move normalizer caps damage at 40 EP. Authoring 42 would silently normalize back to 40. | Keep World's Edge Descent at 40 EP and give it range 5 instead of 4. |
| Global jutsu | Hellfire Mirage's Ignition rider was 14%, while the same AOE rider in other disciplines was 25% for identical budgets. | Raise its Ignition to 25%; regenerate the server catalog. |
| Pet Colosseum | Current ranked play uses real owned pets and progression-v3, not the old normalized competitive roster. Stats, equipment and traits affect live resolution. | Preserve progression; add direct trait-effect regression coverage. |
| Ryo economy | Today's prices provide material currency sinks; old resale bases prevent price increases minting extra ryo through liquidation. Supply crafting does not create a fee-to-resale profit loop. | Keep today's shop prices and crafting fees. |
| Sector wars | Audited pet, card and PvP paths have authoritative resolution, contest-instance checks and retry protection, but purse receipts lacked defeated-account eligibility evidence. | Add server-derived purse eligibility to new human battle receipts; preserve territory scoring and historic receipts. Verify 10,000 LP through the real sector-card handler. |
| Card matches | The requested starting-health increase belongs in the shared engine contract. | Set new matches to 10,000 LP; rules/tutorial derive the number from the shared contract. Preserve stored health in existing matches. |

## Legacies: acquisition and rewards

The roster is 15 basic, 50 rare, 25 legendary and 10 mythic legacies. All 100 definitions and signatures were inventoried in the [complete audit inventory](balance-audit-2026-10-28-inventory.md). Eligibility is checked against [the server definitions](../api/_legacy-defs.ts), their producer/threshold tests and the existing trial-cadence checks. The minimum character level remains 50. Requirements, progress counters and trial difficulty were not changed. Qualification floors are AND requirements; weighted progress ranks eligible offers and cannot waive an unmet floor. Village/story affinity is a tie-breaker, not a secret bypass.

The checked acquisition constraints include live producers for first clears, weekly-boss standings, missions, PvE kills, war contribution and exploration; bounded client-mirrored statistics; escalating weighted rarity requirements; and trial feasibility. The exploration requirements stay within the mirrored 2,500-tile ceiling. `sectorDiscoveries` is a repeatable receipt-backed activity counter, not a count of unique map sectors. Treating it as the latter would incorrectly label its requirements impossible. First-clear and boss-related requirements have server-side award paths.

The existing rarity tests enforce stronger proof requirements rather than simply multiplying one grind counter. Mythic acquisition combines substantial achievements; trial cadence checks bound mythic plans to 20–365 standard days and fresh trials to 30 days. These are design assumptions, not observed player completion times. Competitive standings and timed events can take longer for a particular player.

The corrected signature ladder is:

| Rarity | Direct damage EP | Ordinary capped tag potency | Notes |
| --- | ---: | --- | --- |
| Basic | 36 | 30% | Entry signature budget. |
| Rare | 38 | 35% | A-rank effect limits. |
| Legendary | 40 | One 40% tag, remaining capped tag 35% | S-rank access with a bounded second effect. |
| Mythic | 42 | 40% | Strongest direct signature budget; movement uses 40 EP plus extra reach. |

Wound has its separate 25/30/35/35 potency ladder. Flat/binary effects such as Shield are not ordinary percentage buffs. Last Bastion now combines Shield, 40% damage reduction and 40% Absorb; the runtime still applies normal timing, stacking and mitigation rules. The new regression rejects a mythic that is a mechanical duplicate of a lower-rarity signature. Same-tier signatures may share mechanics while rewarding different achievement paths. Higher rarity is a stronger reward budget, not a guarantee that every mythic is the best tactical choice in every matchup.

Authoritative content: [client signatures](../shinobij.client/src/data/legacy-jutsu.ts), [generated server signatures](../api/pvp/_legacy-jutsu-catalog.ts), [tier regression checks](../api/_legacy-jutsu.test.ts).

## Global elemental jutsu

All 100 elemental techniques, plus universal Flicker, were inventoried. Each of Earth, Wind, Lightning, Fire and Water has 20 techniques: five for each discipline, with two attacks and three utility techniques. Each discipline/element kit has one area attack. Direct attacks use 36 EP and 60 AP; utility uses 40 AP; both have seven-round cooldowns. Global control tags and damage-dependent tag legality were checked against the canonical runtime vocabulary.

Stored catalog costs are authoring values. Live combat applies [v2 resource costs](../api/_combat-resources.ts), scaling with level and charging one discipline bar: chakra for Ninjutsu/Genjutsu, stamina for Taijutsu/Bukijutsu. Comparing the stored 250/125 values to a live player's two resource bars would be misleading. The corrected diagnostic explicitly uses the same v2 cost function as session sealing.

Hellfire Mirage's weaker Ignition rider had no compensating difference in AP, damage, cooldown, area or resource cost. Its 14% → 25% correction restores the same rider budget used by the other disciplines. A regression checks equal budgets and like-for-like area riders without equating different effects such as Wound, Poison and Ignition.

Thirty-four pure self-buffs carry older `OPPONENT` catalog metadata. The live action planner determines whether an opponent is affected from damage and canonical tags, so these cast as self-buffs without imposing an opponent-range gate. This metadata is not evidence of broken targeting; no broad target rewrite was made.

The first 720-fight diagnostic mistakenly retained catalog resource costs. Its results are superseded and must not support balance claims. The final pure-global comparison ran 1,440 deterministic fights per version: three levels (10, 50, 100), two gear/stat profiles per discipline, all element pairs and mirrors, swapped seats/openers, maximum level-legal mastery, and live one-bar resource costs. Removing the fixture's bloodline also resets its cached damage multiplier to 1; the earlier cost-corrected intermediate fixture still retained 1.1 and is not the source of the final table. The baseline uses the old Ignition value only in the simulated copy; production source is never toggled for a comparison. The pilot has five mono-element techniques plus Flicker, not a complete player loadout. This is a diagnostic for restricted-kit pressure and stall behavior, not proof of optimal human PvP balance.

An additional 480 mirror fights measure actual seat and opener results: seat p1 scores 50%, while the opener scores 48.75% overall. That aggregate hides substantial initiative sensitivity: of 120 deterministic level/profile/element controls, the opener takes every result in 58, loses every result in 61, and splits one. Of these mirror fights, 104 reach the round cap. The old identity-based mirror score was symmetric by construction and could not establish initiative fairness. These results warrant opener-specific follow-up; they do not justify calling every mirror balanced. The main final run has 310 round-cap verdicts out of 1,440 fights (21.5%). Endgame score ranges across the two profiles are below; each profile supplies only 16 non-mirror deterministic games per element, with draws worth half a point. Repeated seat swaps are controls, not independent human samples.

| Level 100 kit | Earth | Wind | Lightning | Fire | Water |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ninjutsu | 50% | 0% | 50% | 87.5% | 62.5% |
| Genjutsu | 25% | 87.5% | 37.5% | 12.5% | 87.5% |
| Taijutsu | 75% | 12.5–50% | 50–62.5% | 75–87.5% | 0–12.5% |
| Bukijutsu | 25–50% | 12.5–37.5% | 12.5% | 75% | 100% |

**These results do not certify the global roster as evenly balanced.** Priority warnings are Water Bukijutsu dominance at levels 50/100, Earth Ninjutsu at level 50, and Wind Genjutsu's endgame stall advantage. Its shield/absorption/reduction package wins every Wind-versus-Fire sample by the 25-round judge, rather than by a knockout. The pilot does use Clear, Cleanse and healing, but values future statuses heuristically and does not plan a human combo rotation. Increasing Fire's Ignition improves its level-50 Sustain profile from 0% to 12.5% and Control profile from 12.5% to 37.5%; its level-10 scores are unchanged. The correction fixes an unequal rider budget without resolving every restricted-kit matchup.

Retain the narrowly justified rider correction. Further numerical tuning should be checked with complete legal loadouts and observed skilled play, separated by level and discipline, especially the three warnings above. A published reference supports this separation: Riot's [Champion Balance Framework](https://www.leagueoflegends.com/en-us/news/dev/dev-champion-balance-framework/) evaluates multiple skill populations, and its [framework update](https://www.leagueoflegends.com/en-gb/news/dev/dev-balance-framework-update/) compares predicted changes with actual post-change outcomes. Applying that principle here is an inference; Riot's MOBA thresholds are not transplanted into this RPG.

### Broader global-loadout sensitivity check

An additional **5,760 fights** tested fully populated global-only loadouts. The [equip-access rule](../shinobij.client/src/lib/bloodline.ts) permits same-element `Any` utility techniques from every discipline. The [live slot caps](../api/_entitlements.ts) are 12 for base players and 15 for Supporters. Each fixture retains its primary discipline's two attacks and three utilities plus Flicker. The 15-slot version adds every other same-element utility; each of three 12-slot versions omits one different off-discipline utility group. Every fixture asserts the exact slot count and unique IDs, and the 15-slot character carries the appropriate entitlement. Level, mastery, neutral weapon affinity, shared stats/gear, live resource costs and swapped seats/openers remain controlled.

The larger kits materially change the rankings. Scores below are deterministic matchup scores with draws worth half a point, not player population win rates. Twelve-slot ranges span both stat/gear profiles and all three utility omissions; 15-slot ranges span both profiles.

| Diagnostic case | Six slots | Twelve slots | Fifteen slots |
| --- | ---: | ---: | ---: |
| Earth Ninjutsu, level 50 | 87.5% | 68.75–87.5% | 37.5% |
| Water Bukijutsu, level 100 | 100% | 25–100% | 37.5–50% |
| Lightning Bukijutsu, level 100 | 12.5% | 12.5–37.5% | 100% |
| Fire Genjutsu, level 100 | 12.5% | 0–75% | 37.5–50% |

There is no stable universal element ranking across these configurations. The original Water Bukijutsu warning is therefore a restricted-loadout finding, not sufficient evidence for a blanket Water nerf. Conversely, Lightning's 15-slot results and the broader sustain behavior remain warnings: the three 12-slot runs reach the round cap in 442/1,440, 436/1,440 and 452/1,440 fights; the 15-slot run does so in 568/1,440 (39.4%). These are deliberately utility-heavy mono-element global kits. Filling every legal slot does not make them representative of optimal player builds with bloodlines, legacies, multiple elements and different attack/utility mixes. The expanded evidence strengthens the decision to avoid broad numerical changes from one heuristic pilot; it does **not** certify complete competitive balance. Exact scores and reproducible modes are retained in the evidence snapshot.

Sources: [authored globals](../shinobij.client/src/data/jutsu.ts), [runtime catalog](../api/pvp/_jutsu-catalog.ts), [budget tests](../api/pvp/_global-jutsu-balance.test.ts), [reproducible diagnostic](../scripts/global-jutsu-balance-audit.mts).

## Pet Colosseum

The current owner-approved ranked contract is carried owned pets, two on the field and two on the bench, with their real levels, growth allocations, traits and equipment. [Ranked roster tests](../api/_pet-tactics/ranked-owned-roster.test.ts) and [arena admission](../api/_pet-tactics/arena-showdown.ts) establish that contract. The October 10 normalized-roster design note is historical and must not be used to erase progression.

The current progression-v3 probe covers all 161 species: **37,136 fights, 11,270 sealed fixtures, 128,508 action checks, 38 replay checks and 2,130 gear-bound checks**, with zero invariant failures and zero warnings. It covers level boundaries, natural growth, 1v1/2v2/3v3, benches, swapped seats, saved presets, authored kits, reallocation and extreme budgets. Its scope and fingerprints are retained in the local evidence report.

At level 100, legal ten-point reallocations demonstrate real contributions: vitality improves health in 644/644 physical and special scenarios; power improves damage in 610/644 physical and 624/644 special scenarios; guard reduces damage in 573/644 physical and 568/644 special scenarios; agility changes initiative in 146/644 scenarios. Unchanged cases are rounding/order breakpoints, with zero regressions. Speed does not need to change turn order against every opponent to matter.

Direct live-engine tests isolate traits from acquisition stat bonuses: Aggressive, Fateweaver and Lucky increase damage; Loyal earns more signature meter; Hollowborn heals from attacks; Swift crosses a close initiative breakpoint; Guardian improves guard; Battleborn starts with 25 meter; Boonbringer improves a matching partner combination without boosting a solo hit. Trait growth bonuses remain applied by canonical pet sealing. Existing readiness, charge and legal-action checks still apply.

No pet values were changed: the current engine gives progression and traits observable value, and the probes found no invariant failure warranting a numerical correction. This does not mean every species has a 50% win rate regardless of rarity, level or team composition. The older pet-tactics simulation was also run, but its 960 bouts and 480 signature checks cover a historical engine and are not used to certify current ranked play.

Sources: [current engine](../api/_pet-showdown/engine.ts), [new trait regressions](../api/_pet-showdown/trait-impact.test.ts), [progression audit](../scripts/pet-progression-balance.mts).

## Daily ryo and prices

There is no single honest daily-income number without player activity and production telemetry. The repository uses `A(L) = min(300, 20 + 4 × level)` ryo per active minute as a **pricing anchor**, not a guaranteed grant. These scenarios show its purchasing-power basis:

| Level | 30 active minutes | 90 active minutes | 240 active minutes | Daily login |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1,800 | 5,400 | 14,400 | 1,500 |
| 30 | 4,200 | 12,600 | 33,600 | 3,500 |
| 50 | 6,600 | 19,800 | 52,800 | 5,500 |
| 70 | 9,000 | 27,000 | 72,000 | 7,500 |
| 90 | 9,000 | 27,000 | 72,000 | 8,000 |

Actual reward-source checks establish separate conditional ceilings/scenarios:

A concrete gross-income example is ten highest-level-eligible hunt completions, one ordinary full-rate kill purse per hunt, and the daily login: **5,000 / 11,000 / 16,800 / 23,300 / 24,000 ryo** at levels **10 / 30 / 50 / 70 / 90**. This assumes those are within the first 50 AI wins, no reward bonuses, and no other income. Item sales can add ryo; supplies, feeding and travel-related costs reduce the net. This scenario is based on payout formulas, but does not claim a measured completion time.

- Ordinary AI wins pay full purses for the first 50 and reduced purses for the next 50, with a hard cap of 100. At levels 10/30/50/70/90, a 100-win day pays 4,350/5,600/6,850/8,100/9,350 ryo before special bonuses. That is not a typical 90-minute day.
- Hunter contracts and field/combat missions have independent daily pools. The base hunt cap is 20, with rank progression allowing 25; field and combat claims share 20. At level 50, twenty highest eligible hunt base payouts total 20,400, while twenty highest fetch base payouts total 61,000. Completion, travel, kills, mission bonuses and time still apply. Do not add kill receipts twice or count these caps as simultaneously achievable in the same short session.
- Ordinary safe expeditions yield 432/1,728/5,184 gross ryo per capped scout/forage/ruins day. A fully specialized Tamer with Boonbringer can reach 1,960/7,784/23,380 in the corresponding secure-return scenarios. The routes share the claim budget; these values must not be summed as three full-cap days. Pet levels, slots, restart timing and feeding costs matter.
- Bank interest is bounded at 5,000 ryo/day and requires the capped principal and maximum bank rate. It is not a new-player daily allowance.
- A credited shinobi PvP win pays 13.5 × the lower-level player's anchor (2,970 at level 50; 4,050 at level 70+); an engaged loss pays 40%. Same-pair credits decay 1 / 1 / 0.5 / 0.25 / 0, with account, level-gap, duration and engagement gates. Five full-credit level-50 wins against different eligible opponents would pay 14,850 ryo before bonuses; five wins against the same opponent do not.
- Sector-war purses settle per war rather than daily. The 200-point cap pays up to 13,200 ryo at level 50 or 18,000 at level 70+ for the winning side, at the default scale. Weekly bosses, village wars, one-time Academy grants, dungeon/tower runs and event rewards likewise have distinct cadences and must not be added as daily login-like grants. The [existing economy census](economy-rebalance-2026-10.md) records those broader sources; [the PvP purse](../api/pvp/_valid-fight.ts) and [sector purse](../api/war/_sector-purse.ts) were checked against their current implementations here.
- Broker certificates are half-stake discounts, not free cash claims. Expected pull reward must be reduced by the remaining stake; player-to-player resale transfers existing ryo and burns fees rather than minting currency.

There is deliberately no global daily ryo cap. Repeatable activities, different opponents and event availability prevent a universal daily maximum; a useful economy check compares actual playtime and net source/sink flow, not the sum of every activity's independent cap.

Today's pricing increases preserve old sale bases, preventing an inventory liquidation windfall. Gear crafting fees are 24,000 rare / 56,000 epic / 140,000 legendary ryo, in addition to materials. At level 50 those represent about 109/255/636 anchor minutes; at level 70, 80/187/467. Supply crafting has no positive fee-to-resale margin even before charging materials. Legendary/mythic shop values denominated in Fate Shards were not mislabeled as ryo.

**Decision: retain the current prices and fees.** They provide meaningful sinks without evidence of a new cash-printing loop. Whether particular equipment tiers feel too slow requires observed earn/spend rates and completion-time distributions after today's changes; the anchor alone cannot establish that. No claim is made that every player's net daily earnings equal the table.

Sources: [pricing](../shared/shop-pricing.ts), [crafting fees](../shared/craft-fees.ts), [mission rewards](../api/missions/_mission-catalog.ts), [income scenarios](../scripts/_economy-income-forecasts.ts), [inventory/scenario script](../scripts/progression-economy-audit.mts).

## Sector wars and card health

All three lanes were traced through admission, authoritative combat, score attribution and settlement:

| Lane | Checks |
| --- | --- |
| Pets | New duels use server-resolved progression-v3, sealed rosters/gear/terrain/weather and deterministic replay. Historic sessions retain their old ruleset. Async combat intentionally excludes consumables rather than spending an unapproved inventory item. Resource mutations use fail-closed locks. |
| Cards | Shared authoritative engine; hidden opponent information while waiting; participant and contest-instance validation; completed-match timestamp checks; atomic commit/deduplication; draws do not score; frozen contests do not receive new scores. New sector-card sessions assert 10,000 LP on both seats. |
| Shinobi PvP | Only a finished real participant session with world-reward authority can contribute. Recoverable continuations permit valid late completion before settlement without scoring an unrelated or replacement contest. |
| Settlement | Contest/grace windows, retries, ledger/resource locks, large receipt histories and outage recovery are covered by the sector regression suites. |

The focused sector/pet suite passed all 147 cases. Three real Express desktop browser journeys also passed, covering pet-war discovery/replay/persistence, pet attack, and card attack/table admission. Their existing mobile variants are explicitly skipped. This does not certify every UI path or production outage scenario.

The audit found a separate currency gap: the sector purse verified the recipient's established-account eligibility but lacked defeated-account eligibility evidence. Ordinary PvP purse and card Chronicle Point checks did not automatically protect this later sector purse. The owner explicitly approved the receipt change, and it is now implemented for all three human combat lanes.

### Approved fix: sector-purse eligibility evidence

New human battle receipts contain optional boolean `purseEligible`, committed atomically with the existing score and receipt. The shared [eligibility reader](../api/_sector-war-purse-eligibility.ts) uses the existing PvP rule: the defeated account is at least 72 hours old by default OR level 20, and the winner is no more than 20 levels above it. The existing age override and legacy missing-`createdAt` behavior remain compatible. Missing whole saves and failed reads are unavailable evidence, not eligible legacy accounts. Card/pet endpoints return retryable 503 responses; the existing PvP terminal barrier remains pending. No score or receipt is committed without the required account evidence.

Age is evaluated at battle end, not retry time. PvP uses sealed fighter levels where available; pet/card owner levels are read from authoritative saves when the receipt first commits. A committed eligibility decision never changes on replay or later progression. `api/_sector-war.ts` strictly preserves the boolean in the in-row mirror, pending copies and external receipts; `api/_sector-war-store.ts` commits it through the existing compare-and-set protocol. `api/war/_sector-purse.ts` excludes explicitly false receipts from currency points. Territory points, capture contribution, garrison/mercenary fractions and old receipts without the field retain their previous treatment. This closes the fresh-alt reward gap prospectively; it does not solve all collusion between established accounts.

Validation covers account-age and level-gap boundaries, sealed levels, both PvP winner sides, real card/pet handlers, read-failure/retry behavior, immutable replay, deferred external copies, malformed flags, old receipts and the 201st receipt beyond the in-row mirror. All 216 related sector-war tests and the server build passed. The full backend run finished with 18,610 passed, 30 skipped and three failures in one dry-run fixture file that lacked player saves. That fixture now supplies authoritative accounts; all 17 tests in the corrected file passed. Production code was unchanged during that full run and rerun. The original full run was not green.

[The shared card contract](../shared/chronicle-duel.ts) now starts new matches at 10,000 LP. Existing saved sessions retain their stored health; healing is still uncapped. The rules and tutorial read the shared number rather than hardcoding it.

An additional 1,600-match card diagnostic at 10,000 LP found a broader power/access concern: the same pilot wins 20% with its common/rare basic-pool cohort against its marketplace cohort, 19% with the progression-plus-basic cohort, while the mirror control is 50%. The old script labels the basic pool “ryo shop”; today's basic packs actually use Chronicle Points. Premium cards use earnable Fate Shards, so this does not establish that real-money spending is required. This is a constructed-deck diagnostic, not a measured player win rate or proof the LP change caused the gap. Keep this finding visible for a dedicated deck-access/card-power pass.

## Validation and reproducibility

Local logs and raw probe outputs are under `.tmp/balance-audit-20261028/`. This ignored directory contains diagnostics only, not production data. The [compact evidence snapshot](balance-audit-2026-10-28-evidence.json) retains source fingerprints, corrected elemental scores, pet integrity/marginals and economy scenarios alongside this report. Large raw logs are not embedded here.

| Validation | Result |
| --- | --- |
| Root build: server/client, runtime verification and size checks | Pass |
| Client lint | Pass: zero errors, 25 existing warnings |
| Legacy/global correction regression | 19 passed |
| Card engine targeted suite | 107 passed |
| Legacy/card targeted suite with repository asset hook | 85 passed |
| Sector/pet targeted suite | 147 passed |
| Real Express sector-war browser journey | Three desktop cases passed; three mobile variants explicitly skipped by the existing suite |
| Progression-v3 full probe | 37,136 fights; zero invariant failures/warnings |
| Guide-copy and trait regression | 13 passed |
| Root full unit suite | After correcting stale guide copy: 18,593 passed, 32 skipped, three failures under concurrent load. All three affected files passed a single-worker rerun: 96/96. The original full run was not green; reruns alone do not prove the cause of an intermittent failure. |
| Approved sector-purse fix | Server build and 216 related tests passed. Full root suite: 18,610 passed, 30 skipped, three failures from missing-account dry-run fixtures; after fixing those fixtures, the affected file passed 17/17. Full run was not green. |
| Approved fix: real Express sector-war journeys | Three desktop cases passed; three existing mobile variants skipped. Local test server exited cleanly. |
| Final wiring recheck requested by owner | 763 tests across 77 files plus 16 reward-claim/card-mode/ranked-pet entry-point tests: 779 passed, zero failures or skips. Includes route registration, generated catalog parity, legacy acquisition/slot behavior, PvP/solo jutsu parity, card engine, sector receipts/settlement/retries, pet traits and shop/craft checks. A separate real server hydration probe confirmed all 100 legacy signatures retain their authored damage, AP, cooldown, range, targeting and tag potency. No additional integration defect found; no further production changes made. |
| Full responsive/accessibility browser suite | 4,020 cases across seven projects: 2,951 passed, 1,061 skipped, eight failed (1.9 hours). All eight desktop failures passed targeted single-worker reruns: five Chromium, three Firefox. No later mobile/tablet failures. The original full run was not green. |
| Strict combat-layout matrix | 19 passed, 10 skipped, one Chromium DPR1.25 Tower failure when the completion overlay covered the board. That exact case passed its strict isolated rerun. All executed WebKit cases passed. |
| Corrected global comparison | 1,440 baseline + 1,440 final fights, plus 480 actual seat/opener mirror controls; matchup and initiative warnings above |
| Broader global loadouts | 5,760 additional fights: one 15-slot run and three 12-slot utility variants; all fixture-size/unique-ID assertions passed; substantial loadout sensitivity and round-cap warnings above |

Dependencies were restored from the committed client lockfile after `npm test`'s pretest attempted to replace a running esbuild binary. The full root test command is `npm test --ignore-scripts`, skipping only that redundant dependency-install lifecycle step. Test execution uses the normal repository runner and its asset hook. Local server tests/browser launches use the host environment because sandboxed loopback/process access was unreliable. No dependency or lockfile changes are part of the audit.

## Compatibility and deployment

New card matches use 10,000 LP; already-sealed matches retain their stored health and rules version. Legacy IDs, ownership, acquisition counters, stages and saved loadouts remain compatible. The authored jutsu catalogs and their generated server copies were changed together. Deploy through the normal Railway source build; do not commit `dist/`. This audit requires no SQL migration or new environment variable. Older server versions reject unknown receipt fields, so any rollback after new receipts are written must retain the `purseEligible` reader support. Production admin overrides and the existing Legacy feature switch were not inspected or changed.

The approved receipt fix is implemented and backend/browser validation is complete. Retain the elemental-kit, initiative and card-pool warnings above; simulations do not certify human competitive balance. This task's unused preview snapshots and passing smoke captures were removed after their servers stopped; original failure evidence and all audit logs remain. The 108 preexisting staged files were preserved. No deployment or commit has been performed.
