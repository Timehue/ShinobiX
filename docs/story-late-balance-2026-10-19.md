# Level-75, 85 and 100 story boss balance — 2026-10-19

**Historical pass:** the [difficulty-progression follow-up](story-escalation-balance-2026-10-19.md) subsequently strengthens level85 and100, preserves75, and supersedes the figures and acceptance rule below for those later bosses.

Follow-up: the [level-65 two-nature pass](story-65-two-nature-balance-2026-10-19.md) subsequently makes a small change to those earlier fights. All twelve level-75/85/100 profiles in this report remain unchanged.

All twelve village bosses were checked at their unlock levels through the production Solo resolver. Level 75/85 needed more pressure against prepared builds. The four finales overwhelmed the moderately trained reference builds and needed lower authored stat/HP budgets. Their full kits and exclusive Apex planner remain intact.

All **96 home-village cases** and **480 field biome/build cases** now finish with positive player HP and the actual enemy knocked out before the 25-round limit. A remaining-HP score at the time limit is not counted as a clear. These are controlled simulations, not human win rates.

| Level | Village / boss | Before: median final HP | After: median final HP | After: full final-HP range | After rounds |
| --- | --- | --- | --- | --- | --- |
| 75 | Stormveil — Mira Volt, Estate Bout Rigger | 64% | 34% | 23–53% | 7–13 |
| 75 | Ashen Leaf — Ancestor-Bound Flame Beast | 66% | 35% | 19–53% | 7–12 |
| 75 | Frostfang — Frostfang Oathbreaker Hunter | 59% | 24% | 7–65% | 7–11 |
| 75 | Moonshadow — Shadow Network Hunter | 61% | 33% | 21–63% | 7–13 |
| 85 | Stormveil — Hollow Tempest General | 64% | 35% | 23–56% | 11–15 |
| 85 | Ashen Leaf — Rootbound Elder Champion | 65% | 37% | 23–56% | 11–14 |
| 85 | Frostfang — Oathbound Alpha Guard | 61% | 37% | 30–63% | 8–14 |
| 85 | Moonshadow — Veiled Hand Grandmaster | 56% | 32% | 13–60% | 11–14 |
| 100 | Stormveil — Kage Raiko Veyr | 0/8 cleared | 21% | 18–29% | 11 |
| 100 | Ashen Leaf — Kage Hoshina Enju | 0/8 cleared | 33% | 25–43% | 10–11 |
| 100 | Frostfang — Kage Kael Whitefang | 0/8 cleared | 18% | 9–27% | 10–11 |
| 100 | Moonshadow — Kage Sable Nocturne | 0/8 cleared | 32% | 25–50% | 14–17 |

Each after row has **8/8 surviving knockouts**. Percentages are rounded. The full range matters: favorable focused builds can finish above 40%. The acceptance target is a median no higher than 40%, with all reference builds able to win and the strongest reference result no higher than 70%. This checks ordinary pressure while allowing build investment to matter. It does not establish equal difficulty for every build.

## Authoritative changes

`api/story/_authoritative-story-combat.ts` owns the numeric values:

- **Level 75/85:** total authored HP ×1.15; equal school defenses at .75 of the chapter defense curve; signature cooldown 2 → 1. The same named signature is available more often. Moonshadow85 signature power changes 68 → 65 to keep its faster cadence survivable.
- **Level 100:** authored HP 14,000 → 9,800; raw stats 2,500 → 1,500, with Frostfang at 1,450. Armor remains .18. All twelve catalog techniques, six damaging moves, AP, powers, costs, cooldowns, rank-capped mastery 50, resource pools and Apex planning remain unchanged. No global AI or damage formula changed.

The existing difficulty band seals the HP/stats: level 75/85 HP uses .92 and the usual capped stat scaling; level 100 uses the peer multiplier of 1. Tests compare the sealed enemy to that exact authored budget. All twelve remain true single-opponent Solo fights. None is rebuilt as a Tower floor or given a borrowed Tower stat multiplier.

