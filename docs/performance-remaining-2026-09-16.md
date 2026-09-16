# Remaining performance work — 2026-09-16

This follow-up starts at main `c36416abb5b1587eb4ab8b2ac4ce8b56decccd53` in the isolated `codex/performance-remaining-20260916` worktree. The original workspace's unrelated changes are preserved. Local evidence lives in `test-results/performance-remaining/` in this worktree. This document distinguishes application fixes, test-fixture fixes and measurements that still need another environment.

## Cloudflare Web Analytics policy

A read-only public homepage request returned both an injected `https://static.cloudflareinsights.com/beacon.min.js/...` script and an enforced CSP with `script-src 'self' 'wasm-unsafe-eval'`. Those settings conflict. The server policy now allows the canonical beacon script and its versioned path prefix. It does not allow other script paths on that host, arbitrary HTTPS scripts, inline JavaScript or JavaScript eval. Existing WebAssembly compilation remains allowed.

`scripts/check-http-security-browser.mjs` exercises the compiled policy in real Chromium and WebKit. External script requests are fulfilled locally. The old policy blocks both beacon forms; the corrected policy allows both, while unrelated paths/origins, inline JS and eval remain blocked. This verifies policy enforcement, not Cloudflare availability or actual analytics delivery. The check is wired into the first responsive CI shard against the joined release artifact.

## Stronghold WebKit failures

Permanent diagnostics now retain page/scenario identity, API request actions, response/failure events, route-handler errors, teardown state and page-error stacks even when the regular suite fails. The helper is for disposable local fixtures and does not retain request/response bodies or headers. The original zero-page-error assertion remains.

The first instrumented WebKit run reproduced both access-control messages. Both came from the saved-fight recovery scenario's initial exploration document while it was being replaced. Their stacks point to the two StrictMode passive effect mounts. No corresponding API requests reached the route handler. The fixture previously mounted an unrelated exploration page solely to write local storage, then immediately navigated to the actual recovery case. A later full run (`stronghold-final-1`) found the same pattern in the Death's Gate saved-key preservation case: two errors during its immediate storage-setup reload, with no corresponding API dispatch. Both redundant setup navigations have been removed.

Saved-run preconditions are now installed before their documents mount. Existing saved-run retention, Death's Gate preservation and retry assertions remain. A separate case holds an established presence poll across navigation and requires the new document to re-enter and become usable before releasing the old response. It also checks that navigation did not start a battle. Browser cancellation events themselves are not a portable assertion: an initial attempt to require `requestfailed` timed out. The retained test asserts the actual pending-response and recovery behavior instead. The regular suite, with diagnostics, is wired into the second responsive CI shard, which installs the root tsx/esbuild tooling required by this fixture. The integration review below also connects dismissal and resource coverage to that shard.

Original failures and intermediate attempts remain in the evidence directory; they are not counted as passes.

## Resource audit corrections

The first resource run stopped because the fixture's artificial lifecycle toolbar covered the game's Players button at 390×844. Resource mode now hides that toolbar and invokes only its synthetic unmount control programmatically. The game's Players, map, movement and Leave controls continue to require normal actionable clicks. Other fixture modes retain their visible lifecycle controls.

After that correction, the audit reached an outdated assertion that expected no timers anywhere in the document. Timer identity and stack diagnostics showed the same original timer (ID 2, 90,001 ms) before and after exploration/combat cycles, originating in `LiveCapabilitiesStore.#publish`. It is the app-wide capability-expiry lease, not a retained combat timer. The audit now requires exact equality with the unmounted baseline's timer IDs, delays and call stacks, so a newly allocated timer with a matching duration cannot slip through. Intermediate resource samples are written before assertions so failures retain ownership evidence. The global capability timer and all production cleanup behavior are unchanged.

The toolbar failure, zero-timer assertion failure and dedicated timer diagnostic are preserved under `stronghold-final-resources`, `stronghold-final-resources-2` and `stronghold-resource-timer-diagnostic`.

A subsequent run intermittently retained one detached exploration tree after collection. The heap snapshot in `stronghold-resource-retainer-repeat` identifies a strong path through Chromium's native `blink::MouseEventManager` to the last map button, rather than establishing a React listener leak. The controlled follow-up in `stronghold-resource-pointer-diagnostic` retained 1,679 nodes and 1,238 listeners after two collections; one ordinary pointer move onto the returned screen restored the original 14 nodes and 309 listeners in the same document. Unmounted samples now use that same pointer position before collection. Node/listener/heap limits are unchanged. Any future exploration retention failure captures a heap snapshot automatically and still fails the original comparison.

