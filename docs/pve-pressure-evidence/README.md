# Progressive PvE pressure evidence

This is an offline comparison against `e2ccccb0d` through the production Solo PvE builder and resolver. It never reads or mutates live saves. `explore-comparison.json` and `road-comparison.json` retain each path's seeded cases separately; `summary.json` groups every included case without selecting favorable results.

## Legal mastery and effective EP

The character-rank mastery cap is 10 below character level 15, 20 at levels 15–29, 30 at levels 30–49, and 50 at levels 50–100. Player timed ryo lessons stop at mastery 30; Honor Seal lessons stop at 40; mastery 40–50 requires battle progression. NPCs use those same milestones:

| Character level | Weaker | Standard, ryo-trained | Dangerous, Seal-trained | Elite, battle-trained | Final Kage |
| --- | --- | --- | --- | --- | --- |
| 10 | 7 | 10 | 10 | 10 | — |
| 25 | 14 | 20 | 20 | 20 | — |
| 50 | 21 | 30 | 40 | 50 | — |
| 75 | 21 | 30 | 40 | 50 | — |
| 100 | 21 | 30 | 40 | 50 | 50 |

The table uses the **enemy's actual level**, which can be below the player's. All values remain rank-capped. Unclassified protected modes retain their previous mastery curve. Already sealed sessions keep their sealed numbers.

The shared formula is unchanged: `(authored EP + 10) × (0.3 + 0.7 × mastery / 50)`. A catalog EP-36 damaging technique therefore has effective EP 20.24 / 26.68 / 33.12 / 39.56 / 46 at mastery 10 / 20 / 30 / 40 / 50. Ordinary 40-AP setup techniques do zero direct damage. Mastery is applied once; no NPC damage multiplier or HP bonus is added.

Standard ordinary opponents learn five damaging catalog techniques at level 36 and six at level 86. Dangerous and elite opponents learn the larger rotations sooner. Each kit remains at most eight techniques including thematic setup and Flicker. The extra techniques cover existing seven-round cooldown gaps; they retain the same effect power, AP, cooldown and canonical chakra/stamina costs as player techniques. Weaker opponents and levels 1–35 keep their authored kits. Named rivals and authored mission/raid kits are outside this replacement.

The new classified encounters also fix a cost-sealing mismatch: the old NPC builder retained catalog split-bar costs while player hydration applied `v2JutsuCosts`. At level 100 a costed 60-AP technique now spends 350 from its discipline bar, a 40-AP setup spends 175, and Flicker spends 90 stamina, exactly as for the corresponding player technique. A technique authored free remains free. Ordinary encounter and final Kage pools come from `maxChakraForLevel` / `maxStaminaForLevel`, reaching 10,000 each at level 100. Existing regeneration still applies. This uses the existing shared rules without changing their tiers or any PvP formula.

## Comparison design

Explore covers player levels 10, 25, 50, 75 and 100; starter, midgame, offense, defense and maxed styles; all four ordinary tiers; and all four final story Kage at level 100. Five ordinary seeds cover the five archetypes and varied opening distances. Road encounters have their own comparison at the same five levels, using midgame/maxed builds and three seeds for bandit, nightblade and rival miner. Each path uses its own original construction behavior:

- Explore `before` passes the authored catalog profile into the old builder with player-level scaling, which uses the original resolved kit's role-weighted stat budget.
- Road `before` reproduces the old `runtimeProfile`: player + 1 (capped at 100), generic allocation, rogue/burst/sentinel templates for bandit/nightblade/miner.
- `after` uses the real `ordinaryAiProfile` helper and sealed tier level, original-template role allocation, progressive kit, legitimate mastery and v2 costs. Role allocation redistributes the same legal total stat budget. A weaker fixture uses 75% of player level; other tiers use player level, the upper end of standard rolls. Regional ceilings and actual roll distributions have separate handler tests.
- `before-matched-mastery` is a controlled isolation: the old runtime and kit at the candidate's enemy level and legal mastery. It must not be confused with an unchanged old encounter. Actual-before weaker rows retain the old player-relative level.