All **24 profiles at level 65 or below** exactly match the captured pre-change baseline, including the accepted Stormveil65 and Frostfang35 settings. Names, portraits, opponent IDs, signature identities, rewards and progression retain their existing sources. Legacy village raid guards that reuse Kage catalog identities remain unchanged.

The earlier HP-only monotonicity test now covers generic chapters through 85. The finale is checked through its explicit budget, full kit, Apex policy and measured combat pressure. A larger HP pool alone is not the finale's difficulty rule.

## Reference preparation and policy

Each boss faces all four schools with balanced and focused allocations. Every build uses exactly the earned point budget for its level, respects rank caps, owns its two natures **Earth/Wind**, and fits the free **twelve-slot** capacity. Gear is ordinary rare shop armor and a rare school weapon, all meeting the effective level-30 rarity floor. There is no bloodline multiplier, pet, relic or consumable.

Mastery is **30 at 75/85**, and **40 at 100**, below the legal maximum of 50. The finale kit has eight damaging techniques to cover seven-round cooldowns, three utility techniques and Flicker. Earlier kits use four damaging techniques and more utility. The level-100 ledger is the minimum 29,000 earned points, not a synthetic fully capped 29,880-point character.

The fixed player policy reads visible state, heals below 55%, uses equipped weapons and utility, clears active offensive/defensive effects, and cleanses harmful conditions. It executes real actions and costs; it does not search future enemy responses or change health/resources mid-fight. Clear cannot remove a pending buff, so the policy waits until it is active. The group pilot's chip-finisher is disabled for these large Solo opponents so it continues using ready signatures at low enemy health.

Early probes exposed model problems: nature ownership was not enforced, the first finale kit had insufficient damaging cooldown coverage, and an active-only Clear rule needed to be respected. Those probes were discarded from acceptance. The before/after table uses the same frozen, acquisition-valid preparation and policy on both sides.

The eight builds show available wins for these reference loadouts. They do not guarantee every nature pair, unusual allocation, weather condition, gear set or player strategy. The older Kage acceptance controls already demonstrated wins with stronger S-rank/mastery-50 builds; their existence is compatible with the failed modest-build baseline here.

## Travelling and completion

The real boss-start route prefers the current sector biome when travelling. The field matrix therefore uses real sectors in all five biomes, with the same policy and preparation for every case. All **480/480** ended in an actual knockout before the round cap. The terrain bonus can make particular matchups easier or harder; the field test requires surviving completion rather than the home-village pressure ceiling.

Existing tests cover loss/retry, original finale titles and rewards, Hollow Gate unlock, settlement binding validation, once-only settlement, and independent group completion. The new guards cover exact sealed stats/HP, all earlier profiles, opponent identity and the unchanged Apex/mastery seal. No settlement or storage path was modified.

## Verification and evidence

- Standard matrix: **96/96** surviving knockouts.
- Field matrix: **480/480** surviving knockouts.
- Server TypeScript build: **passed**.
- Focused verification: all combat cases passed. Two test setup failures were corrected: expected stats now include canonical zero-filled unused schools, and appearance checks use the root runner's image-asset hook. The corrected stat-seal and all eight appearance tests passed.
- Thirteen additional budget/policy/settlement guards passed after two adapter tests were updated to compare sealed HP with the current authored budget. The finale-specific test still pins the new 9,800 HP value explicitly.
- Full suite: **passed**. `npm run test:ci` finished with exit 0 in 579.7 seconds: **16,152 passed, 28 skipped, zero failed and zero cancelled** (16,180 total), including the final boss matrix and updated compatibility expectations.

The [numeric evidence](story-late-balance-2026-10-19.json) contains complete legal fixtures, source hashes, raw profiles before/after, individual outcomes, field cases and the final controlled candidate comparisons. No live player save or storage was accessed. This is an engineering balance report; it does not change project KB state.

Reproduce:

```powershell
node --import tsx scripts/story-late-balance-audit.ts .tmp/story-late-after.json
node --import tsx scripts/story-late-balance-audit.ts .tmp/story-late-field.json --field
npm run build:server
npm run test:ci
```
