# Main story, side quest and world event code audit

This pass checks dialogue and objectives against the code that selects encounters, records choices, measures progress and grants rewards. It continues the village audit. No full character playthrough was performed.

## Findings and corrections

| Context | Before | After | Actual behavior |
| --- | --- | --- | --- |
| Stormveil, Kesa's Bout | Mira promises to stop in the fourth exchange while you hold off officials. | Mira reads Kesa's reason before the bell, with you as witness, then faces you in the bout. | The sealed battle is against Mira. It has no fourth-exchange interruption or separate officials to fight. |
| Epic quest objectives | “Win 3 AI battles … other AI victories also count.” Other stages presented the named challenge as optional. | “Win all 3 waves of Captain Goro's challenge using this quest's Fight button …” All nine named AI-boss stages and both defector pursuit variants now require their actual quest fight explicitly. | The server requires fresh wins bound to that quest, stage and acceptance. General AI wins cannot substitute. Pet-duel preparation and ordinary Explore stages retain their actual general counters. |
| Epic progress dialog | Unrelated lifetime AI victories could fill the counter and reveal Claim reward or Continue before the server would accept completion. | The counter uses matching quest-fight receipts, ignoring unrelated wins, stale baselines and duplicate receipt IDs. | This brings the dialog's completion state into line with the server's named-fight requirement. |
| Ten road-story battle choices | The story names Havek, the Magpie, Brask and other opponents, but the launcher falls back to a generic practice opponent near the player's level. | Nine published, named profiles cover all ten choices, including both Anji Vesk branches. | The actual sealed enemy now carries the story's identity. Profiles reuse existing practice kits near each event's minimum level. Older overleveled characters may therefore meet a lower-level opponent than the previous generic fallback. Road duels retain the existing practice rules and do not add currency rewards. |
| The Unsworn's Ledger | “Report her to Bellis and claim the promised informant fee.” Harrow also asks you to split a financial penalty that is never charged to your wallet. | Harrow warns that Bellis may not pay. Reporting her explicitly ends without payment. Helping her means witnessing the crate's contents. | Road choices record traits and story lanes; they neither pay the promised 200 ryo nor charge a shared penalty. The later Harrow callbacks now remember the revised actions. Existing trait IDs remain compatible with saves. |
| Legacy emissaries | Instructions include following nonexistent moth-marked posts and a promise that the Warden will pull you out of a trial. Daigo says only wins count despite trials having varied objectives. | The emissaries direct you to the recorded objectives. The Warden makes no rescue promise; Daigo asks for the trial record. | Trials use category/kind-specific recorded activities. There is no marked-post route or Warden rescue mechanic. Six emissary trial lines were clarified. |
| Caravan events | Fixed claims such as “Lose 12 cargo.” | Cargo-loss hints say “up to” the possible loss; the ridge ambush now names its 3-cargo exposure. | Morale of at least 80 reduces cargo loss by 15%, rounded toward zero. All 23 fixed cargo-loss choices are checked at morale 79 and 80. |
| Donkaku's world-boss trait | Shield size was described as a fraction of its health. | “Raises a new shield at each health phase. Unbroken shields can stack, up to a limit.” | The shield uses the encounter's combat health budget, which can differ from the world event's shared health pool. The new description preserves the actual phase/stacking behavior without implying the wrong pool. |

## Coverage and evidence

- Main story: 36 chapter identities, level gates, rewards and replay safeguards; 32 interludes, derived proof traits, choice-graph integrity and 28 epilogue selections. The targeted dialogue review checked combat instructions, timed sequences and promised player effects rather than treating every fictional prop or offscreen action as an inventory mechanic.
- Road stories: all 15 event gates and trait/lane mappings, all ten battle choices, and the revised fee/penalty callbacks. Road-story choice history remains independent of the optional practice duel's outcome, as before.
- Side quests: all six epic quest chains, nine personal reckonings/recovery quests, seven rifts, ten wandering errands and sixteen emissary errands. Checked exact-fight proof requirements, stage counts, timers, collection routes, return locations, quest items and reward/catalog parity. Existing field-journey tests cover all four durable recovery graphs and their branch-specific aftermath.
- World events: both village crises' triggering announcements and verified contribution/resolution rules; the three world bosses' regeneration, guard protection, phase shields, event transitions and reward notices; all 48 caravan encounters/136 choices against the shared cost/effect resolver, with explicit regression checks for variable cargo losses.
- No changes were made to quest reward amounts, objective counts, choice trait IDs, crisis targets or world-boss combat balance.

