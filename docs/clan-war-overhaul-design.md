---
type: system-design
project: Shinobi Journey
domain: Clans
feature: Clan war queues and golden shrine
status: review
canonical: true
owner: Game design / Tyler
validation: mixed
last_reviewed: 2026-10-13
---

# Clan war overhaul: queues and the golden shrine

This document owns the implemented clan war design. The [overall clan plan](clans-and-clan-wars-plan.md) owns shared contracts, projects, Clan Hall improvements and the wider delivery sequence. Tyler authorized completing and balancing the full overhaul on October 13, 2026. The baseline is implemented in this worktree; the [working state](handoffs/clan-overhaul-work-state.md) records verification and its limits. Nothing has been deployed.

## Confirmed design and proposal boundary

Tyler confirmed these choices on October 13, 2026:

1. Any eligible clan can be declared on. War enrollment and acceptance by the target clan are not required.
2. A Clan War page offers queues for pet battles, card battles, shinobi 2v2 and shinobi 1v1. Members of the opposing clan queue to obtain a match.
3. A randomly appearing golden shrine lets members of the two clans physically enter and fight for bonus points.
4. Each shrine appearance has a randomly selected pet, card or combat rule set.
5. Keep the core simpler than the earlier compound, captured-ward and AI-defense ideas. Those proposals are excluded from this design.
6. Work on clans and clan wars; village-war integration remains deferred.

Use the documented starting values as delegated implementation defaults under Tyler's completion request. Tune them from measured player evidence. `shared/clan-war-campaign.ts` owns the implemented campaign parameters. The complete local desktop/mobile clan journey and affected realtime field/sector-war journeys passed; the working state records all broader checks and rechecks. This does not certify deployed behavior or human pacing/enjoyment.

## Full player journey

| Stage | Player experience | Implemented rule |
| --- | --- | --- |
| Declare | Leadership chooses a rival and sees eligibility, cost and timing. | Any eligible rival; one active/preparing war per clan. |
| Prepare | Both clans receive the war notice and organize specialties and partners. | 24 hours; no war scoring. |
| Fight | Members enter any of the four queues and match with the rival clan. | 72 hours of conflict, divided into three war days. |
| Shrine | Both clans travel to the announced golden shrine and fight in its selected mode. | Two appearances per war day; two-hour windows. |
| Close | New scoring stops, valid battle results settle and the final score is shown. | Most War Points wins; equal scores draw. |
| Reward | Members receive earned participation rewards; the winning side earns its victory rewards. | Participation must be verified, not inferred from current membership. |
| Recover | The clan sees its history, contributions and next eligible declaration time. | Three-day clan recovery and seven-day pair cooldown. |

Preparation begins when the declaration is durably funded and created. Conflict starts 24 hours later and ends 72 hours after that. War days are hours 0–24, 24–48 and 48–72 of conflict, independent of UTC midnight. The UI shows local dates/times and countdowns.

## Declaration and eligibility

Keep existing clan leadership authority and the 100 Honor Seal baseline fee. The declarer explicitly selects personal Seals or the clan Seal Pool; there is no fallback between sources. Warmonger pays 90. Exactly one source is charged and sealed into the campaign; the target pays no declaration fee. Atomic reservations bind both clans before payment, and retained requests reconcile an uncertain result without charging again.

Implemented eligibility:

- Both clans exist, are at least seven days old and have at least four eligible members.
- An eligible member is level 15 or higher, has belonged to that clan for at least 48 hours and has been active within the preceding seven days.
- Neither clan is already preparing or fighting a clan war or within its three-day recovery period.
- These two clans are outside the seven-day rematch cooldown.
- Clan level, owning a sector and purchasing buildings are not prerequisites. Same-village rivals can fight.

These implemented baseline thresholds limit repeated targeting and allow four-person clans to participate. They do not equalize character builds or guarantee similarly powerful opponents. Sealed rosters show member levels; rivalry history explains recent results. A separate strength restriction is not assumed under the approved any-eligible-clan direction.

