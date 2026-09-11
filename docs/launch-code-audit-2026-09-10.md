# Launch code audit — 10 September 2026

Historical record from the original local checkout, before these fixes were integrated onto current main. The measurements below describe that checkout and its test runs.

This document records the audit before fixes. Follow-up changes and their verification are tracked in [the fix report](launch-code-fixes-2026-09-10.md).

This audit reviews the current working tree, including its pre-existing uncommitted changes. Findings below describe observed behavior in isolated local reproductions, supported by the actual source. No production requests, account changes, or game-code edits were made. Priorities are review judgments: P1 means fix before launch; P2 means a concrete defect to address, with its triggering conditions stated.

1. **P1 — Selling an equipped consumable credits ryo without consuming the item.**

   [Inventory settlement](<C:/Users/Tyler R/source/repos/NinjaK/api/inventory/_sale.ts:102>) deletes the equipment selection and adds the sale price, leaving the backing inventory/stack unchanged. [Shop settlement](<C:/Users/Tyler R/source/repos/NinjaK/api/shop/_sale.ts:15>) has the same accounting error. Consumable equipment slots select units still held in the backpack; they are not separate owned copies.

   **Observed:** using the actual save sanitizer and sale functions, three sales credited 600 ryo while the original shuriken stack remained at one. This reproduced with `STRICT_RAW_SAVE_LEDGER` both enabled and disabled. The inventory UI hides the equipped-consumable sale option, so this requires a crafted authenticated request; it is not an ordinary visible Sell-button action.

   **Correction:** reject sales from reference slots or remove the corresponding owned unit as part of settlement. Apply the correction to both sale paths.

2. **P1 — A participant can end a live pet duel before either player has played.**

   [The socket completion callback](<C:/Users/Tyler R/source/repos/NinjaK/api/_realtime/pet-duel-socket.ts:372>) runs the full replay and unconditionally calls `finishDuel`. [The replay](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/_duel-replay.ts:313>) simulates to completion rather than stopping at the session's reported progress.

   **Observed:** normal challenge and acceptance callbacks, with synthetic pets and memory storage, produced a running session with both progress values at -1 and zero inputs. A participant's immediate completion notification emitted a KO result, removed the session, and cleared both player pointers. The opponent had no opportunity to issue a move. This reproduction did not grant currency or rewards, and the finding does not claim otherwise.

   **Correction:** verify a terminal state within the authoritative settled timeline before accepting completion.

3. **P1 — The first ranked pet settlement can remove the other player's match before they discover or watch it.**

   [The queue panel](<C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/src/components/PetLadderQueuePanel.tsx:95>) settles immediately after retrieving its replay. [Settlement](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/battle-result.ts:1407>) then retires the proof and [deletes both active pointers and the settlement intent](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/battle-result.ts:393>). [Replay retrieval](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/ranked-watch.ts:64>) relies on the deleted proof or intent.

   **Observed:** actual in-memory handlers ran A queues → B joins, starts, watches, and settles → A polls. A received `idle`; its replay request returned 404, although its saved rating had already fallen to 988. Queue polling occurs every 2.5 seconds while queued, so ordinary request ordering can produce this result. Ratings were applied; the failure is match discovery and playback. Source tracing also shows that if A already received the token, the failed watch leaves the panel stuck: the token is marked handled before fetching, active polling is stopped, and the error path has no retry action.

   **Correction:** keep a discoverable completed match and its replay inputs after settlement, and allow failed replay loads to retry.

4. **P2 — Ranked pet replays show the opposite personal verdict to the alphabetically later participant.**

   [Ranked resolution](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/_ranked-duel.ts:58>) orders combatants by account name. [The watch handler](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/ranked-watch.ts:78>) returns that same script to either participant, and [the queue panel](<C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/src/components/PetLadderQueuePanel.tsx:114>) passes it directly into the replay. [The renderer](<C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/src/components/PetShowdownBattle.tsx:3637>) labels the canonical player side “Your team” and uses its outcome for the victory/defeat display.

   **Observed:** synthetic account `auditboro` won and received rating 1012, while its returned replay put its pet on the enemy side and reported `finalState.outcome: loss`. The personal UI conclusion is traced through the component; this was not a browser playback reproduction. The rating computation was correct in this check.

   **Correction:** orient labels and verdicts to the viewing account, or explicitly present both named sides without implying the canonical side is always the viewer.