## Startup experiment withdrawn; measurement improvements retained

A build-time Brotli experiment reduced the four largest startup JS/CSS responses by approximately 66 KB without changing their decoded content. Every variant was verified by decompression and byte comparison. It improved cold startup, but failed the adjacent-navigation comparison below. The build hook, runtime middleware, dependencies and experiment-specific tests have all been withdrawn from the final change. Existing serving behavior, application JS/CSS, images and lazy-loading boundaries remain unchanged. The evaluated source is retained locally under `test-results/performance-remaining/withdrawn-compression-source/`.

Before withdrawal, the candidate's HTTP regression test passed decoded content, MIME types, content length, conditional requests, representation validators, HEAD, ranges, client encoding weights and missing-variant fallback. Its first full browser attempt exposed a hidden-parent-directory `sendFile` failure. That was corrected and tested before the successful timing runs below. The failed attempt is retained; it is not a timing baseline.

The benchmark now records request start/response/end timing, initiator type, unfinished downloads at navigation and readiness, and partial response-body bytes. `responseStartMs` and `requestToFirstByteMs` replace the misleading single `ttfbMs` field. A failed journey retains its available network evidence and screenshot. Each attempt uses a new output directory.

Two explicitly different spacing modes are supported:

- Default: the original rapid sequence with fixed three-second observation windows. Unfinished downloads can carry into later navigations.
- `PERF_SETTLE_STATIC=1`: static downloads must settle after each observation window before the next journey. That extra interval is recorded separately and excluded from `usableMs`. This measures a primed cache and must not be presented as proof about rapid navigation.

`PERF_STATIC_DIR` selects an immutable local frontend control. Both variants were measured with the same candidate server, disposable memory KV, no external credentials, no API mocks and blocked external DNS. The unchanged frontend manifest is identical between control and candidate; only the encoded HTTP representations differ. These tests use Chromium, a 390×844 emulated phone, 4× CPU throttling, 40 ms latency and 200,000 B/s download throughput. They do not establish CDN or physical-device performance.

Five samples per journey/profile were collected in each run. Every successful run includes 40 journeys across desktop and emulated mobile, including real local Bank deposits and canonical memory-save assertions. Mobile medians in milliseconds:

| Journey | Rapid control | Rapid candidate | Settled control | Settled candidate |
| --- | ---: | ---: | ---: | ---: |
| Cold landing and login form | 4,797 | 4,305 | 4,811 | 4,268 |
| Warm landing | 665 | 1,105 | 546 | 536 |
| First Bank entry and deposit | 3,792 | 4,002 | 3,761 | 3,524 |
| Warm Bank and deposit | 1,131 | 1,190 | 1,165 | 1,224 |

Evidence directories are `startup-rapid-control`, `startup-after-2`, `startup-settled-control` and `startup-settled-candidate`, respectively. Earlier `startup-before` also completed 40 journeys (mobile cold median 4,614 ms), but used the original server build and is not the matched server control. None of these successful runs recorded page/network failures. The intermediate `startup-after` failed before completing a journey and is retained separately.

The rapid candidate's delayed navigation request starts and unfinished image requests show request queuing during the benchmark's fixed intervals. The settled comparison removes that contention and has faster cold login and first Bank entry, but does not establish that rapid navigation improved. Warm Bank also remained slower in the settled run. Therefore the candidate is rejected; cold login remains roughly 4.7–4.8 seconds in this constrained lab. Performance gains are not claimed for the final patch.

## Final validation

