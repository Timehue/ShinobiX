# Level-65 village story boss balance — 2026-10-19

**Historical pass:** the [two-nature follow-up](../../story-65-two-nature-balance-2026-10-19.md) supersedes this report's level-65 acceptance evidence and makes a small further damage reduction. The recorded results below describe the earlier four-nature fixture and settings.

The other level-65 bosses needed different changes. Ashen Leaf and Frostfang were too forgiving; Moonshadow's burst and uneven school defenses made three ordinary builds lose. All eight tested builds now clear each boss with less than 40% HP remaining. Stormveil's production tuning is unchanged.

| Village / boss | Before | After | Clear rounds after |
| --- | --- | --- | --- |
| Stormveil — Tempest Execution Squad (9 enemies) | 8/8 clears; 18–31% HP | Unchanged: 8/8; 18–31% HP | 13 |
| Ashen Leaf — Rootbound Retrieval Squad (3 enemies) | 8/8 clears; 52–75% HP | 8/8; 18–35% HP | 10–14 |
| Frostfang — Oathbound Purge Unit (3 enemies) | 8/8 clears; 56–70% HP | 8/8; 10–37% HP | 9–12 |
| Moonshadow — Veiled Hand Executioner (1 enemy) | 5/8 clears; three defeats | 8/8; 9–39% HP | 8–12 |

Percentages are rounded final player HP from deterministic production-engine simulations, not human win rates. See the [complete evidence](story-65-balance-2026-10-19.json) for exact results, loadouts, candidate parameters and stress cases.

## Production changes

- **Ashen Leaf:** formation damage scale 1 → 1.7; authored total HP increased 20% before the existing group split. The actual sealed total changes from 5,592 to 6,711 HP with rounding. This produces sustained pressure instead of relying on a much larger burst.
- **Frostfang:** level-65 formation damage scale 1 → 2.25. Its HP, roster and individual abilities stay the same. The accepted level-35 recovery squad stays at .5.
- **Moonshadow:** signature power 57 → 40; all four school defenses become 836. Previously Bukijutsu defense was 1,673 and the other school defenses were zero, making weapon builds take more enemy turns. It remains a true single-opponent Solo fight with its Wind/Bukijutsu identity, portrait, signature, costs and cooldown.

The group damage scales use the existing resolver multiplier already consumed by combat damage and its client preview. No global damage formula, Tower floor scaling, reward, story settlement, enemy identity or progression rules changed. Live story launches use the authoritative session and its actual enemy HP.

## Method and practical limits

**Follow-up qualification:** the [level-75/85/100 audit](../../story-late-balance-2026-10-19.md) added nature-ownership validation. The older fixture used techniques from four natures, so its point budgets and engine results remain synthetic evidence, not proof for a normally acquired two-nature character. The later audit uses strictly acquired two-nature fixtures. This qualification does not change the level-65 production settings or the recorded outcomes below.

Each standard set contains all four schools, each with balanced and focused legal stat allocations at exactly level 65. Loadouts use ordinary level-five shop armor (1,245 ryo), mastery capped at 10, real catalog techniques, and no pet, bloodline, relic, consumable or resource reset. The player policy uses visible HP, range and effects: attacks, movement, healing, Clear and Cleanse. It does not simulate future enemy turns to choose an outcome or optimize every utility technique.

The standard harness starts inside the village (sector 0), using the real story profile, `STANDARD_PVE_AI_POLICY`, and the `STORY_VILLAGE_BIOMES` fallback used by boss-start. It uses the embedded multi-actor resolver for the three real group fights and Solo's own actions for Moonshadow. The standard acceptance checks require a positive-HP win, every required enemy defeated, final HP no higher than 40%, and completion before the 25-round cap.

488 candidate simulations compared damage scales, HP budgets, signature power and defense distributions. The final 32 standard simulations all cleared. These examples show that ordinary level-65 builds can win with reasonable play; they do not guarantee every build or strategy succeeds.

An additional 96 stress cases deliberately removed half the damaging kit, wasted the opening turn, or disabled the pilot's heal/Clear/Cleanse decisions. Those cases are diagnostic and are not all expected to win:

| Village | Two damaging techniques | Missed opening | No counter decisions |
| --- | --- | --- | --- |
| Stormveil | 8/8 | 8/8 | 8/8 |
| Ashen Leaf | 8/8 | 5/8 | 6/8 |
| Frostfang | 4/8 | 7/8 | 8/8 |
| Moonshadow | 6/8 | 8/8 | 8/8 |

These are boss fights where poor preparation or wasted turns can cause a defeat. The weaker-kit results are a practical limit on the beatability claim. The deterministic pilot can also do better when it skips a suboptimal counter decision; these are example strategies, not an optimal-play solver.

### Starting a story fight while travelling

Boss-start prefers the current sector's biome when the player is outside the village. Terrain gives particular schools a 10% technique damage bonus. A further check covers **all 160 combinations** of four bosses, five actual field biomes, four schools and two allocations, using each biome's real sector in the save.

The standard policy lost three of those cases: Frostfang against balanced Genjutsu in volcano, and Moonshadow against balanced Bukijutsu/Genjutsu in snow. Lowering boss damage did not consistently solve these cases because healing timing also changes. A fixed counterplay policy—heal below 55% HP and use the loadout's ready zero-damage utility technique—cleared **160/160** without any additional production changes. For Moonshadow, Stone Kunai Rain weakens the enemy's offense and improves healing; Stone Eye Mirage grants damage reduction and stronger attacks. These were already equipped; the standard pilot had not used them because they target the opponent despite including effects on the caster.

Across all terrain variants, final HP ranged 20–39% for Stormveil, 16–38% for Ashen Leaf, 5–46% for Frostfang and 3–50% for Moonshadow. The wider range reflects favorable and unfavorable terrain matchups. The village pressure benchmark remains separate; the field regression requires a surviving clear and full enemy defeat before the time cap. These fights can still punish missed defensive windows.

## Verification

- **103 focused checks passed**, including the 160-case field regression, all prior narrative group balance scenarios, group HP authority, full-roster completion proof and story handler settlement.
- **Server TypeScript build passed.**
- **Full suite passed:** `npm run test:ci` completed with exit 0 in 694.6 seconds: **16,136 passed, 28 skipped, zero failed and zero cancelled** (16,164 total). This run includes the final field regression. The timing-sensitive CPU probe that failed in the earlier historical run passed here.
- All **33 other captured story templates** exactly match the pre-change baseline, including level 35, Stormveil65 and all level-100 finales.
- New guards verify correct 9/3/3/1 enemy counts, per-level stat caps, unchanged authoritative player stats, and exact total authored HP after group distribution. They also verify Moonshadow stays on its real Solo engine and identity.

The original runs are archived in this report's numeric evidence. `scripts/story-65-balance-audit.ts` now runs the superseding two-nature follow-up; its `--baseline` option replays the settings immediately before that follow-up. Root `npm run test:ci` discovers the balance regression tests automatically.

### Correction to earlier comparison context

The earlier group-only audit approximated village biomes. This audit uses the actual story-gate biomes for both before and after: Stormveil **central**, Ashen Leaf **forest**, Frostfang **snow**, Moonshadow **shadow**. Stormveil therefore measures 18–31% HP here instead of the earlier forest-fixture result. Its production profile and formation damage scale were not changed in this pass. This report supersedes the earlier report's Ashen Leaf65 and Frostfang65 balance figures.