Player builds, opening positions and neutral terrain/no weather are shared across variants. Ordinary HP changes only when the sealed enemy level changes; tier and tactical upgrades add no HP. Final Kage retains 14,000 HP. Below level 50, the five Explore role fixtures are diagnostic catalog inputs, rather than a claim that every role belonged to the old random eligible pool at that level. All five roles were eligible by level 50. Authoritative receipt/queue/settlement integration is exercised by separate handler regressions.

Fixtures use the server's actual hydration and resource rules. Armor, sustain and damage passives come from equipped item definitions, rather than handwritten multiplier fields the server would ignore. The maxed level-100 fixture has capped stats, mastery 50, an S-rank multiplier, catalog armor and a ranged catalog weapon. This is a synthetic Rill-style scenario, not a copied live Rill account. Lower-level fixtures use their earned stat budget and rank-legal mastery. The stronger scripts heal, maintain available protection, clear visible meaningful buffs, and rotate jutsu with their equipped weapon; they do not optimize every turn or use consumables/pets.

## Reading the measurements

- `rawAfterMitigation`: resolver damage after DR and status amplifiers, before the encounter guard. It is **not** pre-DR damage.
- `formulaBaseDamage` and `drDeductionBeforeAmplifiers`: candidate cast telemetry before DR and its DR component. Legacy events lack these fields; missing values are not zero. Other amplifiers and Pierce can intervene between formula base and resolved damage.
- `resolvedAfterGuard`, `guardPrevented`, `enemyDirectHpDamage`, and `damageToShield`: observed enemy-action pressure, with Clear shield removal excluded from direct damage.
- `damageToHp`: all observed HP loss including damage during other action phases, such as DOT/recoil. `playerHealing` is observed applied healing; simultaneous damage/healing can net inside an event. `netHpLoss` and minimum/final HP are exact state measurements.
- Actual deaths (`death`) are separate from `roundLimitLoss`. The existing 25-round limit can lose a fight while the player remains alive; such a result is not evidence of a lethal offensive rotation.
- AP, non-damaging turns, cooldown dry turns, remaining resource differences and action distributions are retained per fight. `wastedAp` counts unspent AP including a terminal partial turn; a legal finisher can leave AP unused. A non-damaging turn may be purposeful utility, rather than a failed offensive action. Resource differences include existing regeneration, so they are net expenditure rather than gross cast cost.

Timing includes the fixture's player-action proposals/rejections and was collected under concurrent local validation. It is supporting evidence rather than a portable AI latency guarantee. Bounded planner regression tests cover the computation limit separately. These fixtures are diagnostic samples, not a claim that all builds or players should end at a universal HP percentage.

## Reproduction

Create a clean archive of `api/`, `shared/` and `scripts/` at `e2ccccb0d` in a separate directory and make the same locked Node dependencies available to that archive. On Windows, `NODE_PATH` may point to the current checkout's `node_modules` for its CommonJS dependencies.

```powershell
node --import tsx scripts/pve-pressure-benchmark.ts --baseline-root <archive-directory> --seeds 5 --output docs/pve-pressure-evidence/explore-comparison.json
node --import tsx scripts/pve-pressure-benchmark.ts --baseline-root <archive-directory> --path natural --levels 10,25,50,75,100 --builds midgame,maxed --seeds 3 --output docs/pve-pressure-evidence/road-comparison.json
node --import tsx scripts/pve-pressure-benchmark.ts --summarize docs/pve-pressure-evidence/explore-comparison.json --output <explore-summary.json>
node --import tsx scripts/pve-pressure-benchmark.ts --summarize docs/pve-pressure-evidence/road-comparison.json --output <road-summary.json>
```

Relevant regressions are in `api/_pve-encounter-mastery.test.ts`, `scripts/pve-pressure-benchmark.test.ts`, the ordinary encounter tests, and the engine's progressive tactics tests. No shared PvP formula, catalog jutsu balance, production migration or live combat mutation is part of this work.

## Measured results

Final source: 520 Explore/story cases (1,560 variant rows) and 120 road cases (360 variant rows), all completed. The table includes every build/archetype in each source cell. Pressure means observed direct HP plus shield damage per enemy turn; Clear shield removal is excluded.

