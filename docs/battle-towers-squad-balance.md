# Battle Towers squad balance — updated 2026-10-27

Lifecycle: released and verified on production. The level-30 gate, 30–100 squad
curve and multiplayer checks passed on the deployed source. The follow-up save-
ownership correction also passed exact-release live verification.
Historical full-suite and localhost evidence retain their original source scope.
This document owns the current Story balance decisions. The numeric owner is
[the balance results](battle-towers-squad-balance-results.json); network and test
history live in [the certification results](battle-towers-multiplayer-certification-results.json).

## Accepted experience

- Unlock at level 30. Each human must qualify to create, join, ready and launch;
  launch rechecks after lease acquisition. Recovery, unready and exit remain usable.
  The existing authenticated developer/admin test bypass remains.
- Balance for four players. New Story encounters keep full strength for solo,
  duo and trio challenges. Spire still requires four live players.
- Recommended levels rise from 30 to 100 in five-level steps. Sequential unlocks
  apply to every human; recommendations do not add per-floor hard level locks.
- Upgraded gear is normal preparation at higher levels. The owner explicitly
  rejected starter equipment as the level-70 baseline because upgrades are easy
  to obtain. Keep Elite demanding for upgraded teams.
- Level 70 is mid-progression; level 100 is endgame. Every floor is evaluated
  against its own recommended level from 30–100, including middle-floor pressure
  and boss pacing rather than clear rates alone.
- Ordinary enemies should survive an on-level unbuffed opening hit. Strong
  builds, coordinated bursts and returning to lower floors still reward progress.

## Runtime ownership and curve

The public catalog opts into four-player-v1, story-tower-v7. The lobby cache is
tower-floors:v6. The shared entry owner is BATTLE_TOWERS_MIN_LEVEL; enemy growth
is owned by api/towers/_story-balance.ts. Shared player damage/PvP formulas are unchanged.

For floor step s = floor - 1 (0–14) and original template HP H:

- Ordinary HP = round((4400 + 300s) × max(0.95, sqrt(H / 500))).
- Ordinary authored offenses = round(original × (1 + 0.035s)); from floor 5,
  their minimum is 600 + 110s. Missing offense disciplines are not invented.
- From floor 5, ordinary strength/speed/intelligence/willpower are at least
  max(0, recommended level - 45) × 30, retaining higher authored values.
- All four discipline defenses, including bosses, are at least 450 + 65s;
  higher authored defenses remain.
- Enemy level is at least the floor recommendation. Canonical rank caps apply.
- Boss HP remains individually authored: the level-50 Warden is 30,000, level-60
  Revenant 38,000 and level-75 Sovereign 60,000. These replace 18,000/17,000/24,000
  to close the middle-rank pacing dip. Other boss HP, authored offenses, kits and
  mechanics remain unchanged. The level-70 Ravager's summoned waves and the
  level-100 Regent's guard/summon phases are part of their encounter budgets.

The calibration accounts for legal upgraded equipment and weapon-plus-technique
turns. It replaces the earlier 4000 + 250s HP calibration and trains enemy
composites with the recommended rank, rather than stretching HP alone. Growth applies
once to opening pods, delayed waves and sealed summon templates. Elite adds 18%
HP and 10% damage to opening and future enemies, retaining its 25% score/first-
clear bonus. Future summons inherit both route modifiers and level-derived mastery;
delayed waves receive the same mastery policy as opening enemies. Retry setup
does not compound these effects. Legacy undersized-party summon HP remains
independent of route damage. Old sealed profiles retain their stored numerical
growth and phase rules; the counterplay correction below applies to public
Story sessions carrying Tower tactics.

Frozen Gauntlet Drain is 2%, replacing 5% to avoid excessive attrition once its
ten enemies survive longer. Four Shieldmen and two Archers open; two of each
reinforce on round 5, preserving durability while giving legal level-40 squads
time to break the first line. Skirmishers attack an isolated hittable player before
chasing a distant target. Actions still use ordinary server AP/range/cooldown checks.

## Reproducible preparation assumptions

The current progression-gear-v5 model constructs owned saves and calls the
production Tower hydrator. It checks effectiveItemLevelReq, including rarity
floors rather than the catalog's sometimes lower raw levelReq:

| Character level | Normal modeled equipment |
| --- | --- |
| 30 | Five rare armor pieces and a specialty-appropriate rare weapon |
| 35–49 | Actual dropped step-3 rare armor and weapon upgrades |
| 50–64 | Step-3 rare armor and specialty-appropriate step-3 epic weapon |
| 65–79 | Five legendary armor pieces, legendary gloves and a legendary weapon |
| 80–89 | Legendary armor/gloves and a specialty-appropriate mythic weapon |
| 90+ | Legal mid-roll named armor, gloves and weapon |

Level 70 derives 0.35 raw armor, 6% item damage and a 22-EP weapon from equipment;
gloves grant no armor reduction. Named assumptions are 25.5 EP, range 4, 174 all-
offense and a single 35% Increase Damage Given weapon tag; armor is Legendary
quality, 30 offense/defense, 75 glove offense and 1.13% damage per piece. These
are legal roll values, not perfect rolls. High-roll named gear, lifesteal builds
and shield builds are separate stress scenarios.

Training spends exactly earnedForLevel(level) above base 10, with archetype
priorities and rank caps. Vitals/mastery use production level caps; the canonical
A-rank bloodline supplies 1.15 damage. Gear bonuses are added by the hydrator.
The live preparation guard exposed that v4 incorrectly used the frozen AI point
budget (8,767 vs 6,100 earned points at30;20,832 vs16,086 at70). Its results and
older full-suite/network checks are historical controls, not ordinary player
preparation evidence. The curve and independent PvE comparisons were rerun.
These remain explicit fixtures, not measured live cohorts.
The former five-rare-piece/no-weapon fixture is catalog-control only.

The controller focuses fire, clears mandatory guards, follows authoritative
Barrier/terrain blocking, disrupts pylons, heals, uses canonical Clear and
Cleanse, and uses equipped weapons with real range/AP/cooldowns. Lag-adjusted
AP and Elemental Seal eligibility reuse the engine's read-only helpers.
A 40-AP weapon or utility can
pair with a 60-AP catalog technique. Utility itself deals no fabricated damage.
Launch seals the selected route, PvE guard and enemy mastery.

Reproduce the all-route baseline:

    node --import tsx scripts/tower-story-balance-sim.ts 12 --all-routes

Optional flags: --gear=high-roll, --gear=sustain, --gear=shield,
--gear=catalog-control, --finale-only and --seed-offset=12.

## Balance evidence and gates

All five compositions (mixed and four of each discipline) were tested at every
recommended floor level, across three routes and 12 deterministic seeds:

- Rest Shrine: 886/900; Focused Assault: 887/900. Every normal progression gate passes.
- Elite Shortcut: 827/900; optional mid-roll failures remain visible.
- Level-100 normal finale: mixed 11/12, ninjutsu 9/12, bukijutsu 8/12, taijutsu 12/12, genjutsu 11/12.
- Level-100 Elite mid-roll finale: mixed 8/12, ninjutsu 6/12, bukijutsu 5/12, taijutsu 9/12, genjutsu 5/12.
- Independent normal finale seeds: 107/120. High-roll Elite13–15: 151/180.
- Lifesteal/shield checkpoints: 634/720. Lower-power catalog controls: 49/72.
- Same individual progression loadout, solo checkpoints1/5/10/15: 0/48.
- Opening-hit checks leave ordinary enemies alive, including delayed/summoned templates and high-roll forged endgame gear.

Representative mixed-squad normal pacing with actual earned points:

| Level | Floor | Average rounds | Remaining squad HP |
| --- | --- | --- | --- |
| 30 | 1 | 9.3 | 56.2% |
| 40 | 3 | 15.1 | 44.6% |
| 50 | 5 | 10.3 | 49.6% |
| 60 | 7 | 9.5 | 63.2% |
| 70 | 9 | 11.1 | 68.4% |
| 75 | 10 | 11.2 | 81.1% |
| 85 | 12 | 13.8 | 43.1% |
| 90 | 13 | 18.9 | 54.4% |
| 95 | 14 | 19.3 | 72.9% |
| 100 | 15 | 20.4 | 34.6% |

