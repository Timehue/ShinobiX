# Performance remediation and main integration — 2026-09-16

This pass follows the request to fix practical remaining issues, then check and publish to live main. It integrates the two earlier performance passes into an isolated checkout of current `main`, preserving concurrent game and model repairs. Earlier reports describe historical local runs; this report records the current-main outcome.

## Release baseline and preservation

The dirty original workspace remains on `codex/safe-consolidation-polish` at `e3c09fe10988badc2a4b6a96f1f1bf4c085428b3`. It is not the release base. The release checkout starts at `adb29325d2c78edaa8524fb1dc54ea81f0fad4fc` on `codex/performance-remediation-live-20260916`, with fresh `npm ci` installations from main's root and client locks and Node 22.23.1. Only the prior retained patch manifests and reviewed new fixes are integrated; unrelated working-tree changes are excluded.

The two previous asset blockers already pass on main: its roster hash certification and Warfront model size checks both pass. Commit `adb29325d` losslessly packs the repaired bindings and reconciles provenance; `legendary-1.glb` is 628,148 bytes, within the unchanged 1 MiB limit. This task preserves those models, approvals and budgets instead of replacing them with the older dirty workspace assets. No root dependency upgrades, transitive client upgrades, database changes or production configuration changes are included. The existing transitive versions of `suspend-react` and `three-stdlib` are declared directly for the shared parsed-loader contract.

Before this release, a read-only request to `https://shinobijourney.com/health` returned `ok: true` and deployed commit `346b59ab5801bfd413dc6fa50c1ac8684abc73d9`, one commit behind the repository baseline.

GitHub's prior-deployment timeline explains a likely release obstacle: baseline `adb29325d` failed its first Firefox combat CI attempt, its aggregate failed at 05:29:07 UTC, and Railway's deployment became inactive six seconds later. CI passed on attempt two after deactivation, but there is no later deployment record or successful cutover event. The provider's inactive description is blank, so cancellation due to the initial CI failure is an inference. Its separate commit status saying “success” does not prove that the game serves that commit. Publication must verify the actual public health SHA and successful deep-health result; manual post-deploy checks must start only after cutover to avoid the repository's documented wait-for-CI deadlock.

## Remediation

The earlier retained improvements also ship in this integration: one shared GLB transport instead of two concurrent downloads, no leftover fallback timers after completed pet warmups, three display-membership batches instead of 52 full-save reads in the synthetic shared-state scenario, and removal of unactivated Village hover/focus imports. Their attributable before/after measurements and limitations remain in the historical [gauntlet](performance-gauntlet-2026-09-16.md) and [follow-up](performance-followup-2026-09-16.md) reports. These are request/work reductions, not a claim that every player journey became faster.

### Town Hall Materials

Main already contains `e6856f900`, which fixes stale shared-state values overriding confirmed store snapshots. The unchanged compiled main passes the deterministic stale-zero/direct-20 scenario and an externally observed 20-to-5 drain, as well as unknown/error/verified-zero behavior. Its refresh follows changes in the shared poll rather than adding a second periodic war-map fetch.

A narrower remaining race was reproduced on compiled main: after a successful donation displayed 35 Materials, an older pending read correctly failed the mounted screen's write-generation guard but populated the module cache with 20. Immediate Command-to-Treasury re-entry accepted that cached 20 under a new read generation. The fix calls the existing `clearWarMapCache()` when a successful donation supplies confirmed stores. This retires both the old memo and its pending owner; the next read is fresh. The existing receipt, authority, display precedence and event-driven refresh remain intact.

The earlier experimental polling/store-helper implementation was withdrawn and archived after discovering main's fix. It is not part of the release. The new regression tests exercise the actual main implementation. All three compiled-browser cases pass after the cache fix. The stable display still uses one war-map read over 24 virtual seconds, then one additional read after an observed external drain; leaving the relevant tab stops those reads.

### Animated map targets

