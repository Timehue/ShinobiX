# Sunscar integration and mobile UX review

## Changes from the review

- **Race visibility:** an 844 × 390 phone could start a race with its HUD above the viewport. The existing Rally course and controls now share a viewport-sized portal, using the app's existing body scroll lock. The HUD and controls stay within the viewport after rotation; leaving releases the lock and returns focus to the race desk.
- **Touch targets:** narrow steering and map-zoom buttons now measure at least 44 × 44 pixels. The journal summary also has a 44-pixel target. Map tools wrap on narrow screens.
- **Caravan navigation:** inspecting a map stop brings its travel action into view and moves keyboard focus there. The “Your caravan” control centers the actual branch occupied by the convoy.
- **Race recovery:** the resumed championship's selected companion appears in the desk. Finishing moves focus to the saved results. Escape pauses; Space works on the paused menu's buttons. The start panel stays above the stamina display.
- **Battle history:** the festival passes App's existing `recordBattle` callback through Caravan to `MissionArenaFight`. The review also found that a later authoritative outcome save could overwrite the new local entry. Caravan now commits the entry with its expedition outcome, including recovery after closing the result tab. It shares the existing formatter, ten-battle cap and session ID with the HUD, so retries do not duplicate entries. Escort outcomes appear in Profile → Battles.
- **Large-save reloads:** WebKit reported an access-control error when a closing page submitted a save larger than the browser's 64 KiB keepalive budget. A minimal fetch probe reproduced it only above that budget. The existing unload helper now counts UTF-8 bytes and keeps its full durable recovery copy when the body is too large. Normal versioned save recovery handles it after reload; the save is never truncated. Smaller unload saves keep their current behavior.

The combat HUD, shared combat engine, formulas and rewards were not redesigned. Caravan continues to use `MissionArenaFight`, the solo-PvE transport and the normal authoritative outcome settlement. Festival routes, server-owned save domains, real pet ownership, daily entries and reward receipts were checked.

## Validation

- Festival, deterministic simulation, API integration and registered-route tests: **49 passed**.
- Mobile feature audit: **70 checked states** across Chromium and WebKit at 320 × 568, 390 × 844, 844 × 390 and 768 × 1024. No page overflow, sub-44-pixel tested controls, broken images or runtime errors. Contract accessibility scans returned no WCAG A/AA violations. Keyboard resume and pause, touch input, returning and resuming were exercised.
- Complete Grand Prix: all three races completed using normal input and server checkpoints. Lost acknowledgement, reload, championship receipt and payout replay checks passed. The existing mobile combat view opened from Caravan.
- Final Caravan outcomes: Scorpion Queen victory and defeat passed through the real combat UI, return and reload. Persistence/replay and existing history-format tests: **20 passed**.
- Final full repository suite: **10,436 passed**, zero failures, cancellations or skips. The unload-size fix also passed a focused set of **60 save recovery, conflict and sequencing tests**, including oversized ASCII, multibyte text and unresolved request bodies.
- Full strict combat layout suite: **20 passed, 10 configured skips**, zero failures. Solo-PvE, PvP and Tower variants were checked across Chromium DPR variants, Firefox and WebKit.
- Final full-app walkthrough: **Chromium and WebKit passed** against real Express APIs and disposable player accounts. Covered race entry/rotation, pause/save/leave/reload with the selected pet preserved, Caravan departure without a companion, map choice and recovery, the existing combat HUD, normal flee/result recovery and saved Profile battle history. No runtime errors or save-conflict prompts; the oversized-save reload warning is resolved. WebKit rotation image capture retains the separate runtime limitation below.
- Final server/client TypeScript builds, full client lint, legal-page prerendering, distribution verification and size budgets passed. Product JS/CSS: 8,403,282 B raw / 2,359,781 B gzip; initial graph: 1,434,669 B raw / 379,785 B gzip. Lint has zero errors and the same 14 existing warnings.
- Full seven-project smoke suite: **528 passed, 456 configured skips, one build-manifest mismatch**. The immutable preview requested `c-CE4N5AnX.js`, while the mobile assertion read `c-BKeqH03N.js` from the newer local manifest. The trace confirms the original module loaded. **Both tests in that spec passed unchanged against a fresh final-build preview**, clearing the failure. No unresolved smoke failures remain. The broad run used the completed mobile-UI build; the final shared-history extraction and unload helper were additionally covered by the final full unit run, build and real-game mobile walkthrough.