Normal gates remain >=90% entry clears, <=10% entry solo clears, <80% mean entry
squad HP, >=70% floors 1–14, >=50% finale and 5–24 average terminal rounds.
Additional rank gates require at least 8/7/10 average rounds on bosses 5/7/10
for every composition. Mixed-squad HP ceilings are 80% at floors 5/7, 85% at 10,
75% at 13/14 and 50% at the level-100 finale. These prevent clear rates alone
from hiding low-pressure encounters. Elite checkpoint gates require >=50% at
floors 3/9 with progression gear and at the optional level-100 finale with the
optimized forged profile, plus 5–26 average rounds. Ordinary mid-roll Elite
outcomes remain visible; this does not add an equipment lock or promise equal
clear rates to every build. These gates evaluate this controller and fixture, not
estimated production success rates. Authored mechanics create pressure peaks
and recovery floors; encounter difficulty need not be monotonically identical.

## Comparison with the recent normal-PvE pass

The source comparison uses the October 16 progressive-tactics and veteran-pressure
changes (49886af0b and 759fe42d5), including the post-gear-overhaul
[close-fight acceptance](pve-close-fights-evidence/README.md) and
[prepared level-75 probe](pve-close-fights-evidence/level75-prepared.md).
It also checks the newer October 18
[hunt/shrine AI pass](hunt-shrine-evidence/README.md) and subsequent
[shrine HP/pacing follow-up](shrine-mob-pacing-evidence/README.md).
The later [story escalation pass](story-escalation-balance-2026-10-19.md),
integrated in 545260929, is checked as well: it strengthens 85 and 100 while
preserving 75, compares health lows as well as post-heal ending HP, and keeps
the exclusive finale Apex policy.
The relevant normal-PvE sources have no committed difference between this
checkout's HEAD and local origin/main at 590ae2661. Their prior measurements
are context; the current paired controls run the actual local constructors and
resolvers again.

Solo PvE uses bounded own-turn planning and fixed legal veteran counter weapons.
Story Towers use multiple role-based enemies, targeted AOEs, delayed waves,
mandatory guards, terrain and boss phases. Copying solo HP/stat discounts or
granting every Tower actor a veteran counter blade would change that group
budget without evidence. Tower enemies already seal rank-derived mastery and
obey the shared AP, resource, cooldown, Elemental Seal and damage-guard rules.
The level-100 peer endpoint remains uncapped, as in the shared PvE curve.

The mastery difference is intentional: level-50–60 Tower enemies seal mastery 50,
versus 30 for ordinary standard-PvE opponents; at 61–85 the comparison is 50 versus 40.
At 86–100 both reach the rank cap of 50. This uses each enemy's sealed level rather
than the entering player's equipment, and preserves the ordinary weaker-roll
training relief. Delayed Tower waves and phase summons follow the same seal.

The newer hunt chooser is sealed only for hunt actors; public Towers keep their
separate policy. Shrine sessions opt into the legal Solo planner with finite
healing choices. Their later 65% ordinary/60% elite HP factors shorten repeated
solo encounters; they are not four-player Tower tuning. The shrine HP probe's
strong level-100 optimized/sustain builds use the same closeFixtureAudit sources
as this comparison. Tower boss healing and phase pacing are instead checked by
the group clear/round gates below. No solo HP reduction or opening delay is copied.
The story escalation controls use rare shop gear, no bloodline, mastery 30 at
75/85 and 40 at 100. Those are useful accessibility controls, rather than the
expected upgraded Tower loadout. This audit retains the stronger Tower gear,
rank-cap training and A-/S-rank bloodline scenarios; a solo finale's 25% ending-HP
ceiling is not applied to a four-player team average.

The comparison did find three actionable perception gaps. Public Story AI now
recognizes substantial shields as worthwhile Clear targets, avoids Clear and
Cleanse while their visible prevention statuses are active, and counts pending
removable negatives when deciding to Cleanse. Clear still considers active buffs
only. The medium/easy competence thresholds, AP costs and shared resolvers remain
the owners of legality and damage. Other Tower-engine hosts, including Spire,
retain their prior counter policy.