| Path | Level | Tier | Pressure before → after | Change | Deaths before → after | Limit losses before → after |
| --- | --- | --- | --- | --- | --- | --- |
| explore (25 cases) | 50 | weaker | 705.8 → 452.4 | -35.9% | 11 → 5 | 0 → 0 |
| explore (25 cases) | 50 | standard | 705.8 → 786.3 | 11.4% | 11 → 13 | 0 → 0 |
| explore (25 cases) | 50 | dangerous | 705.8 → 912.4 | 29.3% | 11 → 15 | 0 → 0 |
| explore (25 cases) | 50 | elite | 705.8 → 989.0 | 40.1% | 11 → 20 | 0 → 0 |
| explore (25 cases) | 75 | weaker | 664.0 → 430.5 | -35.2% | 17 → 5 | 4 → 0 |
| explore (25 cases) | 75 | standard | 664.0 → 853.2 | 28.5% | 17 → 19 | 4 → 0 |
| explore (25 cases) | 75 | dangerous | 664.0 → 1017.9 | 53.3% | 17 → 23 | 4 → 0 |
| explore (25 cases) | 75 | elite | 664.0 → 1185.9 | 78.6% | 17 → 25 | 4 → 0 |
| explore (25 cases) | 100 | weaker | 528.6 → 317.5 | -39.9% | 14 → 5 | 10 → 0 |
| explore (25 cases) | 100 | standard | 528.6 → 722.2 | 36.6% | 14 → 16 | 10 → 8 |
| explore (25 cases) | 100 | dangerous | 528.6 → 876.1 | 65.7% | 14 → 21 | 10 → 3 |
| explore (25 cases) | 100 | elite | 528.6 → 973.5 | 84.2% | 14 → 24 | 10 → 1 |
| road (6 cases) | 50 | weaker | 508.7 → 322.3 | -36.6% | 2 → 0 | 0 → 0 |
| road (6 cases) | 50 | standard | 508.7 → 588.5 | 15.7% | 2 → 3 | 0 → 0 |
| road (6 cases) | 50 | dangerous | 508.7 → 742.4 | 46.0% | 2 → 3 | 0 → 0 |
| road (6 cases) | 50 | elite | 508.7 → 880.4 | 73.1% | 2 → 4 | 0 → 0 |
| road (6 cases) | 75 | weaker | 489.4 → 327.8 | -33.0% | 2 → 0 | 1 → 0 |
| road (6 cases) | 75 | standard | 489.4 → 631.0 | 28.9% | 2 → 3 | 1 → 0 |
| road (6 cases) | 75 | dangerous | 489.4 → 833.8 | 70.4% | 2 → 5 | 1 → 0 |
| road (6 cases) | 75 | elite | 489.4 → 906.6 | 85.2% | 2 → 6 | 1 → 0 |
| road (6 cases) | 100 | weaker | 453.7 → 236.4 | -47.9% | 3 → 0 | 2 → 0 |
| road (6 cases) | 100 | standard | 453.7 → 504.4 | 11.2% | 3 → 2 | 2 → 4 |
| road (6 cases) | 100 | dangerous | 453.7 → 644.4 | 42.0% | 3 → 4 | 2 → 2 |
| road (6 cases) | 100 | elite | 453.7 → 744.1 | 64.0% | 3 → 5 | 2 → 1 |

Higher standard/dangerous/elite pressure is an aggregate result, not a guarantee that every archetype is harder for every build. Some bruiser cases become softer with fair mastery; per-case outcomes remain in the JSON. Weaker rolls deliberately become easier.

The maxed level-100 counterplay fixture against each final story Kage:

| Village | Rounds before → after | HP left before → after | Candidate outcome |
| --- | --- | --- | --- |
| Stormveil | 6 → 15 | 9324 → 3081 | win |
| Ashen Leaf | 6 → 13 | 9324 → 3273 | win |
| Frostfang | 6 → 17 | 9324 → 5676 | win |
| Moonshadow | 6 → 19 | 9324 → 2454 | win |

Kage HP remains 14,000, mastery remains legally capped at 50, and resource costs/pools follow the shared player rules. Observed healing, shields, raw/post-guard damage, resources, minimum HP, action distributions and matched-mastery controls are preserved in both datasets. The focused mastery/loadout/resource/constructor/telemetry tests pass (12 tests), and strict benchmark typechecking passes. Repository-wide and browser CI results are reported separately by the implementation owner.