The camera's native 140 ms animation previously interpolated zoom while marker counter-scaling immediately changed to its destination. Recorded intermediate targets ranged about 38–51 pixels. The candidate supplies a native CSS `linear()` timing curve that follows the reciprocal camera scale, so marker and label transforms track the existing camera animation. It does not add a JavaScript animation-frame loop or inherited-style writes while panning. Interrupted animations start from the painted camera, and completion handlers are scoped to their owning transition.

Main's 46-pixel landmark/Academy targets and -7-pixel sector ring are retained. New tests require intermediate sizes to stay in their settled endpoint band within 0.01 pixels, with an absolute 44-pixel minimum. Existing main assertions and visual goldens are preserved. Focused merged zoom unit tests pass 29/29.

The first compiled-browser pass caught a reversal defect in the candidate: the minifier removed `void el.offsetWidth`, allowing the browser's native reversal-shortening rule to reduce 140 ms to 52.939 ms. A small native-browser probe reproduced that exact duration in Chromium and WebKit. The final hook uses `el.getAnimations()` to flush the shared start pose; the call survives minification and the probe restores 140 ms in both engines. This work remains on discrete zoom transitions, outside the pan path. The initial 44-pass/2-fail/94-skip browser run is retained separately.

The corrected production map matrix passes **46 cases**, with 94 project-specific skips, zero failures/flaky results and zero retries. Chromium and WebKit phone targets measure 46.166–46.568 pixels through zoom, and 46.166–46.230 through reversal; all three native transitions retain 140 ms. Pinch, zero inherited writes while panning, interruption and cleanup assertions pass.

### Withdrawn legal-content startup experiment

The landing screen eagerly imports the full legal page even on login. An experiment using the existing `lazyWithRetry` boundary passed all six desktop/phone correctness cases and removed the optional legal request. Actual cold login JS/CSS transfer fell by 12,016 bytes. However, the matched 40-journey run exposed a tradeoff: cold mobile login improved from 4,684 to 4,289 ms median while returning first Bank readiness worsened from 3,664 to 4,802 ms. Navigation `responseStart` accounted for nearly all of the large delay (about 6 to 1,089 ms median); Bank code transfer and action-render time were essentially unchanged.

The harness retains one context across cold landing, warm landing, returning feature and warm feature, with fixed three-second observation windows. Faster completion can change when later navigations intersect unfinished image downloads. The records do not contain request-start/in-flight timing, so browser queuing is a supported hypothesis, not a proven cause. The field named `ttfbMs` records navigation `responseStart`, including pre-request/connection time; it does not isolate server response latency.

Restoring only the legal import returned first Bank readiness to 3,793 ms median and cold login to 4,744 ms. The experiment is withdrawn from both the release and original workspace, whose files match their respective pre-edit snapshots. Source and all results remain in `legal-static-control/`, `main-startup-after/` and `main-control-startup/`. No startup speedup is claimed.

A contemporaneous control served the immutable, untouched-main frontend snapshot through the same final optimized server. All 40 journeys completed, with zero recorded errors and 20 canonical save checks; the snapshot manifest matches the original baseline and both snapshot/server hashes remained unchanged. Mobile medians were:

| Journey | Original main baseline | Retained integrated frontend | Untouched frontend control |
| --- | ---: | ---: | ---: |
| Cold login | 4,684 ms | 4,744 ms | 4,757 ms |
| First Bank | 3,664 ms | 3,793 ms | 3,786 ms |
| Warm Bank | 1,031 ms | 1,143 ms | 1,145 ms |

The remaining warm-Bank timing and elevated CPU cost recur with the untouched frontend. Our frontend changes are therefore not necessary for that residual; this control cannot distinguish shared optimized-server effects from host/emulation/run conditions. It is a frontend control, not a full untouched-server rerun. Each cell uses five samples, Chromium 151.0.7922.34, a 390×844 viewport, 4× CPU throttling, 40 ms latency and 200,000 B/s download throughput. Raw samples, ranges and harness differences are retained in `main-startup-untouched-frontend-control/`. These local emulated results are not real-device or field certification.

### Stronghold integration