At declaration, seal each clan's eligible member list. Members on that list can participate if they still belong to their recorded clan. New recruits cannot reinforce that war. Departure or removal stops new participation without deleting credit already earned. A clan without online leadership still enters conflict after preparation; no acceptance button is needed.

Reserve both clans before charging or creating the war, so declarations against different rivals cannot simultaneously enroll the same clan. Failed creation refunds the selected payment; ambiguous completion retries the original declaration rather than charging again. Only the declaring clan's leadership can withdraw its declaration during preparation. Withdrawal burns the declaration fee but produces no victory rewards; target surrender during preparation also closes without victory rewards. Both receive the normal recovery/pair cooldown. An administrator-canceled service failure refunds the fee and imposes no competitive cooldown.

## Preparation and the Clan War page

Preparation is coordination, not a defense-building minigame. The page shows the opponent, both eligible lists, level ranges, start/end times, rules, queue availability and shrine schedule. Members can indicate their specialties and find a 2v2 partner. Notices and optional member assignments organize the clan without granting new leadership or treasury permissions.

Use one main Clan War page for scoring, queues, shrine information, contributions and rewards. Clan Hall links directly to it. Existing Council links route to the same experience; members should not have to manage one summary in Clan Hall and a separate challenge inbox in Council.

Four queue choices:

| Queue | Participants per clan | Battle owner | War scoring |
| --- | --- | --- | --- |
| Shinobi 1v1 | One | Existing server PvP | 100 to the winning clan. |
| Shinobi 2v2 | Two | Existing four-player Tower MPvP binding | 200 to the winning clan. |
| Pet battle | One player and their legal pet lineup | Existing clan-war Showdown resolver | 100 to the winning clan. |
| Chronicle | One player and their legal deck | Existing Chronicle engine | 100 to the winning clan. |

The first version has these four choices. A separate pet 2v2 queue is outside this core, even though the existing system supports that mode. Pet resolution remains server-resolved automatic Showdown; the queue overhaul does not promise interactive pet controls.

## Queue matching and human defenses

A member joins one queue at a time. Shinobi 2v2 requires two clanmates forming a ready pair; neither slot can be filled by the rival or a generic NPC. Match only complete entries from the two clans in this war, using oldest compatible ready entries first. There is no clan-leadership approval for individual matches.

Recommended match flow: join queue → find opposing entry → 30-second ready check → reserve scoring allowances and battle leases → start the authoritative battle → settle its result → return to the Clan War page. An expired ready check releases reservations, awards nothing and applies no damage or point penalty. The queue shows that opponents are needed rather than pretending a battle is available.

The opposing players are the defense. There are no assigned compound guards, offline member copies, capturable structures, unanswered-challenge damage or AI fallback scores. If the other clan does not queue, no normal match happens and no points are manufactured.

Read and seal current legal builds at battle admission, using the mode's existing loadout and availability rules. Equipment changes between matches remain useful. A player cannot queue while already leased to another battle. A disconnect after a battle begins follows that engine's reconnect/forfeit rules; only its authoritative terminal result can score.

Normal queues can be joined from the Clan War page using the existing arena admission model. They do not transport the player's persistent world position to the shrine. Physical shrine entry is a separate requirement.

## Normal-match scoring and participation allowance

Replace war HP with War Points. All specialties have the same value per winning participant: 100 points. Shinobi 2v2 is worth 200 because two players fight on each side. Draws award zero War Points.

Implemented allowance per war day:

- Each clan has 20 scored player participations. A 1v1/pet/card match uses one for each clan; a 2v2 uses two for each clan.
- Each member can use at most five normal scored participations across all four queues. A 2v2 uses one for each participating member.
- Both sides reserve the required allowance together. If either side cannot pay its participation cost, the scored match cannot start.
- A completed win, loss or draw consumes the reserved participation. A server-refused start or verified service cancellation restores it. A player abandoning an already-started battle does not recover it.
- Unused participations do not roll forward. Switching mode does not create another allowance.