`scripts/tower-pve-comparison.ts` records **245 completed current scenarios**:
210 Tower runs and 35 Solo-PvE controls. The 190 matched before/after Tower
cases retain identical sealed player fixtures. It supplements the main specialist
matrix with the PvE pass's exact twelve-slot level-75 rotation/sustain kits and
fully trained S-rank twelve-slot endgame builds. Separate runs replace only their
equipment with the Tower progression gear; the current-forge 27-EP sustain blade
is another endgame control. Every fixture passes the existing production-backed
ownership/rank audit. All 210 Tower runs execute without a refused enemy choice.
All 25 matched original Solo-PvE controls retain identical outcomes, rounds,
minimum/final health and action choices after the Story-only AI patch.

Representative normal-route results using the unchanged PvE gear fixtures:

| Prepared fixture | Recommended level / floor | Clears | Mean rounds | Lowest member HP across the five runs |
| --- | --- | --- | --- | --- |
| Eight-slot optimized progression | 70 / 9 | 5/5 | 11.4 | 55–77% |
| Exact twelve-slot level-75 rotation | 75 / 10 | 5/5 | 10.8 | 0–87% |
| Exact twelve-slot level-75 sustain | 75 / 10 | 5/5 | 10.4 | 5–84% |
| Eight-slot S-rank progression | 95 / 14 | 5/5 | 20.4 | 63–84% |
| Twelve-slot capped S-rank endgame | 100 / 15 | 5/5 | 16.8 | 0–47% |
| Twelve-slot current-forge sustain | 100 / 15 | 5/5 | 17.4 | 0–73% |

Zero means an actual knockout, even when the remaining squad completes the floor.
The S-rank endgame Elite control clears 4/5, averages 20.4 rounds, and its most
pressured member reaches 0–33% HP. The stronger sustain control clears 5/5 Elite,
averages 18.4 rounds and reaches 10–74% minimum individual HP. These five-seed
controls establish accessible prepared routes and real pressure; they are not
production clear-rate estimates or proof of optimal play.

Floor 14's high ending team HP is recovery, rather than an absence of incoming
pressure. Its shrine grants damage, not healing. With the stronger training and
both equipment variants, the most pressured individual reaches 56–84% HP on the
normal route. Applying the solo 35–75% health target to a four-player team mean
would overstate ease. Keep this recovery floor and the stronger finale rather
than adding another blanket damage increase. The existing specialist progression,
Elite and unbuffed opening-hit gates continue to pass; added checks cover strong
PvE training and current upgraded Tower gear too.

The final full repository run completed with **18,149 passing tests, 29 skipped, zero failures and zero cancellations**. It uses the unchanged root discovery/reporter with four local workers. The final Story counterplay/strong-build selection passes 26/26, the progression selection passes 26/26, and the normal-PvE regression selection passes 67/67. Server build and strict comparison-tool TypeScript pass. These selections overlap; they are not added to the full-suite total.

The numeric owner's `normalPveComparison` field holds raw before/after rows,
source hashes, exact fixtures and validation. The main 3,840-case curve matrix
has also been refreshed, covering all three routes, independent finales,
high-roll gear, sustain/shield builds and solo controls. Every current curve
gate passes. The preceding matrix is retained in preCounterplayCalibration;
the 46-check four-client result keeps its earlier source scope. This AI follow-up
has no new live multiplayer certification and changes no production save.

## Historical multiplayer and release boundaries

The following paragraphs preserve the pre-release test history. The current
production verdict and exact deployment evidence appear in the next section.

Recorded rank-calibration candidate, isolated localhost storage, four level-100
HTTP/Socket.IO clients with actual server-sealed mid-roll forged equipment,
floor 15 Rest Shrine: **46/46 checks passed**. The squad won in round 20 after
170 accepted controller actions following the AFK/replay probes. All four acted
and gained their floor clear and **9000 ryo once**. Retrying settlement changed
no currency or progression. Four phase-summoned Weavers each had 12,463 HP and
level-50 mastery on all three techniques. All four retained 25.5-EP weapons,
0.35 raw armor and the 6.78% equipment damage bonus through authoritative sealing.

Concurrent views/settlement, ownership, stale commands, replay, sealed rejoin,
transport reconnect, the real 75-second AFK deadline, revision hints and room
release passed without a polling workaround. The run used 261 requests, below
the 650-request bound. The test server was stopped afterward. The preceding
level-70 floor-9 Elite run passed 42 checks under its earlier curve; that is
mid-progression evidence. These are four automated clients, not four manual
browser playthroughs. All-floor difficulty remains the separate engine model.

