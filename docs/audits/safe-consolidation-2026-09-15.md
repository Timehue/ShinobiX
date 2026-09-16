# Safe consolidation and polish — 2026-09-15

## Scope and ownership

Implemented on `codex/safe-consolidation-polish`, starting from `e3c09fe109` and the existing working tree. The checkout already contained extensive unrelated uncommitted changes; this report describes only this task's incremental changes. The initial pass did not push, merge, deploy, or use live player accounts. The user subsequently authorized checking current main and pushing this task to live main; the release integration is recorded below.

## Main release integration

The release candidate starts from `origin/main` at `897043d04f0540c160668fcab6b326a13b75bb20`, 270 commits ahead of the original checkout. Before integration, that commit had successful GitHub CI and Railway deployment status; the public production `/health` endpoint returned HTTP 200 with the same commit. This is a read-only health check, not a live-player test.

This task's 28 source/test files and this report were applied in a separate checkout. The required handoff exporter also updates five CSS source-line references in `docs/generated/design-tokens.json`; no token values change, bringing the release scope to 30 files. The original checkout's 714 modified/untracked paths were preserved. The integration retains current main's Inventory Exchange eligibility checks, weapon-detail projections, Training bloodline information, newer App orchestration, and civic hover/reduced-motion fixes. The App budget decreases from current main's 6,521 to 6,520, preserving the existing buffer. No dependency lockfile, release control, gameplay value, or server authority rule is changed by the candidate.

Release validation on this integrated candidate (Node 22.23.2, fresh root/client `npm ci`):

- Root `npm run build`: passed server/client compilation, generated-content checks, dist verification, and size budgets. Product JS/CSS: 8,456,917 B raw / 2,377,506 B gzip. Initial JS/CSS graph: 1,434,396 B raw / 381,286 B gzip. These are current-main integration measurements; the historical before/after comparison below used the original checkout.
- Full root `npm test --ignore-scripts`: **10,922 passed, 7 configured skips, 0 failures** (10,929 tests, 404 seconds). Only the redundant pretest dependency installation was skipped; dependencies were freshly installed before running the full test runner.
- Full client `npm run lint`: **0 errors, 14 warnings**.
- `npm run check:tooling-handoffs`: passed after regenerating five CSS source-line references. The initial stale-output failure and regenerated diff are retained in local evidence.
- `check:deployment`, `check:rollback-readiness`, `test:mission-eligibility`, `test:release-assets`, and `test:pet-breeding-odds`: all passed.
- Full strict combat layout: **20 passed, 10 configured skips, 0 failures** (21.4 minutes), across all configured Chromium scaling groups, Firefox, and WebKit. Used `COMBAT_LAYOUT_PORT=24521`, `COMBAT_LAYOUT_CAPTURE_PHASE=after`, `COMBAT_LAYOUT_STRICT=1`, and the standard configuration with no viewport override.
- Full browser smoke: **762 passed, 587 configured skips, 0 failures** (29.0 minutes, 1,349 configured cases). Ran `PLAYWRIGHT_PORT=24520 npm run test:e2e -- --workers=2 --output=../../live-main-smoke-runner` from the client, using the immutable preview snapshot. Covered Chromium desktop, compact phone, mobile, and tablet; Firefox desktop; WebKit desktop and mobile. No retries or selective reruns were needed.
- Final staged whitespace/scope review passed. The source build stayed unchanged throughout browser validation. Two extra blank lines at the ends of authored browser specs were removed during staged whitespace review; no test logic or assertions changed.

Release logs, browser traces, and layout captures are retained locally under the original checkout's `test-results/safe-consolidation/live-main-*` paths. They are ignored QA artifacts, not release source. The public pre-release health check does not certify authenticated live-player journeys or deep storage health.

Earlier results below describe the original checkout and remain historical evidence.

### Player-visible changes

