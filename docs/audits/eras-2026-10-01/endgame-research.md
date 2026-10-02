# Era IV and V: endgame research and proposed redesign

Status: **historical proposal**, October 1, 2026. The owner subsequently authorized fixing IV/V. The [Master/Grandmaster implementation record](master-campaign-implementation.md) and [current canonical rules](../../era-chapters.md) supersede this snapshot for implemented admission, workloads and examinations. The new normalized trials, solo alternatives, encounter variants and emblem artwork below remain future content. This research snapshot itself changed no gameplay configuration or production data.

Current implementation is documented in [World Era Chapters](../../era-chapters.md). The former short independent investigations were insufficient as personal completion and have now been replaced. The original [era audit](README.md) remains historical evidence.

Subsequent implementation hardened I–III. [Integration review](integration-review.md) verifies their current connections and records the correction to Weekly Boss credit instructions. IV/V's proposed workload and predecessor requirements need rebasing against that implemented ladder; the research snapshot below predates those changes.

## Recommendation

Give personal eras a progression from apprenticeship to Grandmaster mastery. Make IV a substantial Master campaign and V the game's pinnacle Grandmaster campaign. Both need specific encounter evidence, several permanent intermediate accomplishments, substantial qualified activity, and a mandatory final trial. Their alternative routes must meet comparable difficulty.

Keep world history and personal accomplishment visibly separate. A world opening celebrates the server and makes the campaign available; each player must still earn its completion. IV's world history is already unlocked. Existing Weekly Boss, Gate and other shipped systems should retain their current admission rules.

The brief investigations already authored can become campaign introductions. Three ordinary hunts or a small contribution should not award the final Master accomplishment.

## External research

These are historical design examples, not claims about every current rule in the referenced games. Their lessons for Shinobi Journey are inferences.