New cross-boundary checks live in `scripts/story-quest-runtime-copy.test.ts`. The epic counter regression is in `shinobij.client/src/lib/questbook.test.ts`; cargo preview checks extend `shared/sunscar/caravan-improvements.test.ts`. The focused dialog browser test uses isolated saved-state fixtures and does not replay the tutorial or missions.

## Validation

- Main focused story/quest/content/encounter checks: 76 passed. Final source/content/catalog checks: 75 passed.
- Follow-up regressions, including all three findings from the repository-wide run: 69 passed.
- Repository-wide run: 16,003 passed, 28 skipped, 3 failed, 0 cancelled (16,034 total). The failures identified the old approved Bellis wording, the AI catalog's old 71-profile sprite-policy count, and the dialog's line budget. The reviewed wording fixture and explicit policies for all nine road profiles were updated; the component stayed within its existing budget. All three checks passed on the subsequent focused run. The full suite was not repeated after those corrections.
- Browser checks: all four quest-proof dialog cases passed on Chromium desktop and mobile; screenshots were inspected. The strict Solo-PvE combat-layout viewport matrix passed on Chromium.
- Server and final client builds: passed. Final client lint: passed, with 0 errors and 23 existing warnings.
- Generated story content and AI catalog parity: passed. `git diff --check`: passed.

## Follow-up: opponent identities and full-suite rerun

`scripts/story-opponent-identity.test.ts` now constructs real Solo-PvE or Tower sessions for all 36 village chapters, nine epic AI-boss stages (including every Goro wave and Kazan's Risen variant), five personal story hunts, seven rift finales, all three public world bosses, all four Fourfold Breach defenses, and all four three-enemy village Reckoning defenses. The existing road test constructs the actual enemy for all ten battle choices. These checks compare authored names with the enemy actors created by the server, beyond catalog-to-catalog comparisons.

Two additional discrepancies were corrected:

- Tomoe's final pet objective said “You can challenge Raijū the Storm-Hound here.” The quest giver does not launch that encounter, and the server counts any new pet win. It now says “Win 1 more pet battle against any opponent to finish Tomoe's gauntlet. You can find a match in the Pet Colosseum.” The unused boss reference was removed from both stage catalogs. The stable stage key, required win count and existing saves are preserved.
- A weekly boss could acquire a different combat name if an administrator renamed its source AI profile after the spawn announcement. The encounter now preserves the spawn's announced name. Regression checks construct combat sessions for all five weekly bosses with the original profile, a renamed profile and an unavailable profile; unnamed legacy spawns still use their catalog name. Combat stats, kits, scoring and rewards are unchanged.

Final validation after both corrections:

- Full unsharded `npm run test:ci`: **16,014 passed, 0 failed, 0 cancelled, 28 skipped; 16,042 total**, in 552 seconds. This supersedes the earlier three-failure run above. The Postgres cases need a throwaway database; the owner-only file-mode case is skipped on Windows. The opt-in live Tebex contract suite also remains disabled.
- Targeted opponent/quest/combat checks: **37 passed**.
- Server and client production builds: passed.
- Client lint: passed, with 0 errors and 23 existing warnings.
- Generated story assets: current. `git diff --check`: passed.

These are local source checks; they do not inspect separately published live administrator content or replay a complete character journey. The earlier focused browser results above were not rerun in this follow-up; no screen or component was changed.