- Bank amount, recipient, and wire-amount validation now appears beside the relevant control. Errors have accessible descriptions, focus the field requiring correction, and preserve entered values. Review & send can explain missing inputs.
- Accepted deposits and withdrawals use the existing GameToast receipt. Interest collection also uses a nonblocking receipt. Consequential wire confirmations remain in place.
- Confirmed rejections retain their explanation. Interrupted, server-error, and malformed acknowledgements warn that the action is unconfirmed and direct the player to refresh before retrying. No automatic retry was added.
- Bank retains its artwork, layout, colors, navigation, and ordinary control styling. The integration recheck also locks pending inputs, explains unaccepted balance responses, shows zero-payout ineligibility upfront, and refreshes interest availability using the existing shared display clock.
- Inventory sales now show pending progress, prevent repeated submissions, retain actionable failure feedback, and announce accepted server receipts. Closing details remains available. Training and Jutsu Training distinguish uncertain outcomes from confirmed rejections using the existing feedback components.

### Internal changes

| Files | Responsibility |
| --- | --- |
| `shinobij.client/src/screens/Bank.tsx` | Local validation and feedback; original pending refs, request payloads, request-ID generation, and response adoption remain. |
| `shinobij.client/src/lib/player-trade.ts` and its test | Clearer outcome messages; the exact existing nonce retention/release policy and result shape remain. |
| `shared/bank-interest.ts`, its test, `api/_bank-interest.ts`, related bank/parity tests | One public owner for the 24-hour window, 10M principal cap, and rounded projection. Server input normalization, rate calculation, clock, and eligibility remain authoritative. Old API constant exports remain available. |
| `shared/hunt-material-sale.ts`, `api/inventory/_sale.ts`, its test, `Inventory.tsx` | One unchanged 14-item sale table. Caller-specific item eligibility, cost handling, ownership checks, and settlement remain distinct. |
| `shinobij.client/src/styles/index/39-civic-facilities.css` | Bank rail/wire share identical grid, border, and background declarations; three equivalent spacing values use existing tokens. Global imports and token values are untouched. |
| `shinobij.client/src/lib/utils.ts`, its test, `App.tsx`, `App.size.test.ts` | The pure ID merge has a tested utility owner. App keeps a same-signature wrapper and the line-budget ratchet is reduced by the exact net extraction. No effects, session state, or lazy screen ownership moved. |
| `shinobij.client/e2e/bank-feedback.spec.ts` and sale/training feedback specs | Rendered regression journeys using the existing isolated UI-audit runtime. |
| `shinobij.client/src/lib/shop-settlement.ts` and its test | Honest timeout/server/network/malformed-response messages; original request identities and retention/release policy remain. |
| `shinobij.client/src/screens/Training.tsx`, `lib/training-feedback.ts`, `lib/jutsu-ryo-api.ts`, and related tests | Reused friendly failure mapping and neutral notice headings; original timing, costs, queue state, retries, and acceptance rules remain. |

## Integration and UX recheck

The requested second review found additional friction in rendered Bank and Inventory journeys and in Training feedback. Local baseline probes reproduced pending Bank drafts being erased, an unexplained stale balance response, a zero-payout “Ready now” claim, and an interest button remaining disabled after its deadline until another interaction. Inventory probes reproduced duplicate pending requests, missing progress/receipt feedback, and a misleading claim that nothing changed after a lost reply.

Corrections preserve the existing transaction identity, retry, save adoption, and game-rule decisions. The new pending Inventory guard prevents additional clicks while a sale is in flight; it does not replace the existing server idempotency policy. Important failure feedback is scrolled into view in its current context, including after item details close or a different item is opened on a 320px phone. A late result does not close a different item’s details. This uses one local notice ref and a cancellable animation frame; focus and shared modal behavior are unchanged.

### Recheck verification