- Full `npm run build` passed, including typechecks, content verification, distribution verification and the existing size budgets. The size gate still reports its existing 8.08 MB JS/CSS warning; its limits were not raised.
- All 334 emitted asset JS/CSS files match the untouched baseline byte for byte. No experimental `.br` sidecars remain.
- 41 targeted security, routing, build-entry, CI-workflow and deployment contract tests passed, with no skips or cancellations.
- The compiled-policy browser check passed in Chromium and WebKit.
- Full client lint passed with zero errors and 14 warnings in existing source files.
- The later fixture edit passed its focused ESLint check with no warnings or errors.
- The final regular Stronghold run passed all 50 checks across Chromium and WebKit. Two additional independent WebKit runs passed 25 checks each. All three final runs recorded zero page errors, route-handler errors or dropped diagnostic events. These are stability repetitions, not retries of failed attempts.
- Extended Stronghold dismissal/reconnect coverage passed all 32 checks across both engines, with zero page or route-handler errors. It passed again after the final fixture change (`stronghold-dismissal-final-fixture`), preserving the visible controls used outside resource mode.
- Built Express smoke tests passed both desktop Academy onboarding scenarios (normal and delayed starter response) and the routing check in desktop/mobile profiles: 4 passed. The existing suite deliberately skips the two duplicate mobile Academy cases; those are not counted as passes. Its optional real 15-minute training completion was not enabled.
- The final benchmark diagnostic smoke completed all 8 journeys, recorded zero browser/network failures and verified all 4 local Bank saves. It ran alongside functional browser tests and is not used for timing comparisons.
- Two final resource runs (`stronghold-resources-verified-1` and `stronghold-resources-verified-2`) passed all 14 checks each, with zero page/route errors or dropped diagnostics. Each covers 12 exploration entry/exit cycles and 8 combat cycles per sector (12 and 99), plus three 2D and three 3D exterior suspension/resumption cycles. Exact timer-baseline comparisons and the existing listener/node/heap bounds passed. Hidden exterior canvases and animation frames were released. These are bounded desktop Chromium checks, not physical GPU, battery or indefinite-session certification.

At this initial local-validation checkpoint, remote CI and production deployment had not run for the branch. No failing attempt was relabeled as a pass; the diagnostic failures above remain available with the subsequent evidence explaining the corrections.

## Integration review follow-up

The follow-up review of `9d6b25f5c` found missing ongoing coverage: the corrected resource and extended dismissal audits were only being run locally. Both now run in CI, sequentially with regular Stronghold QA on responsive shard two. The compiled CSP browser gate runs on shard one. All feed the existing required responsive aggregate and final test/build gate. Contract tests require their commands, shard assignments, disposable memory configuration, root dev-tool installation, evidence logging and propagation of failures through `tee`. No audit uses `continue-on-error` or resource baseline mode.

