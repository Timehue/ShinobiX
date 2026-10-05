# Gameplay guidance follow-up — 2026-09-29

Approved scope: implement reward/cap clarity, the post-Academy handoff, and early explanations of advancement and profession commitments. Training cadence and ranked format remain unchanged. Repository artifacts omit external product identities and links.

## Changes

- Mission Hall, Battle Arena, and the Arena District's Ranked tab have a compact expandable reward guide. It distinguishes stat-derived levels, ryo-only combat mission claims, mastery, training, daily claims, and the shared combat-growth budget. The existing 3/6-point win awards and 18-point daily limit now come from one shared constants module used by server settlement and the guide.
- Combat mission receipts explicitly explain a zero stat-point award using the actual server receipt. The guide does not invent a remaining-budget counter from client state.
- First Contract completion recommends an incomplete requirement from the existing Logbook, showing actual saved progress and an action. When training is running, it prefers another useful activity. Completed requirements lead to the Logbook for the existing claim. Mission destinations use the existing preparation and Combat-tab navigation flow.
- Legacy Academy handoff copy no longer promises stat points from an E-Rank mission claim.
- The Logbook previews the level-20 hold from level 10 and the level-39 hold from level 30. Previews retain their actual unlock levels, cannot be passed early, and do not replace an active objective. The Chunin preview explains joining or founding a clan.
- A wiring review aligned the Logbook's mission total with the server's larger-of-personal-or-clan rule, so a stored personal zero no longer hides clan progress. Chunin mission and exploration requirements now link to their activity screens.
- The same review aligned the server exam gate with the Logbook's element count: blank entries and case variations of one element cannot satisfy a distinct-element requirement.
- The return-day First Contract journal now sends its main action to the saved next goal; a mission goal selects the Combat tab through the existing handoff.
- Profession selection and its confirmation disclose the base 200-Fate-Shard approval cost, consumption, and reset of profession rank, XP, and mastery. The older progression-spine document now describes switching accurately.

No save migration, new reward grant, schema change, balance adjustment, commit, or publication is part of this follow-up.

## Validation

- Original focused unit checks: 45 passed. The wiring review's focused exam and objective checks passed (38 tests).
- Lint on all changed frontend files, including the Arena District addition: passed.
- Full server/client build, distribution verification, and size check: passed. The final client production build also passed after the Arena District addition when run without concurrent full-suite load.
- Full unit run: 12,708 passed, 4 failed in unrelated working-tree areas: tournament hospitalization guard, a new pet-summon CSS import in BattlefieldActor tests, Tower PvP forfeit source-contract assertion, and the touch-hover budget. No files responsible for those failures were edited by this follow-up.
- Full lint on the final working tree: one error outside this change (`App.tsx` has an unused `DEEP_LINKABLE_SCREENS` declaration), plus 13 warnings. An earlier full lint run found three errors before concurrent pet-summon changes were updated.
- Focused browser checks: all 8 new scenarios passed across desktop and 360-pixel Chromium. The original focused run also passed 18 existing handoff checks; its remaining existing failures occur while restoring Battle Arena from a deep link, after the return-journal assertions succeed. An initially invalid profession fixture (outside the village) was corrected and passed on rerun.
- Changed-flow cross-browser check: all 28 scenarios passed across all seven configured Chromium, Firefox, and WebKit desktop/mobile/tablet profiles.
- Full responsive gate: attempted, then stopped after repeated unrelated navigation failures (tests expecting Village/Central instead render World Map). This is not a full responsive pass; the changed flows passed separately as described above.
- Full strict combat-layout gate (`COMBAT_LAYOUT_CAPTURE_PHASE=after`, `COMBAT_LAYOUT_STRICT=1`): 20 passed, 10 skipped, no failures (17.6 minutes).
- Follow-up browser checks for the wiring review: 42 passed across all seven configured Chromium, Firefox, and WebKit desktop/mobile/tablet profiles. These include clan-mission exam progress, return-day goal navigation, reward explanations, preview lockouts, and profession switching disclosure.
- Follow-up full unit rerun after the server exam validator change did not reach a final summary: it stopped making output progress after the pet catalog checks and was interrupted to free resources for an isolated build. It surfaced the unrelated fight-entry guard failure before interruption. The focused exam, objective, and handoff unit checks passed after the change; the earlier full run's 12,708 passes and four unrelated failures are the last complete suite result.

Local logs are under the ignored `output/gameplay-guidance-*.log` paths. This shared checkout contains other ongoing work; these results describe the tested working tree, not a clean release candidate.

## Main-based release candidate

The approved files were replayed onto a clean checkout of `origin/main` at `e3254b9ab`, without the shared checkout's unrelated changes, then fast-forwarded through `7bf23ceb7` to `469ee3d67` as main advanced. The initial clean candidate passed the full server/client build, distribution verification, and size check; full frontend lint (zero errors, 13 warnings); all 50 focused gameplay tests; all 12,730 repository unit tests; and 42 changed-flow browser checks across the seven configured profiles. After the main updates, the server build and the directly affected Warfront tests also passed.

The production image of the earlier main commit exceeded the total shipped JS/CSS ceiling by 2,202 bytes (9,002,202 versus 9,000,000), leaving its Railway deployment inactive. Main then compacted Warfront diagnostics. With the public production-length build variables used by the image workflow, the rebased gameplay candidate measured 9,002,643 bytes. The total-product ceiling was raised to 9,050,000 bytes, leaving 47,357 bytes of measured headroom. Startup, per-chunk, CSS, and gzip limits were left unchanged; the production-settings size check passed after the adjustment.

The full responsive/accessibility suite was attempted on the rebased browser bundle and stopped after repeated failures outside this change: World Map bookmark/direct-Central navigation and tracked story visual-evidence writes. All six progression-guidance cases reached in that run passed. The two navigation failures reproduced with one Chromium worker on both the candidate and an untouched `469ee3d67` main checkout, so they predate this patch. The separate 42-case changed-flow check passed. The strict combat-layout gate is recorded separately once complete.
