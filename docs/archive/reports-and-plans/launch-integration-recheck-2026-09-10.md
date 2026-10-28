# Launch integration recheck — 10 September 2026

Historical record from the original local checkout, before these fixes were integrated onto current main. The measurements below describe that checkout and its test runs.

Follow-up to [the seven audit fixes](launch-code-fixes-2026-09-10.md). This review traced the actual screen, transport, Express/socket handler, save sanitizer, and storage adapter connections around those fixes. All reproductions used synthetic local data; no production account, storage, deployment, or repair was used.

Five additional integration defects were reproduced and corrected. The full unit suite and production build passed, and all original ordinary-browser failures are accounted for by passing reruns or one configured skip. The strict matrix reproduced WebKit PvP clipping at 800×360; WebKit measurement timeouts remain recorded below.

## Additional defects reproduced and corrected

| Connection | Reproduced behavior | Correction |
| --- | --- | --- |
| Legacy equipment → inventory screen → save and sale handlers | Swapping a legacy `weapon` by the inventory screen's actual `{ weapon: old, hand: new }` request lost the new item with strict ledger unset or `0`. Selling legacy-only equipment from the displayed canonical `hand` slot returned 400 from inventory sale or 409 from shop sale. | Shared alias resolution gives populated canonical slots precedence before ownership allocation. Both sale paths resolve the requested physical slot and clear its aliases. Authenticated handler tests verify persisted results with strict ledger unset/`0`/`1`. |
| Ranked settlement/recovery → App character | `battle-result` returned `character` and `_saveVersion`, but the transport returned `void` and the screen discarded both. The global auth wrapper deliberately skips version-only adoption for character-bearing responses, so this path left the displayed character stale. | Active settlement returns the validated owner snapshot. Completed recovery reads the current save. Both pass through App's existing versioned character commit; canceled effects cannot commit or restart the old replay. |
| First Pact checkpoint → Standing Court settlement | Holding a checkpoint write beyond its five-second lease, settling the final Court round, then releasing the checkpoint overwrote standing 400 with 0 and restored the previous round/proof state. | Ordinary progress updates compare-and-set against the exact predecessor and rebase only after a definite rejection. Thrown/ambiguous writes propagate rather than being blindly reapplied. |
| PostgreSQL cache → durable Court receipts | The new receipt key prefix missed the adapter's cache exclusion. A cached missing receipt survived another worker's write; replaying a sequence of paid wins after progress churn credited another 400 standing. | Receipt reads and cache population now use the uncached authority path. The regression exercises the actual PostgreSQL adapter with a fake SQL transport to represent another worker's writes. |
| Court concession → First Pact screen | The server returned reset progress, but the boolean concession transport discarded it and closing the fight did not refresh the screen. | A First Pact concession returns progress, which the screen adopts before clearing the recovery handle. Expired-session responses read current progress and preserve any versioned completion grant. Failed or unconfirmed responses remain retryable; account/mount checks reject stale callbacks. |

## Connections checked

- Both sale handlers call their corrected helpers inside the versioned save mutation path. Save POST passes existing equipment into ownership sanitization and then enforces the final ledger boundary.
- The mounted ranked panel uses the registered queue, start, watch, settlement, and acknowledgment handlers through the installed authentication wrapper. Both participants' replay orientation and completed-receipt recovery remain covered by handler regressions.
- Express attaches Socket.IO to the same HTTP server. Socket connection registers the pet-duel callbacks; progress, completion hints, and peer dropout reach the bounded authoritative replay check. Reconnect catch-up restores room membership, autonomy, and synchronization.
- Normal terminal Court turns and concessions use the same durable settler. All ordinary First Pact mutation callbacks recompute their results when rebased and perform no external writes inside those callbacks.
- Docker rebuilds server and client source. Server compilation includes imported route modules and API helpers; the image copies the resulting server and client distributions.

## Verification

- Initial focused route/request-shape, live-duel, ranked-handler, Court-handler, and equipment checks: **58 passed**.
- Final equipment/sale focused checks: **83 passed**, including authenticated handler writes and strict ledger unset/`0`/`1`.
- State/receipt-adapter focused checks: **68 passed**; strengthening the delayed-write regression was followed by **4/4 passed**.
- Ranked transport, panel wiring, version coordinator, and handler lifecycle checks: **26 passed**.
- Concession transport and First Pact screen wiring checks: **24 passed**, including malformed responses, fallback grants, and recovery retention.
- The final compiled Express/Socket.IO probe passed **23 assertions** against isolated memory storage, checking both route prefixes, handler methods, save authentication, malformed JSON, unknown-route JSON 404s, and the real Engine.IO handshake.
- Full regression run: **10,123 passed**, **0 failed/cancelled/skipped**, across **1,304 suites** in 754.779 seconds.
- Full production build: **passed**, including server/client compilation, content checks, bundling, distribution verification, and size checks. The first attempt caught three TypeScript default-import declaration errors in the new API test fixture; correcting only those test declarations resolved them. Its six runtime tests passed again.
- Full frontend lint: **0 errors, 11 existing warnings**. The new concession browser spec also passed scoped TypeScript and ESLint checks after creation.