The assignment accounts for [main CI run 35081402475](https://github.com/Timehue/ShinobiX/actions/runs/35081402475): shard one took 24.58 minutes and shard two 19.52 minutes. The three local Stronghold browser phases took approximately 99, 68 and 72 seconds. These are scheduling inputs, not a guarantee of Linux runner timing; the existing 29-minute job limit still applies. Main remained at `c36416abb5b1587eb4ab8b2ac4ce8b56decccd53` when checked during this review.

The fixture builder now declares the already locked `esbuild@0.28.1` directly, instead of depending on tsx's transitive installation layout. Fresh root and client `npm ci` installs succeeded. Resource audits use Chromium SwiftShader explicitly for repeatable software rendering on developer machines and CI; the observed renderer is retained in the JSON evidence. Both formerly unbounded settlement polling loops now have explicit 15-second failure deadlines. Existing resource bounds and application behavior are preserved.

The built Express route smoke test now checks the actual CSP response header on the static landing page, prerendered privacy page, SPA deep link, real Vite JavaScript entry, bare and prefixed APIs, and JSON/static 404s. This closes the gap between testing the policy helper and verifying that server middleware delivers it. The Google OAuth comment was corrected to match the current policy. Generated test results, scratch builds and CI evidence/artifacts are excluded from Git and Docker inputs; CI still explicitly uploads its evidence, including after failures.

Validation after these integration changes:

- Fresh locked installs and the complete release build passed. Full client lint has zero errors and the same 14 existing warnings.
- All 42 focused security, routing, build, CI and deployment contract tests passed, without skips or cancellations. The compiled CSP test passed in both Chromium and WebKit.
- Actual Express routing/CSP and Academy integration: 6 passed; the same two duplicate mobile Academy scenarios are intentionally skipped. Evidence: `integration-express.log` and `integration-express/`.
- All three Stronghold modes passed: 50 regular, 32 dismissal and 14 resource checks. Each recorded zero page errors, route errors or dropped diagnostic events. Evidence: `integration-stronghold-regular/`, `integration-stronghold-dismissal/`, and `integration-stronghold-resources/`.
- The resource run recorded the SwiftShader renderer, stopped exterior frames and WebGL contexts on entry, and passed the existing resource bounds through repeated exploration, combat and 2D/3D suspension cycles. It does not measure physical GPU performance.
- All 336 emitted JS/CSS files, including the 334 asset files plus `sw.js` and `boot-watchdog.js`, have identical SHA-256 hashes to the untouched frontend baseline. No experimental Brotli files or compiled compression helper remain. Evidence: `integration-bundle-identity.json`.

At the end of this integration review, the changes remained on the isolated local branch. Those local results did not represent a remote CI run, Docker image build, or production deployment. The first main publish and its follow-up are recorded below; database and physical-device limitations still apply.

## First main publish: CI device-profile correction

The owner authorized publishing to main. Both commits were fast-forwarded to main as `9edbbd942db34d631a2ceffb1f92971a216f5abd`. [CI run 35135602867](https://github.com/Timehue/ShinobiX/actions/runs/35135602867) passed the server suites, client quality/build, release certification, concurrency smoke, all existing responsive/combat/Warfront/live Express browser suites, the compiled CSP browser check, and regular/dismissal Stronghold audits. The separate Production Image, CodeQL and Clan Boss certification workflows also passed. The new resource audit failed, so Railway kept serving the prior healthy `c36416ab` release.

The failure was a 30-second wait for two exterior WebGL contexts, after the exploration/combat resource bounds and 2D suspension checks had passed. It produced zero page or route errors. Its console errors were the fixture's expected 503 settlement responses. The retained [job artifact](https://github.com/Timehue/ShinobiX/actions/runs/35135602867/artifacts/10464640375) includes the failure screenshot and resource samples; a local copy is in `test-results/performance-remaining/main-responsive-2-artifact/`.

The shared fixture had declared every viewport touch-capable. On a runner reporting four or fewer cores, the actual `device-tier.ts` logic therefore selected lite effects, and both 3D components correctly stayed unmounted. A controlled local reproduction (`ci-low-core-reproduction/`) reported two cores, 2 GB, a coarse pointer, no reduced-motion request and no graphics override. It reproduced the identical timeout, with zero WebGL contexts even after 30 seconds of continued 2D canvas painting. The failed reproduction is retained.

The corrected audit explicitly models mouse and touch profiles while reporting the same two-core/2-GB capability signals on each host. These signals are fixture inputs, not CPU throttling or physical-device measurements. The mouse 3D case still requires both actual WebGL contexts. A new touch case requires the automatic lite fallback to create none. Both profiles must release their canvases/frames on Stronghold entry and restore the appropriate exterior on every return. No production graphics preferences or gating logic are changed, and the original resource bounds and wait deadlines remain.

The corrected local run (`ci-device-profiles-fixed/`) passed 17 checks, including three cycles each for mouse 2D, mouse 3D and low-end touch fallback. It recorded zero page/route errors and captured input/hardware signals alongside renderer metrics for future failures. The focused CSP and Stronghold gates now run before the long responsive matrix so future failures surface earlier. The correction still requires a fresh remote CI run and exact-revision live verification after this local checkpoint.

## Environment-dependent work

The owner confirmed there is no non-production PostgreSQL environment. Neither Docker nor psql was found on PATH. Real PostgreSQL query plans, lock waits, save durability and target-load latency remain unmeasured. Existing disposable-target presence/concurrency harnesses and `docs/runbooks/launch-capacity.md` describe the staging runs needed. Local memory-backed tests do not substitute for them. The one-replica deployment limit remains appropriate until shared presence, cache invalidation, action/timer ownership and multi-replica failure tests are implemented and validated.

Physical Android testing needs a phone connected to this PC. Android platform-tools (`adb`) were not found on PATH or at the standard SDK location. Install platform-tools, enable Developer options and USB debugging on the phone, connect by USB, approve the computer on the phone, then confirm it appears in `adb devices`. Windows may require the manufacturer's USB driver. [Official Android device setup](https://developer.android.com/studio/run/device).

Device model/OS/browser, frame timing, long-session memory, background/foreground recovery, context restoration, temperature and battery measurements should be recorded separately. USB charging affects battery/thermal measurements; a connected debugging run alone is not a representative battery-life test. Optional field diagnostics remain disabled by default. Neither broader first-action coverage nor indefinite session stability is certified by these focused checks.