- Final root `npm run build`: **passed**, including server/client compilation, generated-content checks, dist verification, and all existing size budgets.
- Full client `npm run lint`: **3 existing errors and 15 warnings**. Final output is byte-identical to the previous run; no new diagnostic was introduced.
- Full root `npm test --ignore-scripts`: **10,503 passed, 2 failed, 0 cancelled** out of 10,505. The failures are the same unchanged Stronghold busy-exit contract and world-map delegation source assertion recorded in the initial pass. All settlement/feedback logic changes were included. The final local Inventory scroll effect was added after this run started; its focused checks passed **21/21**, with final rendered viewport checks recorded below.
- Training/Jutsu focused feedback, API, authority, and queue checks: **26 passed**. Shared-rule review again passed **47/47**, with all 2,712 recorded old/new outcomes unchanged.

- Training/Jutsu rendered feedback: **40/40 passed**, across Chromium 1366×768 and 360×640 and WebKit 1366×768 and 390×844. This run preceded the final local Jutsu notice-scrolling correction. Covered confirmed rejection, network/server/malformed outcomes, original retry body/identity, retained selections/sessions, stale version rejection, notice dismissal, and focused keyboard Escape. An earlier test compared CSS-transformed visible text with untransformed DOM text; the final assertion compares visible text consistently. Four early WebKit failures did not await notice focus before dispatching Escape; after the final test waited for the existing focused OK button, all required Escape dismissals passed. No application dialog changes were needed.

- Final Bank/Inventory matrix: **60 unique cases verified** (44 Bank, 16 Inventory), across Chromium **1366×768, 390×844, 320×740** and WebKit **390×844**. The selected initial runs passed **58/60**; both WebKit focus-return cases then passed **2/2** using actual Tab → focused opener → Enter → Escape. The original tests incorrectly assumed a WebKit mouse click focused the opener. All viewport, outcome, and focus-return requirements were retained.
- The narrow Inventory cases require the full Dismiss button in the viewport and a successful click. Both a closed details panel and an open different-item dialog retain visible, contextual warnings. Codex visually inspected the final 320px other-item notice and 390px page notice. Across 62 runtime records: **zero uncaught page errors or screen-boundary errors**; additional messages were WebKit unused-preload warnings, the existing blocked-service-worker warning, and intentionally simulated request failures.
- An additional read-only Jutsu placement probe found the notice and Dismiss button above the viewport at **320×740** (notice y = −187.61px, intersection ratio 0), while both were visible at 390px in Chromium and WebKit. A local, cancellable animation frame now scrolls new error notices into view without moving focus. No shared style, dialog, or training rule changed. The focused training/authority tests again passed **26/26**.

- Final Jutsu placement probe: **3/3 passed** on the final build in Chromium **320×740 and 390×844** and WebKit **390×844**. At 320px, the notice moved from y = −187.61px to **68.39px**, below the fixed HUD; Dismiss is **44×44px** at y = **80.39px**. Notice and button intersection ratios are 1 in all three cases. Hit-tests confirmed the actual button at its center, followed by successful direct coordinate clicks; no locator auto-scroll was used. Codex visually inspected all three screenshots. Existing mobile scroll padding supplies the HUD clearance; no shared CSS changed.

- Final Training/Jutsu matrix on the final Jutsu build (`recheck-build-jutsu-final.log`): **80/80 passed** (6.4 minutes): Chromium **1366×768, 360×640, 390×844, 768×1024**, Firefox **1366×768**, WebKit **1366×768 and 390×844**, plus Chromium **320×740**. Each project ran all ten feedback/retention cases. Notice and Dismiss visibility is asserted before clicks; keyboard Escape still requires the existing OK focus first. This final matrix includes the local Jutsu scrolling correction added after the earlier full-unit and full-smoke builds.

