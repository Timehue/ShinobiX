# ShinobiX performance follow-up — 2026-09-06

This is the original development-checkout report. The release was adapted to newer live main separately; see [live-main integration](PERFORMANCE_LIVE_MAIN_2026-09-06.md) for the shipped scope and release checks. In particular, newer main's pet-stage and Warfront implementations supersede their development-checkout changes below.

This follow-up implements the remaining changes supported by the audit and local evidence. It extends the [initial gauntlet](PERFORMANCE_GAUNTLET_2026-09-06.md). Existing narrative work is preserved. No combat rules, progression, currency, ownership, pet eligibility, Chronicle rules, or visual styling changed. One existing pet presentation bug was corrected. No infrastructure, database schema, deployment, or production data was changed.

## Changes

| Files | Finding | Change and player benefit | Risk |
|---|---|---|---|
| `api/_storage.ts`, `api/_storage-projection.ts`, `api/bloodlines/list.ts` | Gallery generation read the entire registry and complete character saves just to use player keys, owner names, and authored bloodlines. | Use the existing keys-only registry query; Postgres returns only the two required save fields in one parameterized query. Registry counters, character inventories, catalogs, and unrelated images stay in the database. Authorization, sorting, images, response, and gallery cache window remain. | Low to medium; no derived table or write synchronization. |
| `api/player/roster.ts` | Roster generation transferred unrelated top-level creator/catalog/image data. | Read only the character and the existing travel/elapsed-state inputs. Settlement, Nindo display, authoritative carried-pet eligibility, sleeper-camp recovery, and public projection remain. | Medium; regression checks cover settlement and verify that the complete save remains untouched. |
| `NindoEditor.tsx`, `nindo-integration.test.ts` | Copying props into draft state in an effect caused extra renders and broke the lint gate. | Keep an optional local edit; otherwise derive the display directly from current character props. Text and banner remain together when typing, saving, clearing, or receiving a new pristine value. | Low. |
| `AdminLegacyPanel.tsx` | The definitions effect called a state-changing request wrapper and lacked cancellation. | Separate the request from status updates, cancel retired definition loads, and ignore their responses/errors. Mutation request behavior is unchanged. | Low. |
| `screens/Messages.tsx`, `e2e/performance-future.spec.ts`, `lib/poll.ts` | The integration review found that mail's initial read still ran outside the poll; slow reads could overlap and paint a retired conversation. | One lifecycle now owns initial and periodic inbox/conversation reads, with timeout and cancellation on navigation, unmount, or mutations. Rendered messages are keyed to their partner; send/delete/block completion resumes a fresh read. Block-list loading also cancels on cleanup. The helper's example now demonstrates the owned initial read. | Low to medium; the browser regression reproduces the old overlap and checks cancellation, the selected conversation, and sending a reply. |
| `pet-duel-stage-director.ts`, its regression tests | Extending a setup retreat earlier to limit its speed could collide with an already completed high-priority motion segment and discard the whole retreat. | Clip only setup retreats at completed high-priority beats. Active dodges/contact recovery still win, velocity remains bounded, and damage/events/winner are unchanged. | Medium; deterministic presentation and live-playback regressions apply. |
| `PetWarfrontRiteStage3D.tsx` | Active projectiles allocated a new position vector, membership set, and sliced array every frame; many old scene components were unused. | Reuse active vectors and a membership set; iterate the existing bounded projectile pool without copying the sampled array. Remove unreachable scene components and unused camera arguments. The mounted scene and its artwork stay intact. | Low; no simulation change. |
| `PetWarfrontRite.tsx`, `pet-duel-cinematic.ts`, `chroniclepreview.tsx` | Unused bindings, one reassignment declaration, and a preview Fast Refresh export warning blocked clean checks. | Remove unused bindings, use `const`, and export the preview component. No feature or rule is removed. | Low. |

Client paths in this table are under `shinobij.client/src/`; component and screen names retain their existing directories.

The storage projection is optional at the KV interface. The active direct-Postgres adapter projects inside SQL. Memory, retired REST, disk, and rollback-proxy adapters retain their normal batched/routed reads and project afterward. Errors propagate to the existing endpoint error handling. Missing paths remain absent; explicit JSON null stays null; requested ordering and duplicate keys are preserved. Projected reads bypass the full-value cache and never populate it. They must not be used as input to a save write.

