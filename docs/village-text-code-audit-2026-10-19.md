# Village text and behavior audit

Code review of Ashen Leaf, Frostfang and Moonshadow, with Stormveil included in shared regression checks. No new browser playthrough was performed.

## Corrections

| Context | Before | After | Code evidence |
| --- | --- | --- | --- |
| Ashen Leaf, first Guardian trial | The Guardian circles in repeating spirals, letting you predict where roots emerge. | You watch it rise and prepare for its first attack. | The sealed first-chapter opponent uses a guard, Siphon and the ordinary movement planner; there is no spiral or root-emergence sequence. |
| Frostfang, first trial | “Stay where they can reach you, and call if you need help.” Recruits supposedly cover you from formation. | “The other recruits will stay behind the rail and watch.” The choices now concern protecting the spectators or advancing into the square. | `boss-start.ts` uses `buildSoloPveAiEncounter`; it adds no recruit squad. The player's carried companion is a separate system. |
| Frostfang, chapter 3 | The Guardian follows “four beats and a pause,” which you can use to retreat. | You watch the Guardian while Yura gets the rescued soldiers clear. | This boss has a signature technique and the standard planner; there is no four-beat attack cycle. |
| Moonshadow, first trial | A choice says you take a cut, hit the veteran and start with an injured arm. | You raise your guard and prepare to counter the first attack. | Choice prose does not apply combat damage. The server seeds player HP from the saved character. |
| Moonshadow, first trial | Nobody will offer help until you earn your place, immediately after Nyx helps you find the test. | Nyx watches from the wall while the veteran readies their weapon. | The preceding scene already establishes Nyx's help. The fight does not add Nyx as a combat ally. |
| Moonshadow, Mirror trial | It knows the registry's record of your moves; the choice encourages exploiting habits the registry never saw. | “The fighter has its own techniques. It doesn't copy your jutsu.” The choice now asks you to study its stance. | Chapter 5 receives a fixed Genjutsu signature. Its kit is not copied from the player's loadout. |
| Shared opponent/Chronicle roster | “Mira Volt, False Betrayer” | “Mira Volt, Estate Bout Rigger” | The published Stormveil chapter and compact client catalog already use the revised identity. The sealed server name reads the shared roster, which was stale. |

All existing choice trait IDs and destinations remain intact. Authored story payloads were regenerated.

## Checks

- Traced all four villages' Academy aftermath, recovery/Logbook handoff, field trace, return ceremony and awakening/departure conditions. The earlier handoff and redundant-summons fixes are shared rather than Stormveil-specific.
- Checked all 36 published chapters against the server's opponent identity and level gates, including each battle choice's name and opponent ID.
- Exercised authoritative settlement for all 36 chapters and compared reward presentation with the receipt: ryo, stat points, Aura Dust, Chronicle card identity after unlocking the Scribe, progress, final titles and Hollow Gate Key. Existing settlement tests also verify that pre-Scribe clears do not expose cards early. Reusing the same chapter proof cannot pay again. Retired XP is omitted from the displayed reward summary.
- Reviewed the other three villages' combat-related dialogue and choices against the fixed early kits and shared combat builder. Story events such as records, rescue marks and the Rootfire remain narrative consequences; they are not presented as new player combat abilities.
- Checked the early mission and First Contract selection paths: these use shared mission/assignment rules rather than separate home-village combat implementations.
- Village transfer retains the original story village but is gated until level 100 and all nine chapters are complete, so it cannot swap an unfinished arc's opponent.

The cross-boundary regression coverage is in `shinobij.client/src/data/village-story-runtime.test.ts`. This verifies code paths and data contracts; it does not establish that every scene renders or reads well during a live playthrough.

## Validation

- Focused story, tutorial, content integrity and reward tests: 64 passed.
- Final prose/content regression check after the last wording adjustment: 32 passed.
- Client TypeScript build check: passed.
- Client lint: passed, with 0 errors and 23 existing warnings.
- Generated story-content check and `git diff --check`: passed.
- Repository-wide tests: 15,997 passed, 28 skipped, 1 failed, 0 cancelled (16,026 total). The failure was `production readiness rejects stale backup`: its local HTTP request timed out before the probe could report the expected backup-freshness rejection. No village/story tests failed.
- Isolated rerun of the entire deployment-readiness test file: all 16 passed, including the stale-backup case. This confirms the failure did not reproduce in isolation; the full run itself remains recorded as failed. No deployment code was changed.