This gives a four-member clan enough capacity to use its full 20 daily participations while preventing a single member from using the entire allowance. Larger clans gain scheduling flexibility, not a larger scored pool. This limits volume; it does not normalize skill or equipment.

Because each scored match consumes the same number of participations on both sides, normal matches can award at most 2,000 War Points combined per war day, or 6,000 across the war. Twenty 1v1s, ten 2v2s, or a mixture have the same maximum point pool. Allowance resets use the war clock; a battle keeps the day it was admitted in even if it ends after that day's boundary.

## Random golden shrine appearances

Reuse the golden shrine landmark, physical entrance and room presentation from the ongoing shrine work. A clan-war appearance has its own war-bound room and rules. It does not inherit village control timers, village rewards, village membership checks or the village's 1,000-point control bonus.

Implemented schedule: six appearances across the three-day conflict, with one two-hour opening randomly placed in each 12-hour block. For block `b` from 0 to 5, select an opening offset `u` between 0 and 10 hours; open at `conflictStart + 12*b hours + u`, and close two hours later. The server seals these choices so refresh/restart cannot reroll them. This guarantees two openings per day without overlapping windows; boundary windows can touch. It does not guarantee prime-time access for every timezone.

Each appearance chooses a valid traversable wilderness sector, excluding village gates, inaccessible/restricted locations and blocked entry positions. The sector can change between appearances. Multiple wars at the same sector use distinct labeled entrances/room instances, and only the relevant two clans can enter that war's room.

All eligible members receive the sector marker and rule announcement 30 minutes before opening. The War page shows the next opening time and navigation to the sector, but provides no remote Enter or Fight action. Players must travel to the landmark and enter it while open. The server verifies current sector/room presence again when admitting a fight. Travel, departure and a new visit invalidate stale room authorization.

Random modes:

| Shrine rule | Scored encounter |
| --- | --- |
| Combat | Shinobi 1v1 between present rival clan members. |
| Pet | Existing clan-war pet battle between present rival members. |
| Chronicle | Existing card battle between present rival members. |

Recommended randomization: shuffle one set containing all three modes for appearances 1–3, then shuffle a second set for 4–6. Order is random, while every specialty appears twice. Announce the appearance's mode before opening so members can prepare. One mode applies to the whole window; entering/leaving cannot change it.

Use a small mode-specific shrine queue to pair rival members who are physically inside. Both must remain eligible/present through admission. Other battle types are refused inside that room. Normal queue entry requires leaving the shrine first. There is no occupation-time score, headcount multiplier, AI substitute or automatic award for an empty room.

## Shrine bonus scoring

Each appearance has five shared scored matches across both clans. Reserve a slot when a ready match starts. Each member can play at most two scored shrine matches in that appearance. A completed match consumes its slot even on a draw; canceled service failures release it.

A shrine win adds 100 bonus War Points to the winning clan; a draw adds zero. This is a separate bonus pool: it consumes neither a normal participation nor a normal queue point award. One shrine battle therefore awards 100 total, not 100 normal points plus another 100. After all five matches, the room remains available for viewing until closing, but no further scored fights start.

Six appearances can award at most 3,000 bonus points combined. Normal queues provide at most 6,000, so the shrine holds one-third of the total 9,000-point opportunity. Its fights can swing a close war without replacing the queue system.

## Closing, victory and an example

Highest total War Points wins. An equal score is a draw; no HP, spending, online population or hidden tiebreaker decides it. All shrine windows finish by conflict end. Stop new scored admission during the final 15 minutes of the war or a shrine window so active fights have a defined completion period.

