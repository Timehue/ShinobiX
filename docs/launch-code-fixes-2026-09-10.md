# Launch audit fixes — 10 September 2026

Historical record from the original local checkout, before these fixes were integrated onto current main. The measurements below describe that checkout and its test runs.

Follow-up to the seven findings in [the launch audit](launch-code-audit-2026-09-10.md). Changes are in the local working tree alongside the pre-existing work. No deployment or production data repair was performed.

A subsequent [integration recheck](launch-integration-recheck-2026-09-10.md) reproduced and corrected additional alias, character/progress adoption, and concurrent storage issues around these fixes.

| Finding | Implemented correction | Regression evidence |
| --- | --- | --- |
| 1. Equipped consumable sale creates ryo | Both inventory and shop sale paths reject sales from consumable selection slots. Backpack sales consume the owned unit. Ordinary gear aliases are removed together when sold. | Sale tests and equipment-conservation tests exercise repeated attempts, both sale paths, and strict ledger enabled/disabled. |
| 2. Live duel ends before play | Live completion replay stops at the shared authoritative tick and requires an actual terminal state. A pending completion hint is rechecked on progress or peer dropout. | Socket-callback tests reject immediate completion and unilateral progress, accept the actual terminal tick once, and cover dropout/reconnect event ordering. |
| 3. Slower ranked peer loses the match | Token mint retains a separate per-player replay pointer for 24 hours. Completed settlement receipts retain sealed replay inputs for 24 hours. Queue recovery consults live authority, durable settlement intent, and the completed receipt; exact-token acknowledgment dismisses the viewed match. Replay and settlement failures have retry controls. | Actual handler tests cover faster-peer settlement, slower-peer discovery/watch, repeated settlement without repayment, reservation-cleanup failures, acknowledgment, and entering another queue. A delayed settlement also remains discoverable after unrelated matchmaking prunes the expired reservation. Browser retry verification is recorded below. |
| 4. Ranked replay reverses personal result | Replay states, event sides, and outcomes are oriented to the viewer. Canonical simulation and named winner are preserved. | Both participants' handler responses are checked for their own player team, opposite personal outcomes, consistent event sides, and the same winner. |
| 5. Unequip deletes gear | Backpack and ordinary equipped items share an ownership count budget. Returning gear is allowed; equipped consumable selections do not create additional ownership. | Tests cover repeated unequip, swaps, legacy aliases, multiple owned copies, a full backpack, and strict ledger unset/0/1. |
| 6. Standing Court concession retains its round | Forfeit uses the same loss settlement as normal terminal turns. | Actual handlers reset round 3 to 0; retrying an old forfeit cannot reset a later run. |
| 7. Old Standing Court wins pay again | Previously credited proof IDs are archived before removal from the recent history. Progress, standing, and the newly credited proof are written together using compare-and-set under the progress lock. | Actual handler tests replay old sessions after ten wins without further payment and inject concurrent claims, archive failures, lost write acknowledgments, and a stale compare-and-set. |

The Standing Court regression fixtures seed terminal combat outcomes to exercise settlement; they do not claim to play ten fights through the UI. The fix preserves retained and future settlement identities. It does not reconstruct proof IDs already discarded before these changes.

The ranked browser regressions use injected API failures and a shortened terminal replay to exercise retry, verdict, and exit behavior in the real component. The handler regressions check the full canonical event stream and both viewing perspectives separately.

## Verification

- Live duel completion/session/reconnect/roster/replay tests: **41 passed, 0 failed**, including five socket completion regressions.
- Sale and equipment-conservation targeted tests: **56 passed, 0 failed**. All save tests: **385 passed, 0 failed**; existing golden-master snapshots were unchanged.
- Standing Court and existing First Pact tests: **45 passed, 0 failed**, including seven new settlement regressions. An independent injected concurrent-progress update also survived a rejected settlement and was preserved on retry, with payment exactly once.
- Scoped frontend lint, including the new ranked browser spec: **0 errors, 0 warnings**.
- Final ranked handler, transport, queue, and settlement tests: **33 passed, 0 failed** across seven files. A separate handler reproduction confirmed delayed recovery after an unrelated match pruned the reservation, and no replay resurrection after acknowledgment.
- Full frontend `npm run lint`: **0 errors, 11 warnings**, matching the audit baseline warnings. The final rerun after the chat-baseline test correction returned the same result.
- Full production `npm run build`: **passed**, including server/client compilation, content checks, bundling, legal-page prerendering, distribution verification, and configured size limits. The existing product JS/CSS size warning remains.
- Full regression run against the final source: **10,092 passed, 0 failed/cancelled/skipped** across 1,304 suites (856.89 seconds). An earlier full run also passed; it was repeated because the final ranked discovery adjustments were completed during that run.
- Server compilation against the final source: **passed**.