Failed harness attempts are retained in the certification artifact: the server
correctly rejected a move into an active Barrier, and a later transport failure
occurred before party creation. The controller now reuses authoritative movement,
AP and seal rules; game modules initialize before HTTP connections open. Fresh
local identities replaced tokens invalidated by the deliberate memory-backend reset.

The earlier live commit 3601556f59e4f4f7b319a7cfd26fa1d75c8e7232 recovered storage and completed
a four-player floor-1 victory with once-only rewards, but concurrent polls and
one settlement caller returned 500 from account-lock contention. Healthy lease
observations now avoid mutexes and writes; missing/conflicting/expired authority
still repairs under locked fresh reads. Contended state, my-run and settlement
return retryable 503 with Retry-After: 1. That historical run's 500-HP floor-1
enemies and older gate were not this candidate.

The final read-only production preflight at 2026-10-26T21:47:49Z observed commit
b154a648455799cf12022a9520a123d6603968bc: health 200 and fifteen catalog floors,
still lacking the candidate's four-player recommendation metadata. No current
four-client result is claimed for that deployment or for the unpublished fixes.

The earlier approved production admin use was confined to four disposable qatw
accounts, used in memory and cleared. This follow-up accessed no production
credential and changed no production save or configuration.

The recorded rank/balance/reinforcement selection passed 24 tests, including
Barrier navigation, Lag/Seal legality, Cleanse, middle-boss pacing and level-100
pressure. A separate final pressure recheck also passes with the stricter 75%
upper-floor HP ceiling. Server build, strict final tool TypeScript and seven
pre-network runner guards passed.

The earlier rank-calibration broad run completed: 18,170 tests, 18,140 passed, one failed, 29 skipped,
2,428.7 seconds. It loaded the intermediate Elite benchmark using ordinary
mid-roll gear; four Bukijutsu players cleared 4/12 and failed that assertion.
The finalized benchmark retains those diagnostics and checks the demanding
Elite ceiling with optimized forged gear; the corrected 24-test selection passed.
That earlier run was not a clean final full-suite pass. Its failure and the corrected
focused evidence are both retained. The earlier tool-reset interruption also
has no final summary and is not counted as a pass. Exact logs and source scopes
are recorded in the certification artifact. The current counterplay follow-up
is validated separately above.

The [research audit](battle-towers-research-audit-2026-10-24.md) records first-party
FFXIV, Guild Wars 2, Destiny and Left 4 Dead comparisons. Its older weak-gear
numbers are superseded by this document and the current numeric owner.

Before the v5 rollout, the integrated release still required exact production
four-client checks. The local in-memory results did not certify production
storage, failover or player coordination. The next section records the completed
live checks. Revisit the curve when actual loadouts, clear times or knockout
telemetry disagree with these preparation assumptions.

The earned-player correction passed 15 balance tests and 662 Tower API tests,
plus a fresh server build. The earlier 18,149-pass full local run certifies its
recorded v4 source; v5 subsequently passed main CI before Railway promotion.

<!-- current-live-certification:start -->
## Current live production evidence — 2026-10-27

The [complete live report](battle-towers-live-certification-2026-10-27.json) owns
the current deployment mapping, exact checks, sealed snapshots and economics.
The first deployment `7868b7f7` maps to main
`24d9b29ed`, whose 56 CI jobs passed. Four authenticated
clients controlled four human actors (AI disabled) through actual production APIs.

| Level | Floor | Route | Result | Rounds | Checks |
| --- | --- | --- | --- | --- | --- |
| 30 | 1 | rest-shrine | Squad win | 8 | 39 |
| 40 | 3 | rest-shrine | Squad win | 17 | 44 |
| 70 | 9 | elite-shortcut | Squad win | 13 | 44 |
| 100 | 15 | rest-shrine | Squad win | 19 | 47 |
| 100 | 15 repeat | focused-assault | Squad win | 19 | 46 |