Only a server-owned result completed within its scoring deadline is valid. Closing drains/reconciles admitted battle receipts before freezing the result, including terminal results already recorded before the deadline. An unfinished battle at the deadline receives no war score; service cancellation restores its accounting. Late client claims cannot change the frozen outcome.

Example war day, assuming all 20 normal participations and all ten shrine slots resolve decisively:

| Source | Clan A | Clan B |
| --- | --- | --- |
| Normal winning participations | 12 × 100 = 1,200 | 8 × 100 = 800 |
| Shrine wins across two appearances | 2 × 100 = 200 | 8 × 100 = 800 |
| Day contribution to the war total | 1,400 | 1,600 |

Clan B wins more shrine fights and overcomes its weaker queue performance. There is no separate daily winner bonus; these points simply add to the full-war total.

Leadership can surrender during conflict. Earned match rewards remain. The opponent is recorded as winner, but a war with no completed scored match pays no clan XP, victory bonus or crate. Surrender uses the normal recovery and pair cooldown; the losing treasury is retained. Dissolution reconciles trusted terminal results before using the same forfeit accounting.

## Rewards and contribution recognition

Keep the current reward currencies and crate contents as the baseline. Implemented eligibility and amounts:

| Reward | Implemented rule |
| --- | --- |
| Personal match participation | 25 Clan Points for a genuinely completed scored normal or shrine match, including a loss or draw. This extends the current helper's non-draw-only participation behavior. |
| Personal match win | Additional 25 Clan Points to each winner. Each 2v2 participant receives their own participation/win reward. |
| Personal war victory | 75 Clan Points for an eligible member of the winning clan who completed at least one scored match. |
| Clan XP | Existing baseline: 1,200 for the winner; 400 for the loser or each side of a draw. No matches means no XP. |
| Legendary War Crate | One for each verified participating winner, using a unique campaign reward ID. Membership alone does not qualify. Existing contents/odds remain unchanged. |
| Territory Control Scrolls | Preserve the existing 20% server-sealed drop of one scroll for a completed scored shinobi 1v1 win, including shrine combat. The receipt co-writes inventory and CP; replay cannot reroll. Unscored late fights, pet/card/2v2 matches and empty rooms do not grant this drop. |
| Recognition | Display queue wins, team wins, shrine bonus wins and participation for both clans. Award cosmetic recognition for useful roles without multiplying War Points. |

All personal Clan Points remain subject to the existing shared 1,000-point weekly cap. Cap feedback should explain why currency stopped increasing while war contribution still counts. An unscored practice, expired queue, mere shrine attendance or generic donation grants no war points or match payout.

Participation/reward eligibility uses the recorded war side and completed-match ledger. A new recruit cannot claim an old victory; leaving or being kicked after earning credit does not erase it. The v2 crate path uses frozen contributors and a unique instance suffix; legacy wars retain their current-membership rules. Protected in-save reward receipts commit with CP and the currency ledger, and missing deliveries resume without duplicate credit.

Support roles remain part of the wider clan plan. Their contracts can earn their own recognition/rewards, but do not fabricate participation in this live-match war.

## Clan investments and logistics

Implemented conversion of war-dependent effects, with no direct War Point multipliers or extra scored participations:

| Existing feature | Implemented campaign role |
| --- | --- |
| War Room | Clan-war XP reward bonus of +0.2% per level, capped at 10%; floor the final XP award once. Keep purchased levels. |
| Warmonger doctrine | Replace +100 starting HP with a 10% declaration-cost discount. Other doctrines keep their existing non-war benefits. |
| Scout Network | Level 1 reveals location 60 minutes before opening; level 15 also reveals mode at 60 minutes; level 30 reveals both 90 minutes before opening. Normal notice is 30 minutes. |
| Training Grounds, Pet Den, Medical Wing, Blacksmith, Treasury | Keep existing benefits and investments unless a separate clan progression revision justifies a change. |
| Provisions | Current leadership can voluntarily spend 30 clan rations once per war day for +10% match Clan Points on future admissions that day, inside the weekly cap. No score or combat advantage. |

