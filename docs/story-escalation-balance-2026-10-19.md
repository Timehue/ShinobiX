# Story boss difficulty progression — 2026-10-19

Level 85 now puts more pressure on the same prepared reference builds than level 75. The four level-100 finales push harder again while retaining surviving unlock-level wins. Level 75 and every level-65 setting remain unchanged.

All **96 normal village-start fights** ended with positive player HP and the actual boss defeated before the 25-round limit. These are deterministic production-engine simulations, not human win rates.

| Village | Median lowest observed HP at 75 | At 85 | At 100 | Median ending HP at 100 |
| --- | --- | --- | --- | --- |
| Stormveil | 30% | 23% | 19% | 19% |
| Ashen Leaf | 31% | 23% | 13% | 13% |
| Frostfang | 24% | 20% | 10% | 10% |
| Moonshadow | 33% | 22% | 9% | 9% |

At level 85 the median build uses two basic heals, compared with one at 75, and fights for 13 rounds rather than 8–9.5. In every village, actual HP loss after accounting for healing increases from 75 to 85 and again to 100. A late heal can raise ending HP, so ending HP alone is insufficient to compare the tiers. Frostfang85's median ending HP is 31%, above Frostfang75's 24%, despite its lower observed HP trough, greater actual HP loss, extra recovery and longer fight.

## Authored changes

The owner is `api/story/_authoritative-story-combat.ts`:

- **85:** Stormveil/Ashen Leaf signature power 68 → 72; Frostfang 68 → 73. Moonshadow's 65-power signature stays unchanged because its existing burst already creates the required pressure. HP, defenses, AP, costs and cooldowns stay unchanged at this tier.
- **100:** Stormveil gets 10,000 HP and 1,525 raw stats; Ashen Leaf 10,300 / 1,625; Frostfang 10,300 / 1,475; Moonshadow 10,000 / 1,600. Previous HP was 9,800; previous raw stats were 1,500, or 1,450 for Frostfang.
- All twelve finale techniques, their catalog effects, AP, costs and seven-round signature cooldowns, mastery50, resource pools, armor and exclusive Apex planning remain intact. The final bosses still have their full offensive, setup, defensive and movement choices.

The fresh baseline guard preserves **29 other story profiles**, including every level-75 and earlier boss and Moonshadow85, plus every narrative group. Source IDs, names, portraits, specialties, kits, reward-facing bindings and settlement remain unchanged. Exact HP/stat sealing tests exclude Tower floor inflation and loadout-dependent enemy scaling.

## Reference builds and evidence

Before/after home comparisons use the same frozen builds and visible-state policy as the previous late-story pass: all four schools, balanced/focused earned-point allocations, acquired Earth/Wind techniques, twelve free slots, ordinary rare shop gear, mastery30 at75/85 and40 at100. The finale preparation has eight damaging techniques. There is no bloodline, pet, relic, consumable or mid-fight reset.

The fixed policy heals below55%, uses weapons/utility, clears active setups and cleanses harmful effects. It does not search future responses. The new `healthSpent` metric uses the resolver's lifetime applied-healing facts: `(starting full HP + actual healing − final HP) / max HP`. It measures HP lost throughout the encounter and can exceed100% when healing keeps the player alive. It does not parse dialogue or estimate a synthetic character-power score.

Early candidates with larger uniform increases caused ordinary home-build defeats, especially against Moonshadow, and were rejected. Additional Frostfang HP and damage probes did not improve the overall balance. The accepted settings change three signature powers and the four finale budgets only. Experimental alternative technique priorities and healing thresholds were not used for the final matrices.

## Terrain scope

Every one of the **480 field/build outcomes** is retained in the numeric evidence, including losses and draws. The acceptance rule requires at least seven surviving reference clears out of eight in each village/biome, and a surviving clear in **every school** there. Normal village starts retain the stricter eight-of-eight requirement.

This intentionally replaces the earlier requirement that every allocation win every biome with one fixed bot policy. The stronger bosses can punish an unfavorable build/terrain combination. The field guard still detects a biome that blocks a whole school, and every accepted clear requires a real knockout before the round limit. The final result is **478/480 surviving clears**: one focused Genjutsu loss against Frostfang85 in forest and one focused Ninjutsu loss against Moonshadow100 in snow. The other reference allocation in each school clears those matchups. All60 village/biome buckets satisfy the guard.

## Verification

- **55 focused checks passed**, covering story/group completion, exact budgets, appearance/identity, weapons, settlement and the level-65 regression.
- **19 tier checks passed**, including all96 home fights, the per-village progression assertions, the complete profile/group preservation guard, and exact sealed stats/HP/Apex policy.
- **Server TypeScript build passed.**
- **Full suite passed:** `npm run test:ci` finished with exit0: **16,159 passed, 28 skipped, zero failed and zero cancelled** (16,187 total), in1355.9 seconds. This includes the new per-village progression and terrain guards.

The [numeric evidence](story-escalation-balance-2026-10-19.json) contains full fixtures, source hashes, every outcome, frozen before/after profiles and controlled candidate probes. This is an engineering balance report and does not change project KB state.

Reproduce home results with `node --import tsx scripts/story-escalation-balance-audit.ts .tmp/story-escalation-after.json`; append `--field` for all field outcomes or `--candidate baseline` for the frozen pre-change settings.