All scenarios exercised authenticated sockets, reconnect, shared-state polling,
ownership rejection, stale/replayed commands, discarded acknowledgements, a real
75-second AFK timeout, four-controller combat, concurrent settlement, reward
retry stability and room release. The level-29 boundary passed 16 more checks
across all four players for both Story and Spire. All 15 catalog recommendations
rise from 30 through 100. The 4,085 model/comparison scenarios retain their v5
earned-point and upgraded-equipment source hashes.

After other game changes merged, all 3,840 model cases and the 245 PvE comparisons were rerun on main `5149c7c74`. Every Tower numeric row and all 35 ordinary-PvE deterministic outcomes matched the initial release. Timing measurements were excluded from equality checks. The current source manifest and the original24d and925 proofs are retained. The later pet-feature merge was checked against an expanded graph of 545 local runtime inputs; all current input hashes are verified again against the final working source. A subsequent presentation merge changed only two of those inputs: comments and an unused text export. Both complete compiled model bundles remained byte-identical; this carries the model proof forward without claiming another simulation run.

F1 is a repeat-clear test: these accounts were paid on the earlier release.
An initial admin fixture accidentally erased displayed clears while permanent
receipts correctly blocked duplicate payment. That failed test is preserved;
the fixture now retains verified paid history. F3 paid 800 each; the host also
earned 4,000 from authoritative level-40/profession-chosen achievement claims.
F9 Elite paid 3,750 each. F15 paid 9,000 each, with the host's 1,500 daily entry fee
confirmed by its saved reservation receipt. The repeat finale paid no second
first-clear currency. Every settlement retry left currency/progression unchanged.

F3's opening six and round-five four-enemy wave were observed in the live browser;
its HUD, waiting controls, cooldowns and inspection worked without console errors.
F9 summoned six 8,024-HP adds with 1.1 Elite damage and level-50 mastery. F15's
reinforcement phases also executed. Screenshots and initial/terminal snapshots
are retained in the live report.

A separate controlled wipe passed 22 checks: all four players deliberately passed turns, lost in round 24, received no currency, retained earned clears/claims, and were released from both room membership and active-run recovery. Repeated loss settlement changed no currency or progression. This is a recovery-path test, not a balance loss-rate sample.

A separate CI setup run created only 23 of 24 accounts and correctly failed. Its exact original rejection was not logged, so its cause remains unknown. The [harness repair](https://github.com/Timehue/ShinobiX/pull/516) fixes a reproduced name-generation flaw and adds credential-free phase/status diagnostics. Nine focused tests and a local 24-account/176-request run passed; the frozen Tower branch's own complete 24-client CI check passed independently. The local capacity run uses in-memory storage and is not production load certification.

One intermediate browser job recovered a Creator-control retry. Trace review established a separate deferred-scroll navigation race; the [presentation repair](https://github.com/Timehue/ShinobiX/pull/517) passed 20 repeated compact cases and 28 production-preview cases across seven browser/viewports, all with retries disabled. It changes no credential or gameplay calculations. The original retry and failing-before regression remain explicit in the evidence. Its first full-CI client job reached the 35-minute ceiling during the initial git fetch, before build or lint; that infrastructure failure is preserved separately from browser-test results.

The [save-ownership fix](https://github.com/Timehue/ShinobiX/pull/514) is on main and live at `13a6de72`. It preserves server-confirmed cleared floors on ordinary saves, closing both erased-replay charges and forged-free-entry paths. Exact-release live save probes and a fresh four-client finale repeat passed.

The corrected deployment maps to main `2a2e401a1`, with all 56 CI jobs, image, CodeQL and post-deploy deep-storage checks passed. The final four-client Rest Shrine replay won floor15 in 20 rounds and 168 accepted actions, passing 46 assertions. Another 54 ordinary-save assertions and 7 receipt/economy assertions passed on that exact release: 107 follow-up assertions and 365 total live assertions. All four replay currency deltas were zero; entry was free and uncounted. The deployment workflow is confirmed disabled after the one-shot promotion.

All 41 final-main browser-job logs were reviewed. The sole recovered Firefox page-readiness timeout is preserved with its trace classification and test-only follow-up in PR518; no unresolved product regression was identified.

These are automated four-client production runs with prepared disposable profiles.
The live checkpoints cover four floors and all three routes; the model covers
the full climb and five compositions. This is not a population clear-rate,
four-human usability, large-scale load or failover certification.
<!-- current-live-certification:end -->