## Pet-stage test correction

The initial failure was real for the two setup casts at ticks 94 and 101: their retreat was cancelled by completed motion. A focused regression now asserts both distance breaks. The old all-casts distance assertion also demanded a complete retreat while the same fighters were still performing a dodge or strike recovery. That conflicts with the director's documented priority and speed rules. The mixed-fight test now requires separation for unobstructed setup windows; the new regression explicitly requires the overlapping cast at tick 1145 to retain its dodge. Existing motion-speed, simultaneous-movement, train-following, planted-guard, recovery, combat-truth, and party-fight assertions remain.

## Measurements

| Check | Observed result | Limit |
|---|---|---|
| Synthetic authored save projection | Full save **56,051 B**; gallery fields **117 B**; roster fields **2,264 B**. | Database-to-server JSON-value bytes for the explicit fixture, not production averages. Endpoint response bytes are unchanged. |
| Rejected replay lookup proposal | 1,303 snapshots / 123 events: existing lookup **1.9423 ms**, proposed binary lookup **2.0927 ms** median in 31 alternating-order paired samples after warmup. Output was equal, but the proposed optimization was removed. | Earlier noninterleaved timings varied under concurrent test/browser load. No replay latency gain is claimed. |
| 100-player local load check | **3,778 calls, zero unexpected errors**; 46.2 requests/s over an 82-second run including ramp/drain. | Isolated in-memory server; no production database or real mobile network. |
| Load-test endpoint p95 | Autosave **4 ms**, heartbeat **3 ms**, save read **6 ms**, reward claim **3 ms**; health p95 **3 ms**. | 99 intentionally induced save conflicts returned 409 and were refetched successfully. They are expected protocol responses. |

Reproduce the byte fixture with `node --import tsx scripts/benchmark-public-projection.mjs`. Reproduce the isolated server load check with `node scripts/load-soak.mjs --players=100 --seconds=60 --ramp=10 --port=41989`. Do not treat local in-memory results as a production capacity commitment.

## Verification

- Full regression suite: **8,851 passed, zero failed or cancelled**. The formerly failing pet-stage test now passes. Focused storage/projection/ownership checks: **81 passed**; final gallery/Nindo/pet adjustments: **14 passed**. After removing the slower replay-lookup proposal, all **46 presentation/live/lockstep playback tests** passed again.
- Lint: **zero errors and warnings** across the client checkout; the revised browser spec also passes scoped lint. All 23 baseline errors and the Fast Refresh warning are resolved without new rule suppressions.
- Production build and type checks pass, including story validation, client/server compilation, Vite, legal prerender, dist verification, and unchanged size gates. The final client rebuild after removing the unhelpful replay lookup proposal also passes, as do its artifact and size checks. Final budgeted product JS/CSS: **8,180,094 B raw / 2,386,429 B gzip**; no startup or bundle-size reduction is claimed for this follow-up.
- Browser coverage: all **eight distinct desktop/mobile cases pass** across the runs: travel request counts, archive polling lifecycle, Nindo text/banner save and clear, and repeated archive resource checks. The four profile/resource checks passed in 44.9 seconds; the final two resource checks passed again after improving the sampling boundary.
- Resource measurements compare successive 20-visit windows after initial warmup (43 visits per viewport). After allowing queued render cleanup, desktop held **2,343 DOM nodes / 399 listeners**, and mobile held **2,324 nodes / 401 listeners**, unchanged across all three samples. Both retained one document and constant live element counts. JavaScript heap rose about 145 kB / 79 kB across the final desktop/mobile window; this short diagnostic does not certify hours-long heap stability.
- The first desktop resource sample rose by 398 nodes. Repeated windows showed those nodes were transient rather than accumulating per visit; waiting past the render/task cleanup boundary removed that variation. The comparison retains the original node/listener growth bounds. An additional preview-copy attempt timed out before testing; the final rerun used the already complete immutable preview with its Vite manifest verified against the build. That preview predates only the removal of the output-equivalent replay lookup proposal; the tested profile/archive/travel code is unchanged.
- The final source inventory covers **1,684 runtime files and 738 effects**; it found no network/timer effect without dependencies. `git diff --check` passes.