| Primary source | Evidence | Application proposed here |
| --- | --- | --- |
| [Jagex: Combat Achievements, July 21, 2021](https://secure.runescape.com/m=news/combat-achievements?oldschool=1) | Six difficulty tiers; higher tiers introduce demanding boss and speed challenges. Tasks include distinct ways of defeating bosses, with progress and cosmetic recognition. | Name and verify individual mastery feats. Earning volume cannot substitute for the hardest required feat. |
| [ArenaNet: A Legendary Journey](https://www.guildwars2.com/en/news/a-legendary-journey/) | Precursor journeys have themed collections, research and crafting stages, and visible intermediate forms. | Each era tells an unfolding story through different work, with a tangible reward after each major stage. |
| [ArenaNet: New Rewards in Secrets of the Obscure](https://www.guildwars2.com/en-gb/news/new-rewards-in-guild-wars-2-secrets-of-the-obscure/) | Legendary armor components span open-world gameplay and prerequisite collections. Wizard's Vault cosmetics remain obtainable through its legacy section. | Breadth and permanent availability can support a substantial long-term goal. Late arrivals retain a route to the same earned mastery rewards. |
| [Bungie: This Week in Destiny, July 18, 2024](https://www.bungie.net/7/en/News/Article/twid-07-18-2024) | Missing Master challenge credit interfered with a prestige title; weekly availability made recovering that credit difficult. Bungie opened all challenges temporarily. | Preserve exact achievement receipts, recover settlement failures, and provide repeatable trials without waiting for a specific weekly rotation. |
| [Blizzard: The Scarab Lords are Rising](https://news.blizzard.com/en-us/article/23482836/wow-classic-ahnqiraj-the-scarab-lords-are-rising) | Realm resource contributions and a long individual quest culminated in a shared opening, with special recognition for opening participants. | Maintain separate community participation, world-first history and repeatable personal mastery. A server-wide bar alone does not measure an individual's skill. |

## What the game actually provides

Evidence below is checked-in working-tree code, supported where stated by local tests/simulation. No authenticated live population or deployed tuning was inspected.

| Finding | Evidence owner | Classification and consequence |
| --- | --- | --- |
| All five investigations can be accepted concurrently; their baseline objectives overlap. IV permits three hunts or 1,000 boss contribution; V permits five missions/two discoveries or two extractions/one discovery. | `shared/era-chapters.ts`, `api/eras/journey.ts` | **Design ambiguity resolved by owner clarification:** the current personal IV/V design is below the intended difficulty. |
| Ordinary mission claims share a 20-per-day cap; hunts have a separate 20-per-day pool. Combat missions progress from E at level 1 to S at level 70. | `api/missions/_mission-catalog.ts`, `api/missions/claim-mission.ts` | **Implemented behavior:** five ordinary missions can fit within one play day. A 60-mission objective can fit within three capped days. |
| The era chapter's flat mission proof does not distinguish E from S. Ordinary A/S enemies have fixed levels 55/75 and become easier with later progression. | `shared/era-chapters.ts`, `api/missions/_mission-catalog.ts`, [authored mission measurements](../../authored-mission-encounters.md) | **Design gap:** ordinary rank alone will not preserve endgame challenge at level 100. Specific mission identity and a challenge ruleset are needed. |
| A Legacy-qualified Gate clear can be an extraction after three minutes, with no boss victory. | `api/hollow-gate/settle.ts` (`legacyQualifyingClear`) | **Implemented behavior:** the extraction counter cannot prove full-dungeon mastery. |
| Standard Gate depth is five, but shorter variants are supported. Current run records retain depth/current floor, augment, and resolved encounter identities. | `shared/hollow-gate-contract.ts`, `api/hollow-gate/_run-token.ts`, `api/hollow-gate/settle.ts` | **Reusable evidence with integration gap:** verify full standard depth and its final boss, successful extraction and run identity. Do not count a short variant as a standard full clear. |
| Weekly Boss is manually spawned, remains for 72 hours, permits three attempts per spawn, and settles leaderboard rewards at expiry. Depleting shared HP marks it Broken instead of despawning it. | `api/weekly-boss.ts` | **Implemented behavior:** damage or top-ten rank is participation/competition evidence, not sufficient proof of a difficult win. Top ten is also population dependent. Existing chapter prose saying credit arrives when the beast falls is imprecise and should be corrected in the next implementation. |
| Spire has 20 tiers and late bosses with escalating hazards, healing restrictions and round pressure. | `api/towers/_spire-catalog.ts`, `api/towers/_modifiers.ts` | **Reusable challenge content:** a much stronger foundation than ordinary hunt totals; additional challenge qualification remains necessary. |
| Tower records are server credited and distinguish floor, route and human party size. Clean clears, pylon disruption, charge baiting and signature avoidance have existing evidence. | `shared/tower-progression.ts`, `api/towers/_records.ts`, `api/towers/_records.test.ts` | **Tested evidence:** reuse the authoritative clear session, not a client achievement flag. Existing lifetime honors alone cannot prove the feat happened on a particular high floor. |
| Personal-best score, fastest rounds and clean state can come from different clears. Records preserve maxima/minima independently. | `api/towers/_records.ts` (`towerRecordsForClear`) | **Implemented behavior:** require clean AND within par in the same run receipt, rather than combining lifetime best fields. Likewise, an evade plus a clean result from different runs cannot prove one trial. |
| Clan Boss Operations score damage, healing, shielding, cleanses, objectives and actions; an active contribution tier already exists. | `api/clan-boss/_contribution.ts`, `shared/clan-boss-operation.ts` | **Reusable role-sensitive evidence:** group feats can recognize support. Current contribution scoring needs its own validation before being used as a mastery gate; pressing enough actions alone can raise score. |
| Legacy trials seal fresh baselines and progress through Awaken, Bind, Prove and Mythic. Requirements vary by identity and scale with rarity. | `api/_legacy-core.ts`, `api/legacy/trial.ts` | **Tested reusable progression:** require Stage IV/Stage V as identity milestones, with era-specific trials independently establishing difficulty. Stage V is distinct from owning a mythic-rarity Legacy. |
| Legacy acceptance preserves one path; rarity is deliberately hidden from player-facing identity categories. | `api/legacy/_acceptance.ts`, `api/_legacy-defs.ts` | **Design constraint:** requiring personal mythic rarity would strand players who permanently chose a different path. Any rarity may earn era mastery by completing the hard era feats. |
| World eras I–IV are historical unlocks. V requires several lifetime community totals plus a first mythic-rarity Legacy awakening, Stage I to II. | `api/_era-defs.ts`, `api/_era.ts` | **Implemented behavior:** community quantities and trigger age cannot establish how long personal campaigns will take. Do not confuse the Stage V Legacy trial with the world trigger. |

## Controlled combat results

[Probe source](endgame-probe.mts) and [full results](endgame-probe-results.json) retain parameters and outputs. The probe drives the actual Tower encounter builder, engine and enemy AI with the repository's deterministic geared-player policy. Fifteen scenarios × 64 seeds = **960 simulated floor attempts**. Blessing week 0 only.

| Fixture | Floor 12 | Floor 15 | Floor 18 | Floor 20 |
| --- | ---: | ---: | ---: | ---: |
| Geared four-member baseline | 89% | 72% | 63% | 42% |
| Same baseline with three members | 0% | 0% | 0% | 0% |
| Same baseline solo | 0% | 0% | 0% | 0% |
| Stronger four-member sensitivity | Not sampled | 100% | 98% | 100% |

Baseline uses the existing sim's level-100 fixtures: 12,000 HP, composite stats 2,500, bloodline multiplier 1.4, item damage +30%, and its authored jutsu policy. Stronger sensitivity increases jutsu effect powers by 1.4, bloodline multiplier to 1.56 and item damage to +42%; it does not change enemy configuration. That is a deliberately stronger hypothetical build, not an observed player cohort or a universal 40% DPS change.

Interpretation: high Spire floors are a useful reference, but raw floor completion can become a gear check. Mandatory unscaled four-person clears would also make party availability a blocker. A separately balanced personal trial route needs the same tested competency, rather than sending one player against the four-member encounter or granting an easy hunt bypass.

Most baseline losses were timeouts, not wipes. Survival alone would therefore be a weak criterion. This probe does not measure joint clean/within-par probability, human performance, campaign learning time or a new trial's difficulty. Floor 18's 64-seed result exceeds the existing release test's 55% upper band; its smaller fixed seed sets are not a population confidence interval. Retain this sampling observation for the next Spire balance review without changing its balance here.

## Proposed personal campaign ladder

These are difficulty roles, not new world content locks. I–III should train the competencies that IV/V test, and each needs a story consequence and several stages rather than one short counter.

| Personal era | Role | Suggested structure |
| --- | --- | --- |
| I | Earn field competence | An authored mission sequence, preparation lesson and final field examination. Multiple briefings; introduce reading an opponent and spending resources deliberately. |
| II | Become a reliable expedition shinobi | Map investigation, Gate floor progression, hazard decisions and a real final-boss extraction. Early extraction remains normal gameplay but does not finish this campaign. |
| III | Earn command responsibility | Several village/field operations, objective protection and formation encounters, ending in a command trial. A meaningful solo command route supports low-population periods. |
| IV | Master: reliable against endgame threats | Four seals, demanding mission work, full Gate clears and high-tier combat mastery, ending in a new Master examination. |
| V | Grandmaster: mastery under combined pressure | IV prerequisite, harder varied operations, Legacy summit, advanced Gate trials and a multi-phase Grandmaster examination. |

Personal progression should be sequential. Later milestones require newly sealed runs from that campaign/stage. World contribution can continue during this work, and one run can satisfy related objectives within its current stage. It cannot complete multiple personal eras simultaneously. Advance completed stages automatically in a save transaction so a player does not lose proof while waiting to click a claim button.

## Era IV: Four Seals on One Order

Proposed admission: personal III complete, level 70+, and the world's historical IV availability. Existing activities remain independently accessible. Each seal earns a permanent record, a new eyewitness scene and part of a visible cosmetic emblem.

1. **Field seal:** 200 qualifying A/S commissions, including at least 80 S equivalents. Split the work among authored encounter families and stages. Ordinary low-rank jobs do not count. Fixed-level ordinary A/S repetitions alone are insufficient: use commissioned variants with declared encounter power bands and different tactical objectives. This is the initial workload budget to test, not a reason to repeat the current two high-rank opponents 200 times.
2. **Gate seal:** 15 successful five-floor standard descents with final-boss victory and extraction. Include mastery feats such as a specified risk augment clear and dealing with an authored hazard objective. Exact feat counts require Gate measurements. Partial/three-minute extractions do not qualify.
3. **Tactics seal:** qualify at Spire tier 15 and earn at least four distinct difficult feats: a clean clear, successful charge bait, signature avoidance and pylon disruption on eligible encounters. Clear-plus-feat must be witnessed in the same run on a declared floor. An equivalent personal examination route must be built and balanced separately before the campaign ships.
4. **Identity seal:** bring any accepted Legacy to Stage IV, Proven, and complete a role-appropriate defense or support objective. Already proven permanent Legacy stages may satisfy this milestone; the era feats themselves stay fresh.
5. **Final Master examination:** a new three-encounter sequence combining threat priority, resource management and hazard positioning. Seal a public challenge power ceiling and loadout at entry. Permit healing/support; require the objective, a calibrated round budget and no shinobi knockout. Carry resources between its encounters with an explicitly defined recovery allowance. Retry the examination on failure; retain all earned seals.

The existing “three hunts” and “1,000 damage” choices may provide an introductory scene or field note. They cannot substitute for any required seal or final examination.

## Era V: The First Mythic Survey

Proposed admission: personal IV complete, level 100, and world V unlocked. “Mythic” describes the campaign's tier; a player keeps their chosen Legacy identity.

1. **Grandmaster field record:** 400 qualifying S/Mythic commissions across the full authored challenge roster and distinct tactical objectives. Fresh after V admission, with rising stage difficulty. Same daily mission pool as IV; no extra premium or parallel pool. New Mythic commission encounters must be authored and tested; ordinary S missions alone do not prove Grandmaster mastery.
2. **Deep survey:** 40 full-depth boss-cleared Gate extractions, including a set of separately measured mastery variants. Require successful risk decisions and objective execution. Do not make a randomly offered augment the only way to attempt a mandatory trial: its dedicated challenge version must be selectable/repeatable.
3. **Pinnacle tactics:** a clean tier-20-equivalent victory within its calibrated par **in the same run**, plus several distinct late-tier mechanics feats. Provide independently tuned personal and group trial routes; both must pass the same difficulty exit criteria. A literal solo Spire 20 requirement is unsupported by current simulation.
4. **Legacy summit:** reach Stage V on the player's chosen Legacy, at any rarity. Existing server-witnessed summit receipts may satisfy this identity milestone. It is an additional long-term achievement, not the sole source of V's difficulty.
5. **Final Grandmaster examination:** a new three-phase encounter that combines the Master lessons: break protection/adds while avoiding telegraphs; defend an objective with constrained resources; finish under increasing arena pressure. A run requires clean completion and its round par. Normalize the maximum combat advantage for this examination, seal deterministic challenge rules at entry, and prevent carried external buffs/consumables from bypassing them. Build variety and role tools remain available within that public envelope. A failed phase restarts the examination, preserving campaign progress. Disconnects resume the sealed run rather than awarding a reset or forfeiting proof.

IV teaches and tests the competencies separately; V combines them. Both alternatives must retain a difficult capstone. A support route needs a genuine objective and personal contribution evidence, rather than a smaller damage floor. A competitive variant can be an additional prestigious mastery record; mandatory core completion should not depend on finding enough ranked opponents or placing above other players.

## Quantities and duration

Provisional mission budgets are **200 for IV and 400 for V**. They are supporting workload, not a definition of skill. Gate counts of 15/40 are also provisional until full-depth run costs and success rates are measured.

For successful qualifying commissions per play day `r`, the mission component takes `ceil(required / r)` play days. With 4–6 play days per week, five qualifying successes per day implies about 7–10 weeks for IV and 13–20 weeks for V before considering prerequisite growth and final trial learning. This motivates initial duration targets of roughly **6–10 weeks for IV and 3–5 months for V**, measured from personal campaign admission. These are proposed goals with an explicit activity assumption, not forecasts.

| Successful qualifying commissions per play day | IV mission component | V mission component |
| --- | ---: | ---: |
| 2 | 100 play days | 200 play days |
| 5 | 40 play days | 80 play days |
| 10 | 20 play days | 40 play days |
| Current 20-claim/day cap | At least 10 reset-day slots | At least 20 reset-day slots |

The cap figures assume every slot is an eligible victory and IV/V commission claims consume the existing mission pool. They are not exact elapsed 24-hour durations; play immediately around a daily reset changes elapsed time. The ordinary one-time Academy claims and independent hunt pool do not supply qualified commission proof. Stage III completion, Gate runs and trials add work. Objectives within a stage can progress together, so their durations cannot simply be added.

Skilled, prepared players may finish faster than the target. Exact minimum calendar months would require explicit calendar locks; that is not recommended here. Avoid daily streaks, missed-week penalties, rotation-only attempts and resetting months of effort on one failed final attempt. Difficulty should come from learning, preparation, breadth and execution.

Community quantity sensitivity is separate: 5,000 missions from a zero baseline at 10 daily qualifying claims/player would take 100 days with five active players, 20 with 25, or five with 100. Existing world totals are lifetime counters, and other requirements/the mythic awakening trigger also apply. These examples do not predict current world-V unlock time. Use deployed participation measurements before changing community totals, and preserve recorded unlocks.

## Making the accomplishment visible

Show every stage and future mastery condition before commitment. Track specific feats by name, show their exact failure reason and link to practice. Give each seal its own short story reveal; conclusions should describe what the player demonstrated and how the expedition/village record changed.

Proposed final recognition: a unique Master/Grandmaster title, evolving profile/nameplate border, a permanent personal Hall entry with feat receipts, and the completed chronicle. Cosmetic presentation should be visibly stronger at V. Avoid large stat bonuses that let an era winner trivialize the next era or dominate players who have not finished it. World-first recognition remains a separate historical distinction; everyone can earn the personal mastery reward later.

Existing low-effort titles should not be silently reinterpreted as proof of a Master campaign. If any version has reached players before redesign, preserve its earned cosmetic ownership and introduce a separate mastery completion record/reward.

## Implementation and balance exit gates

This proposal needs more than numeric edits to `shared/era-chapters.ts`:

- A versioned stage/feat contract and migration; campaign admission, fresh run timestamps, difficulty/roster versions, power envelope, stage transitions and atomic rewards must be server owned.
- Typed qualified mission evidence. Current claim authority has mission/profile/run identity, but the flat chapter counter does not retain rank, challenge envelope, tactical feat or difficulty version.
- Full Gate evidence from its sealed ledger: standard depth, final boss, augment/objective, extraction outcome and unique run ID. Shortened variants and early extractions cannot alias the hard feat.
- Tower evidence from the exact clear session: tier, route, party size, individual participation, rounds, knockout history and mechanic feats. Add a durable campaign receipt; eight-day comparison receipts and global lifetime honors are insufficient by themselves.
- New authored Master/Grandmaster mission variations and examinations, independently measured solo/group balance, and role-sensitive participation so presence or trivial repeated actions cannot substitute for play.
- Recoverable exact-once settlement. A successful fight must not lose credit to an announcement outage, retry, expired transient evidence or response loss. Same-run joint predicates must be evaluated before evidence is discarded.

Before promoting the provisional numbers: inspect safe aggregate activity rates, qualifying mission win rates/durations and full Gate costs; test admission, typical endgame and stronger builds across combat styles and support; measure new trial success, failure causes and clean/within-par joint outcomes. Test all available blessings and party sizes. Demonstrate that readable correct counterplay can win and common incorrect responses fail. Establish challenge ceilings with fixtures rather than guessing multipliers.

Then run human playtests for learning time and clarity, and validate late-player/migration/reconnect/retry behavior. Record median and upper-tail stage time, repeated-opponent share, attempt count and abandonment. Revisit counts if the field record is repetitive, and retune the challenge envelope if stronger ordinary gear bypasses the capstone. No live telemetry result, new encounter success target or completed human playtest is claimed here.

## Reproduction and validation

```text
node --import tsx docs/audits/eras-2026-10-01/endgame-probe.mts
node --import tsx --test scripts/spire-balance.test.ts api/towers/_records.test.ts api/_legacy-defs.test.ts
```

The probe performs local engine simulation and writes only its adjacent research JSON. It does not execute player settlement endpoints or query production storage. The TypeScript runner required local compiler-worker spawning outside the Windows sandbox.

Validation completed: the probe finished all **960 simulated floor attempts** and saved its results; **35 existing tests passed**, including all Spire release bands/blessings at their configured seed counts, authoritative Tower achievement evidence and Legacy definition/trial invariants. The wider probe's floor-18 sampling observation remains separate from those passing release checks. Document links and whitespace were checked locally.

Gameplay implementation, deployed overrides, human playtest and live population calibration remain outstanding; the proposal is reviewable without treating those steps as already done.
