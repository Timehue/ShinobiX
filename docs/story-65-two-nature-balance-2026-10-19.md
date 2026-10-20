# Level-65 two-nature follow-up — 2026-10-19

Later follow-up: the [level85/100 progression pass](story-escalation-balance-2026-10-19.md) changes those later bosses while preserving every level65 setting recorded here.

All four village bosses remain beatable at level 65 with ordinary two-nature builds. The requested adjustment is small: roughly 5% less outgoing damage, without forcing every build to finish at a particular HP percentage.

| Village | Change | Clears | Median ending HP, before → after | Ending HP after | Rounds |
| --- | --- | --- | --- | --- | --- |
| Stormveil | Formation damage 1 → .95 | 8/8 | 55% → 56% | 54–65% | 6–7 |
| Ashen Leaf | Formation damage 1.7 → 1.6 | 8/8 | 31% → 35% | 26–53% | 8–13 |
| Frostfang | Formation damage 2.25 → 2.15 | 8/8 | 31% → 33% | 24–44% | 8–11 |
| Moonshadow | Signature power 40 → 38 | 8/8 | 39% → 41% | 24–48% | 9–11 |

Before and after use the same fixed builds and player decisions. These are deterministic engine outcomes, not human win rates. Healing timing means individual ending HP need not increase in every run when damage decreases. Stormveil's nine-enemy formation is particularly vulnerable to the legal area attacks; its favorable results were retained rather than counteracted with another difficulty increase.

The reference builds cover all four schools with balanced and focused earned-point allocations. They own Earth/Wind, equip four damaging techniques including area attacks, one school utility and Flicker, and use uncommon shop armor with mastery 10. Six techniques fit within the free twelve-slot limit. No weapon, pet, bloodline, relic, consumable, extra points or mid-fight resource reset is used. The pilot reads visible state, heals below 55%, and uses ordinary counter actions and ready utility. It does not search future enemy responses.

This replaces the older level-65 acquisition evidence, whose fixture used four natures. Differences from that older report include nature selection, area attacks and the player policy; its HP figures are not a controlled comparison with this pass. The before/after table above is controlled.

Only the three level-65 formation damage factors in `shared/narrative-groups.ts` and Moonshadow65's signature power in `api/story/_authoritative-story-combat.ts` change in production. HP, stats, turns, rosters, portraits, kit identities, rewards and settlement stay intact. Fresh baseline guards preserve every other story profile, including the accepted level-75/85/100 bosses, and every other group, including Frostfang35.

Verification:

- All **32/32** reference fights ended with surviving wins and every enemy defeated before the combat limit.
- **105 focused tests passed**, including the existing field, exact HP-budget and completion/settlement regressions. No new terrain or stress matrix was added for this request.
- Server TypeScript build passed.
- **Full suite passed:** `npm run test:ci` finished with exit 0: **16,154 passed, 28 skipped, zero failed and zero cancelled** (16,182 total), in 988.3 seconds. This includes the existing later-boss regressions.
- The initial restricted full-suite run was stopped after four repeatable WebSocket transport failures. All four passed with localhost access, as did the completed full rerun. No realtime test or product code was changed.

The [complete evidence](story-65-two-nature-balance-2026-10-19.json) records the exact fixtures, frozen profiles, source hashes and individual before/after runs. Reproduce with `node --import tsx scripts/story-65-balance-audit.ts .tmp/story65-two-nature-after.json`; append `--baseline` for the frozen pre-adjustment settings.