The full ordinary browser suite completed with **395 passed, 275 skipped, 14 failed** in 58.3 minutes. Ten failures were in Firefox desktop and four in mobile WebKit. Their traces record navigation, overall test deadlines, or context-cleanup failures; several assertions completed after the deadline, while others were interrupted.

All 14 failed cases were rerun separately against the same build with one worker and unchanged test deadlines/assertions: **13 passed, 1 skipped, 0 failed**. Firefox returned nine passes and one configured skip in 2.4 minutes; all four WebKit cases passed. One WebKit retry first failed because the temporary rerun configuration used a different port from the snapshot directory that its CSS fixture reads. Matching the port to the existing verified snapshot corrected that setup error; the case then passed in 35.4 seconds. The original full-run failures remain recorded above rather than being described as a clean full run.

Both new ranked recovery cases passed in all seven browser projects: Chromium desktop, compact, mobile, and tablet; Firefox desktop; WebKit desktop and mobile.

The ordinary suite's first attempt hit its 300-second preview-preparation timeout before executing any tests. The completed run used the same suite and assertions with a 900-second startup allowance; the 5,554-file immutable preview passed its content verification. Isolated reruns reused that exact verified preview.

The initial strict combat matrix exceeded its 600-second Tower test deadline at 150% display scaling. Its trace records no failed geometry assertion: the preceding cancellation checks passed, and the mouse-move operation pending at the overall deadline completed about 381 milliseconds after it started. The remaining run was stopped, and a complete rerun was started after the ordinary suite and its retries finished. That rerun passed the 150% Tower case.

The complete strict matrix rerun finished with **12 passed, 10 skipped, 8 failed** in approximately 1.5 hours. Five failures involved measurement/test deadlines or cleanup; three were actual hit-test assertion failures. Artifact writing continued for several minutes after some tests finished cleanup. Process inspection also found three layout jobs running in other worktrees; this observation does not establish the cause of the failures.

The eight failed matrix cases were rerun with the same strict assertions, viewports, and deadlines, with trace recording disabled: **5 passed, 3 failed** in 23.0 minutes. Chromium 200% Tower, all three Firefox cases, and WebKit Tower passed. WebKit solo again exceeded its 10-second geometry-stability predicate, and WebKit PvP reproduced the clipping described below. Chromium 200% PvP passed its viewport sweep but failed a later chat-reopen width assertion (452.234 px difference, maximum allowed 3 px).

The chat test allowed a missing log box immediately after resizing from mobile to desktop to become a zero-width baseline. Its recorded normal desktop width was exactly 452.234375 px, matching that failure difference; the actual initial box was not logged. The test now waits for a visible log, rejects a missing baseline, and uses its measured width directly. The original 120 px expansion and 3 px restoration thresholds are unchanged. The focused Chromium 200% PvP rerun against this corrected baseline **passed** in 1.3 minutes with the original trace settings enabled.

The full matrix also captured these additional layout failures beyond the seven audit fixes:

- **Firefox and WebKit Tower, 1024×768:** only 68 of 160 tile centers passed the countdown-baseline hit-test in the full run. The Firefox trace shows a 524×346 board container retaining a 928.75×432.53 grid at scale 1.053 after resizing. Both Tower cases passed their isolated reruns without a game-code or assertion change.
- **WebKit PvP, 800×360 — remains unfixed:** 114 of 120 tile centers passed in both the full run and isolated rerun. Three measurements over 8.9 seconds showed six bottom-row centers below the clipped main area. Grid rows plus gaps occupied 246.719 px inside a 236 px main area. The grid fit within its board; the parent clipped the board's bottom row. This is an additional layout defect beyond the seven audit fixes.
- **WebKit solo — remaining test failure:** the 10-second geometry-stability predicate timed out in both runs. The full-run trace shows its measurements and all 19 layout assertions completing after that deadline. The retry did not record a trace, so it does not establish the same internal timing sequence.

All tests use local synthetic data, memory storage, or the browser suites' configured API stubs. No live player account or production storage was used.