For War Room, bound its existing level to 0–50, apply the resulting percentage to base clan XP, then floor once. Level 25 gives +5%, making a qualifying 1,200-XP victory worth 1,260; level 50 gives 1,320. Neither War Room nor Warmonger changes War Points.

For provisions, seal the funded verdict at admission. A funded loss/draw requests 27 Clan Points; a funded win requests 55. The end-of-war 75-point victory bonus is unaffected. Funding after admission cannot retroactively boost a match. The expense and once-per-day stamp commit atomically with current leadership and wallet ownership assertions.

No clan treasury is looted on defeat. The automatic daily ration pass skips new campaigns and retains its existing treatment of legacy HP wars. Existing cooking/restocking emergency switches remain respected. Held clan rations remain visible and can fund optional campaign provisions while restocking is unavailable; leadership is not required to occupy a sealed fighting slot to authorize the expense.

## Whole-overhaul delivery plan

1. **Rules and compatibility:** confirm candidate values, version new wars, preserve legacy battles/rewards, and define funding, member credit and closure receipts.
2. **One Clan War page:** combine summary, preparation, four queues, scoring allowance, history and rewards. Remove the new-war challenge inbox/HP model. Preserve legacy access while old wars finish.
3. **Physical shrine:** reuse the two existing golden-shrine art assets with a separate clan entrance, room and authority. Per-appearance location/mode, presence-bound matches and bonus settlement are implemented here.
4. **Investment conversion:** retain purchased levels and doctrine identity, implement approved replacement effects, and revise clan logistics without enemy resource debits.
5. **Everyday clan meaning:** Hall Overview, two weekly contracts using verified campaign/boss records, one weekly material-funded restoration project, voluntary assignments and mentoring visibility are implemented. The overall plan and shared program rules own their targets/rewards.
6. **Prestige and polish:** war summaries, 24-instance rivalry history, quarterly prestige, earned banners/decorations and the balanced Exchange are implemented. Equal prestige records share rank.

The wider accepted clan directions remain in scope, but the war core can ship in coherent slices before contracts, projects and seasons. No phase introduces village-war organization or sector ownership changes.

## Runtime evidence and implementation boundaries

The audit question is what can be reused and where the simplified plan differs from current behavior. Evidence is local source inspection, not deployed-state certification.

| Observation / classification | Source | Required action |
| --- | --- | --- |
| Reusable: all battle families exist; current war owns challenges and HP settlement. | [war storage](../api/clan/war/_storage.ts), [2v2 lifecycle](../api/clan/war/_mpvp.ts), [pet resolver](../api/clan/war/_pet-duel.ts), [Chronicle host](../api/clan/war/tilecards.ts) | Add queue/campaign/shrine bindings to existing engines, not a new combat engine. |
| Implemented: forced declaration, preparation/caps and global recovery. | [campaign declaration](../api/clan/war/_campaign-declare.ts) | Atomic two-clan reservations and sealed funding. Elapsed legacy wars close before eligibility checks. |
| Design change: current fights use tiered HP damage and challenge expiry penalties. | [war storage](../api/clan/war/_storage.ts) | Version the point-based rules; do not reinterpret active old wars. |
| Implemented: participant-ledger rewards and instance-specific crates. | [war points](../api/clan/war/_war-points.ts), [campaign rewards](../api/clan/war/_campaign-rewards.ts), [clan XP](../api/clan/war/_war-xp.ts), [crate claims](../api/village/claim-war-crate.ts) | Frozen side/participation, repeat-safe delivery and unique rematch IDs; verify departure and recovery. |
| Reusable economy with changed semantics: mandatory daily clan provisions. | [stores pass](../api/_village-stores-daily.ts), [stores display](../shinobij.client/src/lib/clan-stores.ts) | Isolate v2 voluntary activation and legacy receipts. |
| Reused art, separate authority: village shrine work continues independently. | Original golden-shrine WebPs copied from worktree `49a8`; [clan shrine](../shinobij.client/src/features/clanWar/ClanShrineGateway.tsx). | Clan room/score/presence remain distinct from village objectives. |