- Full smoke `npm run test:e2e -- --workers=2 --output=test-results/safe-consolidation/recheck-smoke-run`: **622 passed, 531 configured skips, 7 failed** across all 1,160 cases (28.9 minutes). It ran against immutable snapshot 24506, captured before the final Jutsu scrolling correction. The later viewport assertions were loaded by subsequent workers, so five compact-phone cases reproduced that known pre-correction issue. A sixth case read the newly rebuilt live manifest while requesting the older snapshot's asset names; its trace shows the correct snapshot asset returned HTTP 200. The seventh was an untouched mobile world-map post-drag region-selection assertion. Original failures remain preserved separately.

- Exact failed-ID rerun on the final build and matching immutable snapshot 24511: **7/7 passed** with one worker (1.0 minute). This includes the five Jutsu visibility regressions, the manifest-dependent loading check, and the unchanged world-map rotation/drag case. The isolated world-map pass does not establish the cause of the original tap failure. No test was weakened to obtain this result. The complete smoke run was not uniformly green; its original counts and traces remain separate from the successful rerun.

- Final strict combat layout gate: **20 passed, 10 configured skips, 0 failures** (19.7 minutes) on the final build. Standard Chromium passed all five cases; Chromium DPR 1.25, 1.5, and 2, Firefox, and WebKit passed their three applicable cases each. The full configured viewport/zoom sweep ran with strict assertions and no viewport override. No rerun or weakened check was needed for this definitive run. Earlier interrupted recheck attempts are retained as partial runs and are not counted as completed gates.

### Recheck commands and artifacts

All use the pinned Node 22 runtime and existing dependencies. Full root build/lint evidence is `recheck-build-jutsu-final.log` and `recheck-lint-jutsu-final.log` under root `test-results/safe-consolidation/`; final lint matches the original SHA-256 exactly.

The final Training matrix ran from `shinobij.client` with `PLAYWRIGHT_PORT=24504`:

```text
npm run test:e2e -- --config=test-results/safe-consolidation/playwright.training-visible.config.ts
```

Its log is root `test-results/safe-consolidation/recheck-training-visible.log`. The eight-project scratch configuration adds the 320px case to the seven unchanged default projects.

Bank/Inventory used `playwright.integration-24508.config.ts` to create an immutable preview and `playwright.integration-reuse-24508.config.ts` for the selected project/grep runs. `PLAYWRIGHT_PORT=24508` and `BANK_AUDIT_MATRIX=1` were set; distinct `BANK_AUDIT_PHASE` directories retain each viewport's captures. Successful logs: `integration-24508-chromium.log` (30), `integration-24508-narrow.log` (14), `integration-24508-narrow-confirmed.log` (1), `integration-24508-webkit-targeted.log` (1), and `integration-24508-webkit-keyboard.log` (2). The preserved `integration-24508-webkit.log` contains 12 passes and the two pointer-focus fixture failures.

The final raw Jutsu placement probe uses `playwright.jutsu-placement-final.config.ts` and `jutsu-placement-final-probe.spec.ts`; evidence is `jutsu-placement-final.log` and `jutsu-placement-final/` under the client evidence directory. It checks recorded coordinate clicks without locator scrolling.

The full smoke run used `PLAYWRIGHT_PORT=24506`; the exact-failure rerun used `24511` and the final build:

```text
npm run test:e2e -- --workers=2 --output=test-results/safe-consolidation/recheck-smoke-run
npm run test:e2e -- --last-failed --last-failed-file ../test-results/safe-consolidation/recheck-smoke-rerun-last-failed.json --workers=1 --output=test-results/safe-consolidation/recheck-smoke-rerun
```

Logs are root `test-results/safe-consolidation/recheck-smoke.log` and `recheck-smoke-rerun.log`; the original seven IDs remain in the full run's `.last-run.json`. `recheck-smoke-deferred-loading-attribution.json` records the manifest mismatch and successful snapshot-asset response.

The definitive combat command ran from `shinobij.client` with `COMBAT_LAYOUT_PORT=24505`, `COMBAT_LAYOUT_CAPTURE_PHASE=after`, `COMBAT_LAYOUT_STRICT=1`, the standard configuration, and one worker:

```text
npm run test:e2e:combat-layout -- --output=../test-results/safe-consolidation/recheck-combat-layout-complete-runner
```

`COMBAT_LAYOUT_ARTIFACT_ROOT` pointed to root `test-results/safe-consolidation/recheck-combat-layout-complete-captures`. The complete log is `recheck-combat-layout-complete.log`. The server used the existing local QA configuration and in-memory storage; no live player account was used.

## Historical build comparison (original checkout)

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial HTML JS/CSS graph, raw | 1,434,890 B | 1,435,025 B | +135 B |
| Initial HTML JS/CSS graph, gzip | 379,953 B | 380,021 B | +68 B |
| Entry own JS, gzip | 152,419 B | 152,401 B | −18 B |
| Entry own CSS, gzip | 109,601 B | 109,614 B | +13 B |
| Bank own JS, gzip | 3,340 B | 3,738 B | +398 B |
| Inventory own JS, gzip | 9,182 B | 9,692 B | +510 B |
| Training own JS, gzip | 9,648 B | 9,807 B | +159 B |
| All emitted JS/CSS, raw | 8,432,165 B | 8,436,499 B | +4,334 B |
| All emitted JS/CSS, gzip | 2,367,361 B | 2,368,573 B | +1,212 B |

The graph/all-emitted totals use the repository size checker's gzip level 9; individual chunk comparisons use gzip level 6 consistently before/after. The complete initial HTML graph still contains nine files; the manifest-only comparison omits the separate boot script and therefore lists eight. Inventory and Training own CSS hashes are identical. No new dependency was installed, no budget was raised, and no warning was suppressed. The existing product-size warning remains (8.05 MB on the final build). Browser/test elapsed times under concurrent load are not treated as responsiveness measurements.

## Protected scope and deferred work

The task's incremental diff changes no gameplay values, save schema/meaning, combat or pet-battle UI, mode content, navigation structure, release controls, server-authority checks, transaction identities, or settlement guarantees. This is a bounded consolidation, not a complete architectural cleanup. Pre-existing working changes in those systems remain outside this pass.

Training and Jutsu Training retain their existing accepted-operation notices, pending guards, and availability explanations. The recheck corrected uncertainty wording and silent unaccepted-response paths; it did not change training mechanics. NextGoalPin's custom colors do not equal the semantic tokens, so replacing them would change its appearance. The broader Training/Jutsu cascade has meaningful overrides and was left intact. Bank upgrade-rate definitions remain with existing village-upgrade/server owners and their parity checks. Larger App lifecycle/save/session extractions and inventory eligibility unification were deliberately excluded.

Removed implementations are limited to the duplicated bank cap/projection, duplicated hunt table, superseded Bank CSS declarations, and the moved pure merge body. Characterization tests, unchanged API exports, browser comparison, and source review provide the safety evidence; no uncertain assets, migrations, recovery paths, or dynamically registered code were deleted.

## Evidence

Generated local evidence is kept in `test-results/safe-consolidation/` and `shinobij.client/test-results/safe-consolidation/`. `task-delta.patch` isolates this task from the previously dirty working tree. The immutable baseline preview contained 5,588 files and 487,186,491 bytes (manifest SHA-256 `2119e8b712f444e3bb56fbf0c59cb934394b644390ea5f10b22159fe792088aa`). After the initial verification, the task-created preview snapshots for ports 24491, 24492, 24495, 24496, and 24497 were removed and their servers confirmed stopped. After the recheck, eight task-created preview copies for ports 24501, 24502, 24504, 24506, 24507, 24508, 24510, and 24511 were removed after resolved-path/reparse-point checks and confirmation that every task server had stopped. Their manifests and cleanup record are preserved in `recheck-preview-cleanup.json`; the final production manifest is `47b6d5e8e4a0805e53ab5d02d05d2f3f129defe5015c66d0f2ccce6a5cfd0c46`. Other pre-existing snapshots were preserved. Logs, screenshots, comparison data, original source copies, and local QA configuration/scripts remain as review evidence; they are not application code.

