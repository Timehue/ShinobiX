# Fresh-character text playtest — October 18–19, 2026

## Coverage and method

Played `ClarityTrail` through normal browser controls against a local Express server with isolated in-memory storage. No existing player save, progression grants, seeded victory, or production account was used. Read the opening and selected story branches instead of skipping them. Combat actions were submitted by clicking the rendered controls and legal target tiles; server replies were observed to check the results.

Character: Stormveil Village, Ashen Eyes, truth-seeking vow, Ripple Seal. Desktop: 1366×900. The Academy field assignment was also played at 390×844.

Completed and checked against the saved record:

- Character creation, opening dialogue, vow, companion choice and village arrival.
- Stat-training start, free Flicker unlock, four-jutsu loadout, starter weapon and armor.
- Academy spar victory, both aftermath scenes, Noodle Den recovery and Academy Trial claim.
- Logbook, real travel to Sector 1, foxfire investigation, return ceremony and Field Seal.
- Free first-element awakening: Earth. Aura Sphere scene and inventory claim.
- Stormveil Chapter 1, “First Thunder”: the searching-reason branch, circling approach, and a winning fight.
- First Contract: Combat, Discovery and Companion, all completed and acknowledged.
- E-Rank Drill and D-Rank Errand: won both fights, returned to Mission Hall and claimed both rewards.
- One incidental Road Bruiser encounter, its displayed fleeing cost and the resulting loss.
- Original 15-minute training collected after its real timer finished.
- Reload after the client rebuild retained the character and completed progress.

## Observed mechanics

| Instruction or notification | Actual result |
| --- | --- |
| Move costs 30 AP | AP fell from 100 to 70; position changed. |
| Level-2 Flicker costs 20 AP and 13 stamina | AP fell from 70 to 50, stamina from 1090 to 1077, position changed, HP stayed at 600. Selecting its card spent nothing. |
| Spar reward: 20 stat points and 30 ryo | Growth points rose from 193 to 213; ryo from 2100 to 2130. |
| Feast: 100 ryo, restores vitals to maximum | Ryo fell by 100 and HP reached its maximum. |
| Academy Trial does not consume a daily mission slot | Lifetime missions became 1; daily missions remained 0. The server granted 770 stat points and 30 ryo, with its capped stamina reward. |
| Dummy repeats the chosen vow | Both aftermath beats used “I need to understand what the Gate saw.” The next Mission Hall instruction acknowledged the voice and proposed investigating it. |
| Field Seal has no combat bonuses | Ceremony and Profile both described a permanent keepsake and retained the chosen vow. |
| First story chapter reward | Victory listed 3 stat points, 75 ryo and 12 Aura Dust; Profile showed 12 Aura Dust and one completed chapter. |
| E-Rank Drill: claim 10 ryo after winning | The victory left a pending claim; the claim response awarded 10 ryo and zero stat points. |
| Discovery: explore outside the village | Travel alone did not complete it. One Explore action in Sector 1 completed it and produced a roadside encounter. |
| Road Bruiser fleeing cost | The final offer showed 384 HP and 250 ryo. Fleeing left 385 HP from 769 and reduced ryo from 8265 to 8015. This was a wandering shinobi, not the road-bandit toll encounter. |
| Pet interaction: +10% happiness | Ripple Seal went from 60% to 70%; Companion care completed without spending a treat. |
| Training preview: +18 Strength | Collection changed Strength from 10 to 28 and total trained points from 0 to 18. |
| D-Rank Errand: claim 20 ryo after winning | The card changed to the reopened-culvert aftermath. Claim awarded 20 ryo, zero stat points, and raised daily missions to 2 and lifetime missions to 3. |

## Issues fixed

1. **False Logbook error after a successful claim.** Opening Logbook immediately after the Academy Trial could return “Claim the Academy Trial” while the server still held the client-owned `cafeteria` step. The narrative endpoint now accepts that boundary only when its own record confirms the reward, acknowledged incident and full HP. Regression coverage rejects unearned, unrecovered and earlier-step cases.
2. **Awakening directions offered an unrelated battle.** An empty currency-reward object made the zero-reward summons look like a reward-bearing encounter. It displayed “Begin battle,” then invented a challenger and offered “Enter battle.” Empty/zero currency rewards now count as no currency reward, so the scene ends as a conversation. Desktop and phone browser tests exercise both completion buttons and confirm no battle offer.
3. **Obsolete first-element summons.** Leaving the village could offer the first-awakening instructions after Earth had already been awakened. The departure trigger now checks that the character has no awakened element, while preserving unrelated departure stories.
4. **Inconsistent story enemy name.** The first bout used “Stormveil Story Boss” in combat but “Stormveil Training Scout” in dialogue and victory. Default combat names now come from the existing shared story roster. Combat stats and rewards are unchanged.

## Text revisions

| Before | After |
| --- | --- |
| “A weapon bloodline with poison, protection, and absorb pressure wrapped in moonlit blades and wire.” | “A weapon bloodline that poisons enemies, reduces incoming damage, and turns some damage taken into healing.” |
| “Hits hardest, but fragile. Win the exchange before it can hit you back.” | “Heavy fire attacks, but low HP and defense.” |
| “Durable and self-healing. Out-lasts opponents in a long fight.” | “Durable and self-healing. Built to last through long fights.” |
| “The elder places the Aura Sphere in your hands.” | “The issue seal releases the Aura Sphere.” The scene already establishes a recorded message in the field kit. |
| “Begin battle” / “Enter battle” in the Awakening summons | “Continue,” with no invented encounter. |
| “Stormveil Story Boss” | “Stormveil Training Scout,” from the authored roster. |

The bloodline and companion descriptions were checked against the defined effects and starter stats; those alternatives were not separately played through.

## Additional readability fix

The desktop Profile Stats layout let stat cards overflow their groups and cover neighboring text and Add buttons at 1366×900. The grid now chooses a column count that fits each group. Browser regressions at 1366px and 390px confirmed the cards stay inside their groups and the Willpower Add button accepts a normal pointer click. Before: `.tmp/fresh-playthrough/stat-card-overlap.png`. After: screenshots in `shinobij.client/test-results/fresh-text-final-ui/`.

This run covers one village, starter, vow and chosen story branch. It does not establish that every branch, encounter, defeat state or later chapter has been played.

## Validation

- Focused starter/intro checks: 30 passed.
- Academy narrative regressions: 10 passed.
- Story combat name/authority checks: 8 passed.
- Departure narrative and story staging: 13 passed.
- Built-Express fresh Academy journey: 1 passed.
- Story-reader browser checks: 5 passed.
- New Awakening conversation regression: desktop and phone passed (2 tests).
- Final UI checks: Awakening completion and desktop/phone stat-card bounds and pointer activation passed (3 tests).
- Strict Solo-PvE layout matrix: all 6 configured browser/DPR projects passed; an additional Chromium rerun also passed.
- Client lint: 0 errors, 23 existing warnings. Client and server builds passed.
- Full repository test run: **16,018 tests; 15,990 passed, 28 skipped, 0 failed or cancelled**. The initial sandboxed attempt stalled on a local HTTP probe; the complete rerun with local-network permission passed.

Detailed local evidence: `.tmp/fresh-playthrough/transcript.json`, `outcome.json`, numbered screenshots and validation logs. The outcome records onboarding `done`, all Academy milestones, one story chapter, Earth, all three First Contract routes, two daily/three lifetime missions, happiness 70, collected training and no pending combat claims.