Remaining toolchain advisories are Vite's future native config-loader compatibility notice, the aggregate bundle-size advisory below its enforced limit, Babel's large-component note, and terminal color-environment notices. The final build also printed plugin timing diagnostics. They do not fail the build or lint gate; none is suppressed by this pass.

Raw local evidence is in `.tmp/performance-gauntlet/future-*`. Logs and temporary comparison copies are ignored local artifacts. Regression tests, the projection benchmark, and this report are retained in source.

## Final integration review

The retained changes were traced from their mounted consumers and request handlers to their helpers and storage adapters. All three admin catalogs share the reader; the combat-content composer still joins the jutsu/item catalogs. Both public endpoints use the optional projection interface, and its fallback preserves adapter routing. Roster settlement has all six required top-level inputs and never writes the partial save. Tower sealing retains a separate post-lease read; merc deployment retains its locked cooldown/village recheck. The shared clock remains connected through its direct imports and App re-export. Archive visibility owns its fetch, Nindo still saves through Profile's character updater, and the pet director is used by replay, live, and lockstep playback. The mounted Warfront arena, fighters, and effects remain present.

The normal Node test runner discovers the added tests under `api` and `shinobij.client/src`; the ordinary Playwright configuration discovers both new specs, and CI runs those standard runners. No additional route or test registration is required. The focused integration rerun passed **130 tests**. The new slow-mail browser regression failed against the earlier immutable build at the expected assertion: **two overlapping reads instead of one**. The mail lifecycle correction is included in the changes table above.

Final delivery verification:

- **10/10 desktop/mobile browser cases passed together in 56.4 seconds**, with zero retries, against a fresh immutable snapshot of the final build (`.playwright-dist-14995`). This supersedes the earlier eight-case, multiple-run browser checkpoint. The mail test verifies no second read during a slow initial fetch, cancellation on leaving the conversation, exclusion of the retired response, and a successful reply to the selected partner.
- Server compilation, final client compilation/build, story checks, prerender, dist verification, and unchanged size budgets pass. Final budgeted product JS/CSS is **8,180,472 B raw / 2,386,459 B gzip**. The final mail bundle was checked against the delivered source; it includes the stable empty-thread value used to avoid unnecessary scroll-effect runs.
- The full lint rerun reported zero errors and one new mail dependency warning. That warning was corrected, and scoped lint of every subsequently changed client/spec file passes with no warnings. `git diff --check` passes.
- Repeated archive visits again retained constant DOM/listener counts: desktop **2,343 / 399**, mobile **2,324 / 401**, and one document each. Final-window heap changes were **144,004 B / 78,520 B**; the same short-diagnostic limitation applies.
- The **8,851-test full-suite pass** and subsequent **46 pet playback tests** above precede this final mail correction. The **130 focused tests** and **10 final browser cases** provide the additional integration evidence; the entire full suite was not run again after the mail-only change.

The latest logs are `.tmp/performance-gauntlet/future-integration-*`, plus `future-mail-baseline.log` for the intentionally failing regression against the earlier build. The final artifact logs use `future-integration-certified-*`; earlier intermediate builds in that directory are checkpoints rather than the final deliverable.

## Remaining decisions

- **Roster/archive growth:** unrelated save transfer is now reduced without a second source of truth. The full roster still returns every player and required public pet data, and the archive returns every authored bloodline. Changing that contract requires consumer-aware pagination and real row/payload distributions. Do not silently truncate players or pets.
- **CSS:** the large global stylesheet is an ordered stack of overrides. This pass preserves its order and existing split/lazy routes. Further route splitting needs a dedicated before/after visual matrix; file size alone does not establish that a rule can be moved safely. Bundle budgets are not widened.
- **Horizontal scaling:** the accepted multiplayer ADR and deployment check intentionally keep one replica because presence, rooms, broadcasts, and live timers share process state. The local soak passed. A broker/adapter alone would not make all those authorities consistent, so a production architecture migration is not justified by the available evidence.
- **Physical devices and production:** Android memory/FPS/battery, real database query plans, and production endpoint percentiles still require those environments. Local browser cycles and isolated load tests improve coverage without claiming to replace that evidence.

Changes are uncommitted and have not been deployed.