### Visual comparison

In the initial consolidation snapshots (ports 24491/24492), the Bank rail, wire preview, and interest callout have byte-identical recorded computed styles **and bounds** before/after at 1366px and 390px. Later recheck conclusions use the separately recorded functional, viewport, and visual evidence. This includes grid layout, borders, backgrounds, spacing, padding, and radii. Desktop and mobile screenshots were also visually inspected: the themed panels remain intact and the new inline errors are legible next to the relevant inputs. Mobile full-page captures include the existing fixed navigation at its viewport position; they are not a single on-screen viewport.

| Evidence | Before | After |
| --- | --- | --- |
| Desktop overview | [Before](../../shinobij.client/test-results/safe-consolidation/before/bank-overview-1366.png) | [After](../../shinobij.client/test-results/safe-consolidation/after/bank-overview-1366.png) |
| Mobile amount validation | [Modal](../../shinobij.client/test-results/safe-consolidation/before/bank-validation-390.png) | [Inline](../../shinobij.client/test-results/safe-consolidation/after/bank-validation-390.png) |
| Mobile wire amount correction | — | [Inline error with retained values](../../shinobij.client/test-results/safe-consolidation/after/bank-wire-validation-390.png) |
| Final narrow Bank validation | — | [320px viewport](../../shinobij.client/test-results/safe-consolidation/integration-24508-narrow/bank-wire-validation-320-viewport.png) |
| Final narrow Inventory late warning | — | [Different item open](../../shinobij.client/test-results/safe-consolidation/integration-24508-narrow/inventory-late-error-other-selection-320.png) |
| Narrow Jutsu warning | [Offscreen](../../shinobij.client/test-results/safe-consolidation/jutsu-placement-24508/jutsu-notice-chromium-320.png) | [Visible below HUD](../../shinobij.client/test-results/safe-consolidation/jutsu-placement-final/jutsu-notice-chromium-320.png) |

Automated screenshot and computed-style comparisons supplement Codex visual inspection of the Bank desktop overview and desktop/mobile validation captures. Browser reload checks use an intercepted mock server that returns its updated character; they do not establish real backend or production persistence. No live player data was used.

### Local cleanup incident

While stopping a partial QA run, an ancestry-based process cleanup also matched and stopped `MoNotificationUx.exe` (PID 19924), whose observed command specified `Reboot_Engaged` and `/FormFactor Passive`. This closed a Windows Update notification UI process. No update service was targeted; broader Windows Update state was not verified. Further process cleanup is restricted to verified task commands and creation times.

## Initial consolidation verification

All verification commands after the baseline use the existing Node 22.23.2 runtime and installed dependencies. The initial build used the host's Node 24.15.0; the production output sizes below are artifact measurements, not build-speed comparisons.

- Baseline and final root `npm run build`: passed server/client compilation, generated-content checks, dist verification, and unchanged size budgets.
- Bank-focused `node --import tsx --test` for player-trade, permanent-action-safety, and GameToast: **22 passed**.
- Shared-rule focused tests: **47 passed** (44 before the additions). Independent before/after records contain **2,520 bank and 192 inventory-sale outcomes**, byte-identical including returned fields.
- Utility, App-size, no-App-value-imports, and CSS-manifest checks: **16 passed**. Focused ESLint passed for the extracted utility/App, Inventory, and authored browser test.
- Full client `npm run lint`: **3 errors and 15 warnings**, byte-identical before and after. The three errors are existing explicit-any annotations in `scripts/fixtures/stronghold-qa.tsx`; those files were not changed.
- Baseline browser run: **8 passed**, covering Bank validation/accepted move/rejection/interrupted response and Inventory, Training, and Jutsu Training at 1366×768 and 390×844. No uncaught page errors. One initial test-only selector mismatch was corrected and the cases rerun against the same immutable baseline.

