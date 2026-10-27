# Battle Towers research and implementation audit — 2026-10-24

<!-- current-live-status:start -->
Current status (2026-10-27): the earned-player v5 release has passed live
four-client checkpoints at levels30/40/70/100 and a repeat finale on the third
route. The save-ownership follow-up is also deployed and live-verified.
The [current balance owner](battle-towers-squad-balance.md) and
[production evidence](battle-towers-live-certification-2026-10-27.json) supersede
the older fixture/release boundary statements retained below.
<!-- current-live-status:end -->

> October 26 supersession: the upgraded progression-gear-v4 calibration and reinforcement/lease fixes are now owned by [the current balance specification](battle-towers-squad-balance.md) and [its numeric artifact](battle-towers-squad-balance-results.json). The prepared-catalog-v2 figures below are historical lower-power evidence, not the normal level-70 baseline. Elite remains demanding for upgraded teams.

Status (updated October 26): local candidate verified; production storage recovered;
four-player testing found polling/settlement contention. Local fixes await deployment.
The [balance specification](battle-towers-squad-balance.md) owns the current
rules. This report records the audit, corrections and release evidence.

## Question and evidence boundary

Does the public Tower climb deliver level-30 entry, a four-player challenge,
increasing encounter demands, readable counterplay, recoverable multiplayer and
authoritative rewards? The review covers the local Story candidate, the shared
party/recovery path, and Spire compatibility. It does not treat online research
or simulated success rates as production certification.

Source checkout: `a60f9ceda51f3a0ff13cfe5f8d3d30af4823ddd6` plus the uncommitted
Tower candidate. The live recheck at `2026-10-25T01:24:52Z` observed deployed
commit `bed1dc722512331c5012a51ba36f15b143ea0d27` and HTTP 503 from the disposable
account's verification. That live version lacks the candidate's four-player
recommendation metadata. No production admin credential or configuration was
changed during this research audit. The October 26 live follow-up and approved
disposable-fixture preparation are recorded in the balance specification's
[current multiplayer evidence](battle-towers-squad-balance.md) and the
[sanitized numeric results](battle-towers-multiplayer-certification-results.json).

## First-party comparisons

These published designs provide comparison points, not numeric balance targets
or specifications for Shinobi Journey's network implementation.