Main already allows pending dialogs to close. The retained follow-up also preserves ownership of submitted actions and reconciles late results after dismissal or account changes. The merged regular browser suite passed 48 cases, but the additional dismissal suite exposed two missing `busy` props that had been unchanged in the older workspace baseline and therefore absent from its patch. Restoring `busy={starting}` and `busy={!!pending}` publishes the correct `aria-busy` state without disabling any close control. All 32 extended Chromium/WebKit scenarios and 24 focused units pass after that correction. The original failed precondition is retained in `stronghold-merged/candidate-1`; no assertion was weakened.

A final-source regular run reached all 48 scenario assertions but failed its zero-pageerror gate on two WebKit fetch/access-control errors. A diagnostic run on the same seven source hashes, with unchanged scenarios/timing/assertions, passed all 48 and recorded no page errors or route-fulfillment errors. It observed canceled reads, but did not reproduce the two errors; their cause remains unclassified. Both results are retained. The diagnostic pass does not erase the earlier failure or prove it was harmless teardown.

## Validation

Current-main baseline and final integrated production builds both pass, including unchanged size budgets. After withdrawing the startup experiment, the initial graph is 1,440,023 bytes raw / 383,041 bytes computed gzip, versus 1,436,968 / 382,096 on baseline. Total product JS/CSS is 8,474,642 bytes raw / 2,383,965 bytes computed gzip. The initial graph and actual login chunk requests are different measurements.

Focused merged pet checks pass 36/36, Town Hall/cache/poll contracts 44/44, and release-health checks 16/16. Main's WebGL capability cache and release identity/security checks are retained. Optional session diagnostics and request-SLO enforcement remain disabled by default.

The final isolated Warfront browser gate passes all four applicable original tests with zero skips, failures or retries. Desktop and phone each record 40 settled resource samples across six fighter-replacement/quality/retire/remount cycles and freeze/resume: textures return from 18 active to two retired and 18 remounted, low quality uses ten, and geometry remains one. Cold eight-rig readiness and failed-rig recovery pass; zero page errors are recorded. All four success screenshots were inspected for fighters, arena and HUD without a persistent veil or blank canvas. This is resource/recovery and final-state visual evidence, not matched pixel, physical-device FPS or explicit context-loss certification. The QA build is isolated from the production build, whose manifest is unchanged.

Deployment topology, rollback-readiness, release-asset and tooling-handoff executable contracts all pass. The asset check verifies 135 achievement references, 235 badge WebPs and 21 Pet Home WebPs. These checks make no production requests or writes.

The built-Express onboarding, route and Village Stores matrix passes five cases with three original project-specific skips, zero failures and zero retries. It includes normal/delayed starter responses and the original authoritative cooking/donation/building Materials flow that failed in the historical follow-up. All nine visual comparisons pass against the unchanged goldens, with no skips or retries. Representative final desktop and phone combat captures were inspected for the rendered board, actors, HUD and available actions; this inspection is not a matched combat pixel comparison.

The complete unit/contract suite passes **11,084/11,084**, with zero failures, cancellations or skips. The final map flush and two Stronghold metadata corrections are additionally covered by the focused checks and browser scenarios above; no server implementation changed after the full suite. Full client lint passes with zero errors and 14 warnings. The release allowlist excludes the withdrawn StartScreen edit; main's public assets, visual goldens and root dependency manifests have no diff.

The release uses Node 22.23.1 with fresh root/client lockfile installations. Build verification runs root `npm run build`; the complete suite runs the package test entrypoint directly as `node --import tsx scripts/run-tests.mjs`; lint runs the client ESLint CLI over `.`. Artifact-only Playwright configs inherit the repository suites and isolate loopback ports/output directories, with zero retries, unchanged assertions and unchanged goldens. Combat additionally sets `COMBAT_LAYOUT_STRICT=1` and capture phase `after`; authenticated local flows disable trace capture. Exact commands, start/end times, exit codes, logs and report JSON are retained beside `run-release-gate.ps1` under the evidence directory. Timing runs use the checked-in `benchmark-startup.mts` and were kept separate from other owned builds/browser suites.