## Sprite facing follow-up

The Scorpion Queen body art is authored facing right. The shared actor renderer now recognizes that direction for both the source filename and the hashed production asset. It continues to use the existing nearest-opponent direction and sprite-only CSS mirror. Explicit custom facing overrides remain supported. The other Caravan enemy art (raider, captain, wyrm, rogue escort and shrine sentinel) was visually reviewed and keeps its left-facing default. No combat HUD, engine, targeting or actor-anchor geometry was changed.

The isolated Sunscar review entry now calls the same `useViewportContract` hook as App. Its missing viewport attribute had prevented the normal landscape combat rules from applying in that preview. The local review files were refreshed without resetting the existing review profile.

- Sprite component, facing and geometry regression tests: **13 passed**.
- Final browser sweep: **72 passed**, zero runtime errors. All six enemies were checked with the player on either side in Chromium and WebKit at 1366 × 768, 390 × 844 and 844 × 390. Assertions cover native direction, sprite-only mirroring, actor placement, on-screen visibility and horizontal overflow. Queen captures were visually checked on desktop and mobile.
- Final TypeScript, full frontend lint and production build checks passed; lint retains the same 14 warnings and zero errors.
- Final sprite build, full seven-project smoke suite: **529 passed, 456 configured skips**, zero failures. Full strict combat-layout suite: **20 passed, 10 configured skips**, zero failures. Both suites used the same completed production artifact throughout the run. Logs: `.tmp/sunscar-facing-smoke.log` and `.tmp/sunscar-facing-combat.log`.
- Facing evidence: `.tmp/sunscar-sprite-facing-qa/report.json`, the adjacent PNG captures, `.tmp/sunscar-facing-unit.log`, `.tmp/sunscar-facing-browser.log` and `.tmp/sunscar-facing-dist-checks.log`. The local sweep is `shinobij.client/.tmp/sunscar-sprite-facing-qa.mjs` against the disposable review server.

## Evidence and limits

The reproducible mobile audit is `shinobij.client/scripts/sunscar-mobile-ux-qa.mjs`. It accepts `SUNSCAR_QA_URL` for an isolated festival QA server. Captures and machine-readable findings are in `.tmp/sunscar-mobile-ux-qa`; the pre-fix measurements remain in `.tmp/sunscar-mobile-review`.

Additional evidence: `.tmp/sunscar-mobile-review-integration.log`, `.tmp/sunscar-mobile-full-flow.log`, `.tmp/sunscar-mobile-app-final.log`, `.tmp/sunscar-mobile-combat-flow.log`, `.tmp/sunscar-mobile-final-full-tests.log`, `.tmp/sunscar-mobile-save-recovery-tests.log`, `.tmp/sunscar-mobile-final-lint.log`, `.tmp/sunscar-mobile-final-dist-checks.log`, `.tmp/sunscar-mobile-smoke.log`, `.tmp/sunscar-mobile-final-smoke-retry.log` and `.tmp/sunscar-mobile-combat.log`.

All writes used disposable localhost memory saves. The existing review profile on port 5199 was left alone. Browser emulation verifies layout and interactions; physical iOS/Android device performance remains unverified. No deployment or commit was performed.

### WebKit rotation capture limitation

On this Windows WebKit runtime, rotating an already-running WebGL canvas from portrait to landscape leaves the page screenshot blank in the canvas area. The actual canvas buffer still contains the correctly resized course, and race state and controls continue working. A minimal page with only a WebGL clear-color loop reproduces the same missing canvas after resizing; it contains no game code, React, Three, portal or festival CSS. CSS layer experiments did not resolve it. The standalone audit renders correctly when launched at the landscape size. This is **not a physical-iPhone rotation certification**; verify rotation on target iOS hardware before release. No renderer workaround or race reset was added for the test-runtime issue.

Reproduction: `shinobij.client/.tmp/webkit-canvas-rotation.mjs`. Before/after page captures and the intact canvas buffer are under `.tmp/sunscar-app-review/webkit-minimal-gl-*`.