- Full root `npm test --ignore-scripts`: **10,479 passed, 2 failed, 0 cancelled**. This runs the complete repository test runner and skips only the redundant dependency-reinstall pretest hook. Failures: `server-settlement-gate.test.ts` world-map delegation assertion (also observed before editing), and `modal-escape-hatch.contract.test.ts` naming the existing `StrongholdDialog.tsx` busy-disabled exit. That Stronghold file is outside this task's changes. Neither check was weakened or removed.
- Final focused Bank browser journeys: **10 passed** across desktop 1366×768 and mobile 390×844. Verified field association/focus, correction without data loss, accepted deposit/withdraw receipts, deferred-response duplicate protection, actual Village→Bank navigation, reload from the mock server's saved character, stale-version rejection, 400 rejection versus network/503/malformed uncertainty, interest receipt, and wire confirmation/cancel/focus/nonce behavior. Two test-fixture assumptions about navigation and an absent toast container were corrected; the complete focused set was rerun successfully against the unchanged application build.
- Expanded Bank matrix: **35 passed** across Chromium widths **320, 360, 768, 979, 980** and WebKit widths **390, 1366**. These run the same five outcome journeys, including keyboard/focus and horizontal-control containment checks. Combined with the primary run: **45 passing Bank cases**, no uncaught page errors. Expected console messages are the existing blocked-service-worker warning and the deliberately simulated failed responses.
- Neighboring-screen browser checks: **6 passed** for Inventory, Training, and Jutsu Training at desktop and phone sizes, with loaded headings and fonts awaited. All three mobile screenshots are pixel-identical. Desktop differences are confined to the live sidebar countdown; the selected screen content is unchanged. Together with Bank, this is **51 passing focused after-change browser checks**.
- Full smoke `npm run test:e2e -- --workers=4 --output=test-results/safe-consolidation/e2e-smoke-final-run`: **533 passed, 481 configured skips, 6 failed** across all seven projects (25.2 minutes). Both standard Bank viewport sets passed. An exact-ID, one-worker rerun passed **all 6/6** on the same frozen application build and unchanged tests (1.2 minutes). Four initial failures have trace-confirmed `net::ERR_NETWORK_CHANGED` during local asset loads (First Contract optional flow and recap, Bloodline Codex artwork, and world-position recovery). The other two occurred in the untouched helper’s immediate save-acknowledgement assertion (sector PvP and Academy Jutsu). None reproduced in isolation. The complete run was not uniformly green, and its failures are retained separately from the successful rerun. The earlier two-worker partial run was intentionally stopped after test-fixture corrections and is not counted as a complete run.
- Strict combat layout gate: **19 passed, 10 intentional skips, 1 failed** (39.4 minutes). Standard Chromium passed all five cases; Chromium DPR 1.25/1.5/2 and Firefox passed their three active cases each. WebKit passed Solo-PvE and Tower, then its PvP case passed an **unchanged isolated rerun, 1/1** (1.2 minutes), including all **22 viewports and 6 zoom measurements**. The first PvP failure at 667×375 exhausted the 10-second stable-sampling budget before a geometry assertion; three identical agreements were recorded, and the rerun reached the required fourth. This supports an intermittent timing/load explanation, not a demonstrated geometry regression. Original artifacts and rerun artifacts remain separate. These are layout regression checks, not exhaustive gameplay certification.

### Commands and browser setup

Root commands: `npm run build`; `npm test --ignore-scripts`; `node --import tsx --test shinobij.client/src/lib/player-trade.test.ts shinobij.client/src/lib/permanent-action-safety.test.ts shinobij.client/src/components/GameToast.test.ts`. Full ESLint ran as `npm run lint` from `shinobij.client`.