5. **P2 — Ordinary unequip deletes gear when strict ledger is disabled.**

   [Inventory sanitization](<C:/Users/Tyler R/source/repos/NinjaK/api/save/_sanitize-inventory.ts:59>) supplies only stored backpack/stack ownership to [the ownership filter](<C:/Users/Tyler R/source/repos/NinjaK/api/save/_entitlement-guard.ts:56>). [The ordinary unequip action](<C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/src/screens/Inventory.tsx:405>) puts equipped gear back in the backpack and clears its slot; the filter removes the returned item because it was previously equipped.

   **Observed:** an equipped Rustfang Kunai with an empty backpack became both an empty backpack and empty equipment after sanitizing the unequip operation. This applies when `STRICT_RAW_SAVE_LEDGER` is unset or `0`; strict mode's later ownership reconstruction avoided this loss. The production setting was not inspected.

   **Correction:** conserve ownership across backpack and ordinary equipment transfers, excluding consumable selection slots from extra ownership counts.

6. **P2 — Conceding a Standing Court fight preserves the round instead of resetting the run.**

   [The First Pact forfeit branch](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/showdown.ts:989>) reads progress without settling the loss. [Normal terminal-turn settlement](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/showdown.ts:1142>) calls the Standing Court loss rule, which [resets the round to zero](<C:/Users/Tyler R/source/repos/NinjaK/shared/first-pact-contract.ts:1146>).

   **Observed:** with valid campaign progress seeded at Standing Court round 3, the start and forfeit handlers both returned 200; the fight outcome was loss, the stored round remained 3, and the same encounter could be started again. A player can therefore concede and retry the current round instead of restarting the run.

   **Correction:** apply the same Standing Court loss settlement to concessions.

7. **P2 — Old Standing Court victories can award progress again after proof IDs fall out of the receipt list.**

   [The progress contract](<C:/Users/Tyler R/source/repos/NinjaK/shared/first-pact-contract.ts:1141>) checks only the last eight proof IDs. Each clear takes five victories. Meanwhile [finished Showdown sessions remain eligible for settlement retries](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/showdown.ts:1014>), with a [45-minute session retention period](<C:/Users/Tyler R/source/repos/NinjaK/api/pet/showdown.ts:129>).

   **Observed:** using ten seeded completed-session fixtures to represent two clears, actual turn-handler settlement followed by replaying the first five retained session IDs advanced every round again. Clears increased from 2 to 3 and standing from 800 to 1200, without creating another fight. This reproduction used terminal-session fixtures, not ten newly played fights; it verifies the settlement/idempotency failure. The old sessions must still exist when replayed.

   **Correction:** retain durable settlement identity for at least as long as a completed session can be retried, or mark settlement on the session itself.

Validation:

- Full repository test runner on Node 22.23.1: **10,053 passed; 0 failed, cancelled, or skipped**, across 1,301 suites (647.96 seconds).
- `npm run build` on Node 22.23.1: **passed**, including server/client compilation, story-content checks, Vite bundling, legal-page prerendering, distribution verification, and build-size checks. The size checker reported a product JS/CSS warning while passing its configured limits.
- Client `npm run lint`: **0 errors, 11 warnings**. Ten warnings concern Fast Refresh exports; one concerns an effect cleanup ref in `PetWarfrontRiteStage3D.tsx`. This lint invocation used the installed default Node 24.15.0.
- Existing `e2e/release-smoke.spec.ts` on Node 22.23.1: **42 passed, 0 failed, 7 skipped** (5.8 minutes), covering Chromium, Firefox, and WebKit across seven desktop/mobile/tablet configurations. The seven skips were the Sentry-only case: six excluded by its project restriction and one because this local build did not enable the test Sentry DSN. These smoke tests use the suite's API stubs; they are not a live-backend certification.
- Deployment configuration, mission eligibility, and runtime-mode documentation checks: **passed**.
- Release asset check: **135 achievement references present; 235 badge WebPs and 21 Pet Home WebPs verified**.
- The seven findings above were checked separately using actual functions or handlers with synthetic in-memory data. Their descriptions distinguish complete callback flows, seeded state, and source-traced UI behavior.

These checks describe the local working tree; they do not assert a production environment setting or a live deployment result. Only this audit document was added to source control's working tree by the review. Build outputs and temporary test logs were generated locally; the audit's isolated browser snapshot was removed after the run.