The complete strict combat matrix passes **20 cases**, with ten original project-specific skips, zero failures/flaky results and zero retries, across all six browser/display-scale projects. It runs with strict mode and capture phase `after` and completes in 23.8 minutes. All three browser engines pass Solo, PvP and applicable Tower geometry/action scenarios; the prior-main Firefox sprite-loading failure does not recur.

The complete mobile gauntlet passes **257 cases**, with 68 original project-specific skips, zero failures and zero retries, across all five original portrait, landscape and desktop-control projects. It completes in 11.9 minutes. Source assertions and screenshot goldens are unchanged.

The complete responsive matrix passes **802 cases**, with 603 original project-specific skips, zero failures/flaky results and zero retries, across all seven original projects. It completes in 34 minutes. All 21 Town Hall cases pass (three scenarios in each project); animated marker bounds and native 140 ms reversal pass in both phone engines, and real pinch/pan coverage passes in Chromium phone. Together with the separate gates above, these are final-source local checks. They do not erase the separately recorded intermittent Stronghold diagnostic failure or replace deployment verification.

## Publication follow-up

The integrated change was pushed to main as `eddb00bfadcada059cb89687860b7d5959da799d`. Production Image and CodeQL passed. CI passed every gate except responsive shard one: both desktop WebKit navigation-preload cases stalled in Playwright's pre-hover visibility/stability wait, including their built-in retry. The retained traces do not establish continuous tile motion as the cause. Railway marked the deployment inactive, and public health continued to report the older healthy revision; a successful push is not a verified live cutover.

A test-only correction replaces that pre-hover stability wait with real mouse movement to each visible tile and requires actual `:hover` receipt, plus observed keyboard focus. All deferred-request, Bank entry and runtime-error assertions remain intact. Three repetitions across all seven projects pass **42/42**, with zero skips, failures or retries.

The other responsive shard passed with one retried camera case. Its first attempt passed the animation duration, intermediate target size, reversal and unmount assertions, then an ambient Saito encounter dialog intercepted the sector's Leave button. The camera test now uses the existing supported wanderer-cooldown fixture pattern for Sector 40 only. It changes no game behavior, clock, motion preference, geometry limit or lifecycle assertion. Five repetitions in each phone engine pass **10/10**, with zero skips, failures or retries. Both changed test files pass lint. Product code, built artifact and model assets are unchanged by this follow-up.

Initial CI totals and original failed traces are retained in `publication/ci-eddb00b/`; the responsive matrix reported 800 passed, 602 skipped, two failed and one flaky case, with three built-in test retries. These records remain alongside the successful local checks. The follow-up must pass a fresh CI run and actual production revision/deep-health verification before it is described as live.

## Remaining work

- Cold mobile login remains around 4.7 seconds in this constrained local profile. The background-image and legal-loading experiments were withdrawn after adjacent-navigation regressions; no validated startup optimization from either experiment is retained.
- The two intermittent Stronghold WebKit fetch errors from the final-source regular attempt have no confirmed cause. The unchanged diagnostic rerun passes, but a reliable reproduction is still needed before proposing a fix.
- Physical Android/installed-runtime, GPU, thermal, battery and native context-restoration measurements require suitable devices.
- Representative PostgreSQL query plans, latency, lock waits and durable-save measurements require an approved staging environment with representative data.
- Multiple API replicas require shared presence/cache coordination and concurrency validation. The current single-process architecture is unchanged.
- Representative field data needs deployment-time opt-in and collection; diagnostics alone are not field INP/CLS certification.
- First-action timings for every deferred mode and indefinite long-session memory stability remain unmeasured.

Evidence is retained locally under `test-results/performance-remediation-2026-09-16/`, including baseline failures, withdrawn experiments, integration manifests, compiled-browser results and every startup sample. All browser mutation scenarios use disposable local synthetic accounts/stores. No production load test or gameplay mutation is used for release verification.