The following commands ran from `shinobij.client` with Node 22 and one worker. Configuration files are local QA evidence under `test-results/safe-consolidation/`.

| Check | Environment | Command |
| --- | --- | --- |
| Bank primary | `PLAYWRIGHT_PORT=24492`, `BANK_AUDIT_PHASE=after` | `node node_modules/@playwright/test/cli.js test -c test-results/safe-consolidation/playwright.after.config.ts` |
| Bank extra matrix | `PLAYWRIGHT_PORT=24493`, `BANK_AUDIT_PHASE=after-matrix`, `BANK_AUDIT_MATRIX=1` | `node node_modules/@playwright/test/cli.js test -c test-results/safe-consolidation/playwright.matrix.config.ts` |
| Loaded neighboring screens | `PLAYWRIGHT_PORT=24499`, `BANK_AUDIT_PHASE=after` | `node node_modules/@playwright/test/cli.js test -c test-results/safe-consolidation/playwright.neighbors.config.ts` |
| Loaded baseline neighboring screens | `PLAYWRIGHT_PORT=24491`, `BANK_AUDIT_PHASE=before` | `node node_modules/@playwright/test/cli.js test -c test-results/safe-consolidation/playwright.baseline.config.ts --grep renders` |

The utility/architecture checks ran from the repository root:

```text
node --import tsx --test shinobij.client/src/lib/utils.test.ts shinobij.client/src/App.size.test.ts shinobij.client/src/lib/no-app-value-imports.test.ts shinobij.client/src/index-css-manifest.test.ts
```

Shared-rule checks ran from the repository root:

```text
node --import tsx --test shared/bank-interest.test.ts api/_bank-interest.test.ts api/inventory/_sale.test.ts api/shop/_arbitrage-invariant.test.ts api/_cross-build-parity.test.ts
```

The full smoke and exact-failure rerun ran from `shinobij.client`, with `PLAYWRIGHT_PORT=24496` and `24497` respectively:

```text
npm run test:e2e -- --workers=4 --output=test-results/safe-consolidation/e2e-smoke-final-run
npm run test:e2e -- --last-failed --last-failed-file "<repo>/test-results/safe-consolidation/e2e-smoke-rerun-last-failed.json" --workers=1 --output=test-results/safe-consolidation/e2e-smoke-rerun
```

The rerun selection file was copied from the preserved full run’s `.last-run.json` before the six-case rerun. Playwright updates the selection file when the rerun finishes; the original six IDs remain in `shinobij.client/test-results/safe-consolidation/e2e-smoke-final-run/.last-run.json`.

The combat gate used the standard `playwright.combat-layout.config.ts`, Node 22, one worker, all configured projects, `COMBAT_LAYOUT_CAPTURE_PHASE=after`, `COMBAT_LAYOUT_STRICT=1`, and `COMBAT_LAYOUT_PORT=24494`, with no viewport override:

```text
npm run test:e2e:combat-layout
npm run test:e2e:combat-layout -- --project=webkit-layout --grep 'PvP combat layout viewport matrix$' --output=../test-results/safe-consolidation/combat-layout-rerun
```

`COMBAT_LAYOUT_ARTIFACT_ROOT` pointed to root `test-results/safe-consolidation/combat-layout-captures` for the full run and `combat-layout-rerun-captures` for the rerun. The local server used the existing isolated QA configuration and memory-backed storage.

Focused ESLint used `node node_modules/eslint/bin/eslint.js src/App.tsx src/App.size.test.ts src/lib/utils.ts src/lib/utils.test.ts` from the client directory, with separate focused passes for Inventory and the authored Bank browser test.

Exact focused viewports: Chromium **1366×768, 390×844, 320×740, 360×740, 768×1024, 979×1024, 980×1024**; WebKit **390×844, 1366×768**. The mobile full-page screenshots can be taller than their viewport. Browser APIs were intercepted locally; expected failed-response messages were recorded separately from uncaught page errors.