Normal and shrine matches bind to the exact war, mode, day/window and eligible participants. Scoring and rewards come from authoritative terminal results using existing save/currency commit and settlement owners. New versioned KV records use locks and CAS transactions; no SQL/schema migration is required. Viewer-bound browser caches discard the former account's projections and late replies when accounts change.

`shared/clan-war-campaign.ts` owns campaign parameters and pure queue/scoring rules. Server services seal admissions and results; clients consume safe projections. `shared/clan-program.ts` owns the wider Hall goal baseline, and `shared/clan-exchange-catalog.ts` owns the Exchange catalog. No SQL/schema migration or deployment is part of this worktree change.

## Validation and player tuning

Required acceptance checks include simultaneous declarations against different rivals; queue/ready-check expiry; half-full 2v2 parties; concurrent last-slot claims; five normal participations across mode switches; paired scoring parity; war-day boundaries; no remote or stale shrine admission; randomized mode enforcement; distinct rooms for overlapping spawns; exhausted shrine slots; disconnect/forfeit; deadline reconciliation; membership changes; rematch reward IDs; optional provision retries; and legacy reward compatibility. Run the repository's required API, frontend and browser checks for changed code.

Playtest four-member and larger clans, unequal builds, low simultaneous population, timezone access, empty shrines and mixed battle specialties. Low population is a real limitation of the approved live-match core: when neither side meets the other, points and rewards are not generated. Do not silently introduce AI fallback to address it.

The completion request authorizes the stated eligibility, schedule, point weights, participation budgets and reward qualification as the initial baseline. Campaigns, investments/logistics, Hall programs and Exchange balance are implemented. Final backend tests passed 15,040 cases with 24 database-dependent skips; builds, lint, assets and affected live journeys passed. The working state records the full responsive run, isolated rechecks and all evidence limits. Starting values remain subject to measured player tuning.

Arithmetic verification covered this final queue-and-shrine model: all 756 allocations of a fully used, decisive daily normal/shrine point pool preserved the 3,000-point combined day maximum; all 11 mixtures of singles and 2v2s consuming 20 normal player participations preserved the 2,000-point normal maximum. Four members using five normal participations can fill the clan allowance; three members can fill five shrine matches while respecting the two-match individual limit. The full-war maxima are 6,000 normal plus 3,000 shrine points. Draws and unused/canceled matches reduce the realized pool.

Earlier exploratory compound/ward calculations are obsolete and do not validate this design. Arithmetic does not validate queue availability, engine correctness, shrine attendance, player balance or whether the schedule is fun.

## Review record — 2026-10-13

- **Confirmed owner decisions:** any eligible target; four opposing-clan queues; physical randomly appearing golden shrine; random pet/card/combat shrine rules; simplify away compound raids and AI defense; defer village integration.
- **Implementation authority:** Tyler subsequently authorized completing the entire plan, making needed artwork, integrating all gaps, balancing the rest of clans/Exchange and double-checking the result. Documented starting values are delegated implementation defaults.
- **Lifecycle:** Implemented baseline ready for owner review; no deployment performed.
- **Validation:** Local source, bounded arithmetic, 15,040 passing backend checks, authoritative desktop/mobile clan journeys and affected realtime field/sector-war journeys. The strict combat matrix passed 20 cases with 10 configured skips. The complete responsive run recorded four story screenshot-save failures and four flaky passes; all affected cases passed in a 19-case isolated rerun with zero retries. The working state records exact counts and limitations. No deployed-state or human-fun certification.
- **Next step:** Review the implementation and verification record, then measure pacing, queue population and matchup balance with real clans.