| Reference | Documented pattern | Application to Towers |
| --- | --- | --- |
| [FFXIV Palace of the Dead play guide](https://na.finalfantasyxiv.com/lodestone/playguide/contentsguide/deepdungeon/) | Fixed parties allow up to four players without a required role composition; matched parties contain four. Saved progression and party identity govern resuming. | Keep roster membership, ready state, shared progress and reconnect identity authoritative. Test four players of one discipline as well as mixed squads. |
| [ArenaNet's Fractals design explanation](https://www.guildwars2.com/en/news/the-brand-new-fractals-of-the-mists-legendary-backpacks-ascended-salvaging-and-more/) | Early scales teach mechanics; later scales combine stat growth with additional modifiers and clearer messaging. | Check escalating enemy roles, reinforcement timing, fields and boss counters alongside durability. Avoid using HP growth as the only difficulty measure. |
| [Bungie's Rite of the Nine difficulty explanation, May 15, 2025](https://www.bungie.net/7/en/News/Article/twid_05_15_2025) | Introductory play explains encounters, while the mastery tier adds stricter revive, timing and combat demands. | Explain required actions and distinguish score par from a genuine deadline. A revive system or additional difficulty menu is not automatically required for this turn-based mode. |
| [Valve: The AI Systems of Left 4 Dead, Michael Booth, 2009](https://cdn.cloudflare.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf) | Four-player cooperative AI combines dependable teammate behavior with alternating pressure and recovery; Valve also describes automated four-bot stress tests. | Use coordinated full-squad scenarios, varied threats and pacing checks. Towers uses authored waves and phase mechanics; this audit does not claim it has an adaptive AI Director. |

The resulting audit criteria are an engineering interpretation of those
patterns. Their existence does not establish that another game's exact rules,
damage values or backend techniques should be copied.

## Findings and corrections

| Priority / classification | Finding and impact | Evidence / disposition |
| --- | --- | --- |
| P1 — Live defect, corrected locally | Simultaneous four-player polls contend on account battle locks; one settlement caller also returned 500. | October 26 live testing and Railway logs confirm the contention. Healthy lease observations now avoid account locks/writes; contended repairs and settlement return retryable 503 responses. Production storage works, and the old deployed build completed a four-player victory with one-time rewards after an explicitly recorded polling workaround. Deploy the candidate and repeat the strict scenario. |
| P2 — Validation gap, corrected | The former balance model included a fabricated damaging 40-AP strike. Built-in catalog 40-AP techniques are utility, so that model was not a sufficient release fixture. | `scripts/tower-story-balance-sim.ts` now constructs saves with catalog techniques and owned equipment, then calls `sealTowerFighter`. The legality test rejects invented techniques, damage rotations and injected equipment multipliers. |
| P2 — Config gap, corrected | Early bosses had three unset discipline defenses. This left unintended undefended damage lanes outside their authored specialty. | `api/towers/_story-balance.ts` now applies the floor defense minimum to bosses. `_encounter.ts` uses that profile when constructing new public Story bosses. The regression checks actual built actors, preserves stronger authored defenses, HP, offense and kits, and prevents mutation of shared templates. |
| P2 — Validation gap | Prepared synthetic saves do not establish the difficulty experienced by ordinary level-30 entrants. | The fixture states its trained-stat, gear and mastery assumptions. Production cohort loadouts, clear time and knockout data remain the next calibration evidence. No new gear lock or forced class composition was introduced. |

The boss correction is confined to opt-in `four-player-v1` Story floors. Old
sealed runs, Spire-generated encounters, embedded encounters and shared PvP
combat formulas retain their existing behavior. Boss HP inflation and extra
damage caps were not required for this correction.

## Implementation checks

| Dimension | Observed implementation and evidence | Classification |
| --- | --- | --- |
| Admission and roster | Level 29 is refused; exactly 30 qualifies. All human members are rechecked at launch and after lease acquisition. Roster changes invalidate readiness. `level-gate.integration.test.ts`, `_party.test.ts`, `start-entry-conflict.test.ts`. | Matches design |
| Four-player strength | New Story pods, bosses, delayed waves and summons retain the same combat snapshots for one through four entrants. Smaller Story parties accept the full challenge; Spire requires four live players. `_story-balance.test.ts`, `_party-entry.test.ts`. | Matches design |
| Escalation and counterplay | The climb introduces artillery, vanguards, displacement, controllers, reinforcement waves, fields and boss mechanics. Pylons, safe ground, phases, guard pods, regeneration and summons have executable counters. `_floor-catalog.ts`, `_combat-tactics.test.ts`, `_combat-campaign.test.ts`. | Matches design |
| AI legality and navigation | Tactical roles choose targets and affordable actions through the ordinary AP, range, status and cooldown resolver. Skirmishers use an available attack before chasing a remote isolated target. `_engine.ts`, `_combat-tactics.test.ts`, `_engine.test.ts`. | Matches design |
| Truthful objectives | Current Story floors use combat objectives. Their round budget is score par; timed holds and Spire round caps are separately presented. Existing sealed older objectives retain their original rules. `_combat-campaign.test.ts`, `BattleTowers.resilience.test.ts`. | Matches design |
| Recovery and ownership | The October 26 live four-client run verified ownership, sealed loadouts, version rejection, command replay and AFK recovery. Simultaneous polls exposed the account-lock defect; sequential reads allowed the diagnostic to continue. | Live findings; local correction awaits deployed retest |
| Rewards and room release | Live victory paid every disposable account 400 ryo once, retained all four clears and released the room. One concurrent caller returned 500, then confirmed settlement on retry. `_tower-store.test.ts`, `settle-party-lifecycle.test.ts`, network evidence. | Live delivery verified; contention correction awaits deployed retest |

## Historical catalog-v2 balance evidence (superseded)

The [current numeric artifact](battle-towers-squad-balance-results.json) uses
`prepared-catalog-v2`, twelve deterministic seeds and the production combat
engine, hydrator, route, enemy mastery and PvE guard:

- Prepared mixed squads: 180/180 clears across all fifteen floors.
- Prepared same-discipline squads: Ninjutsu 179/180, Bukijutsu 175/180,
  Taijutsu 179/180 and Genjutsu 179/180. Every composition meets the progression
  gates; four-Bukijutsu on floor 15 is the lowest at 7/12. Total: 892/900 clears.
- Solo checkpoints at floors 1, 5, 10 and 15: 0/48 with the same individual build.
- Floor 1 at level 30: 8.4 rounds and 69.8% squad HP remaining on average.
- Floor 15 at level 100: 20.6 rounds and 30.9% squad HP remaining on average.
- Every tested unbuffed catalog opener from all four disciplines leaves an
  ordinary enemy alive across the climb, including delayed reinforcements and
  each boss's sealed summoned-add template.

The fixture equips unupgraded level-20 shop armor and canonical starter
bloodlines, with learned techniques and level-capped mastery. Training is an
explicit curve assumption. It models a prepared party rather than the median
live player. Percent-based effects, positioning and composition still matter;
recommended levels are guidance rather than additional hard entry locks.

Final focused Tower/client-contract regressions: **666 passed, zero failures or
skips** (`.tmp/tower-research-final-regressions.log`). The final nine boss/catalog
checks also pass after extending the model to all five compositions and adding
summoned-add burst coverage (`.tmp/tower-research-all-compositions.log`). Server
TypeScript build and strict checking of the balance tools passed.

The broader repository run completed in 623 seconds: 18,118 passed, 29 skipped,
and one asset-test file failed before its tests ran. This was a Windows checkout
issue: CRLF changed the raw-byte hash of the Sky Falcon frozen-selection JSON.
The source, test and selection content match HEAD after line-ending
normalization; the GLB matches HEAD byte-for-byte. Restoring the exact pinned Git
bytes preserves the original expected hash, and the two affected tests then
pass. An exact-file LF rule in `.gitattributes` prevents the checkout-only
failure from returning. No pet asset, pin, test assertion or production content
was changed.
The full broad run was not repeated; its one failure and the successful focused
recovery are both retained in `.tmp/tower-research-full-suite-local-network.log`
and `.tmp/tower-research-fixture-recovery-tests.log`. The earlier sandboxed
attempt could not complete its localhost Socket.IO tests; those pass in the
completed broad run with local network access enabled.

## Historical release boundary before the upgraded-gear follow-up

October 26 follow-up: the full repository suite passed 18,126 tests with zero
failures and 29 skips. The rebuilt candidate also passed the strict 38-check
four-client network scenario locally. A final authority-projection repair guard
was added afterward and passed all 34 focused Tower regressions plus the server
build; the full suite/network scenario was not repeated after that refinement.
The [current evidence](battle-towers-multiplayer-certification-results.json)
retains this boundary and the production polling/settlement failures.

1. Deploy the reviewed balance/gate and multiplayer contention corrections.
2. Run the four disposable accounts against that exact deployed commit, including
   reconnect, shared-state convergence, AFK, duplicate command and settlement checks.
3. Observe a real four-player session for clarity, waiting time and coordination,
   then compare aggregate clear/knockout data with actual entry loadouts.

Production storage recovery and one-time four-player reward delivery are now
verified. The supported verdict remains a locally verified candidate with
confirmed live defects corrected locally. Complete production or AAA
certification requires the exact deployed candidate to pass the strict scenario.