The full ordinary browser suite finished with **378 passed, 275 skipped, and 38 failed** out of 691 cases (reported duration 1.7 hours). It used two workers against a verified immutable preview: 5,554 files, 484,408,747 bytes, manifest SHA-256 `a08deb01bbae654eb2583c602151a76a17585657d98e9240dab920f1303b2b18`. This run overrode the preview startup allowance to 900 seconds; test deadlines and assertions retained their configured values. The full strict combat matrix finished with **15 passed, 10 skipped, and 5 failed** out of 30 cases (reported duration 1.7 hours), using one worker, `COMBAT_LAYOUT_CAPTURE_PHASE=after`, and `COMBAT_LAYOUT_STRICT=1`. The five failed strict cases were rerun sequentially with unchanged deadlines and assertions: **three passed and two failed**.

After both full suites exited, the ordinary failures were rerun sequentially with one worker against the same preview. Exact project/spec/title matching accounts for **all 38 original failures: 37 passed on retry, one configured skip, zero unmatched**. The skip is the Firefox adaptive-shell case, which had originally failed during browser teardown after being skipped. The retry selection also ran one additional `jutsuTraining` case; its pass is excluded from those 38. Awakening Stone was rerun separately by title after the directory test edit shifted its declaration from line 776 to 777.

Ranked browser coverage is **14/14 cases** across seven configurations: eight passed in the full run and six passed in isolated reruns. Both scenarios verify the authoritative character, return to matchmaking, and acknowledgment. The complete original failure list and its rerun mapping are retained in the evidence directory. The initial run is not reported as a clean run; its failures included test-contract mistakes described below, interrupted asset requests, setup/measurement deadlines, and browser teardown errors.

All seven configurations loaded the original concession regression, which verified its failed request and retained recovery, then tried to dismiss an error notice outside the still-active confirmation dialog. That click was intercepted by the modal and exhausted the case deadline. The test now retries directly through the active “Yes, concede” control. All recovery, reset, request-count, and cleared-breadcrumb assertions remain; scoped TypeScript and ESLint passed after this test-only correction. The fresh corrected run passed **7/7 configurations**, with one worker against the same verified preview (2.3 minutes).

The mobile directory case also omitted the `.user-hub-tabs` horizontal-scroller allowance already used by the general screen audit. Its trace measured a 390-pixel document with no document overflow; only the Blocked tab inside the bounded native scrolling rail extended beyond the viewport. That test call now uses the existing allowance, which requires a real overflowing `auto`/`scroll` ancestor and retains document-overflow and profile-navigation assertions. Scoped ESLint passed. A scoped TypeScript check reported the same two existing `fateShards` fixture diagnostics with and without this change; the comparison reverted only this edit in memory.

The full strict run reproduced the previously recorded **WebKit PvP clipping at 800×360**: six completed assertion attempts consistently hit 114 of 120 tile centers. The panel ends at y=346; six missed centers are at y≈347.9, and the board extends to y=356.71875. The assertion exhausted its ten-second retry allowance; this was not an overall test deadline. The source changes above do not modify combat layout. Earlier evidence is documented in [the previous verification report](launch-code-fixes-2026-09-10.md).

| Strict case rerun | Result |
| --- | --- |
| Chromium Tower MPvP | Passed (41.7 seconds). |
| Firefox solo and Tower | Both passed (4.7 minutes combined). |
| WebKit solo | The ten-second measurement predicate timed out at 2560×1440. Measurement returned afterward and every recorded geometry assertion for that sample passed. The run remains failed. |
| WebKit PvP | The first isolated attempt received `ECONNRESET` on the session fixture-clock request before the viewport matrix. A further standalone attempt got past that request and timed out during the second measurement of 320×568. Its first sample recorded 120/120 tile-center hits and no document overflow; geometry assertions for the repeated sample did not run. Neither retry reached 800×360, so neither replaces the six clipping measurements from the full run. |

All 13 production files changed during this recheck still match their recorded SHA-256 hashes from the tested build. The scoped diff whitespace check passed. All verification processes exited and their ports closed. The temporary preview and three temporary configs were removed; copies of those configs remain with the evidence.

Evidence is retained under `C:\Users\Tyler R\AppData\Local\Temp\ninjak-integration-recheck-20260910`, including the full logs, browser traces, `browser-retry-coverage.json`, the preview manifest, source hashes, and `run-configs`. The ordinary retry batch is in `ordinary-retry-20260910-172905-381-36712`; strict retries are in `strict-retry-20260910-173810-149-42868`, with the last standalone PvP attempt in `pvp-final-retry.log` and `pvp-final-retry-results`.
