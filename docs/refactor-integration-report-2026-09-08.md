# Refactor integration and Tower layout repair — 2026-09-08

The original workspace is now on `codex/integrate-refactor-20260908`. All 35 conflicts from the old stash application are resolved, and the first refactor pass is integrated. Local `main` remains at `eda936ed1`; nothing has been pushed or deployed.

## Tower layout repair

The failing WebKit test exposed a real layout defect. At 1024×768, proportional countdown digits changed the width of the “Your turn” pill. The header alternated between 134 px and 87 px tall as the clock moved through 22, 21, 20, and 19 seconds. That moved the battlefield by 47 px, sometimes during a jutsu-selection trace.

The timer now reserves an explicit five-character width and uses tabular numerals. Its flex basis, width, and minimum width agree, including in Firefox and WebKit's intrinsic sizing. The timer still displays the real remaining seconds and keeps its accessible timer label. No turn duration or combat rule changed.

Deterministic countdown assertions extend the existing Tower journey in all six combat browser/DPR projects. At battle entry, they use the server's turn-start timestamp and Playwright's fixed wall clock to check 22, 21, 20, 19, 11, 10, 9, 1, and 0 seconds. They verify timer width, header height, board geometry, tile usability, and viewport geometry with the existing one-pixel limit, then restore advancing real time before the full viewport sweep. The initial standalone regression test failed on the old build at 21 seconds with the same 47 px shift. The final targeted Firefox and WebKit run passed both cases after the fix; the final implementation adds the assertions to the existing journey without adding account registrations.

The prior Tomoe guide failure was also diagnosed from its network trace: the failed asset request reported `net::ERR_NETWORK_CHANGED`, followed by a successful response. This corroborates the same-snapshot rerun from the first pass; no guide code or error assertion was changed.

## Conflict resolution

Before editing, the complete unmerged index, each conflict's three Git stages, every changed working file, and the untracked narrative documents were copied to `.tmp/refactor-integration/backup/`. `snapshot-complete.json`, `inventory.json`, and `resolution.json` record the inspected paths and decisions.

For 31 of the 35 files, retaining the newer upstream conflict blocks produced a file identical to current main. Four files also contained stale automatic merge fragments:

- The save deletion handler repeated `deletePlayerFirstPactState` after the correctly ordered call. The duplicate was removed.
- The Warfront stage lost still-required objective type imports and acquired an obsolete projectile comment. The current imports and comment were retained.
- Character progress gained unused imports from the eager story graph. The current extracted ownership was retained.
- The pet stage director acquired an unused older retreat option. Main's newer bounded-travel implementation was retained.

The resolved API, server, and shared runtime source is unchanged from the inspected main baseline. In particular, account/story deletion ordering, lock behavior, admin ownership, battle presence, save projections, lazy story loading, travel recovery, and current combat presentation fixes remain intact.

The stash's extra stage-director regression test was preserved and passes against the current implementation. Main's stronger unconditional retreat-distance assertion remains. The three untracked Warfront replay parity cases were also preserved and pass. All eight original narrative documents and patch files remain byte-identical and untracked in `docs/`; the stash itself was not dropped.

The older refactor planning artifact was backed up before being replaced by its updated version from the refactor branch.

## Validation

- Focused conflict/integration tests: **40 passed**.
- Countdown regression: demonstrated failure before the fix; final targeted Firefox and WebKit run **2 passed**.
- Runtime-mode generated documentation: current.
- Full unit/contract suite: **9,652/9,652 passed**, with no failures or skips.
- Production build: passed, including generated story checks, server/client TypeScript, distribution integrity, and size gates.
- Initial JS/CSS payload: **383,338 bytes gzip across 14 files**, 533 bytes (0.14%) above the original pre-refactor baseline. All emitted JS/CSS totals 2,270,807 bytes gzip. Existing budgets remain unchanged.
- Village Stores live Express gate: **1 passed** in the local in-memory environment.
- Warfront browser gate: **37 passed, 124 intentionally skipped**, no failures.
- Full responsive/accessibility gate: **386 passed, 256 intentionally skipped**, no failures or retries.
- Full frontend lint: **zero errors, ten pre-existing warnings**. The final changed-file lint check also passed.
- Full strict combat matrix: **20 passed, 10 intentionally skipped**, no failures or retries. The four Chromium projects passed 14 tests (six skips, 6.6 minutes); Firefox and WebKit each passed three tests (two skips each, 2.4 and 3.0 minutes).
- Combined required browser gates: **444 passed, 390 intentionally skipped**, no failures. All checks above passed against the integrated production code; the final combat suite includes the test sequencing correction in `23d323f1e`.

Initial integrated combat attempts exposed fixture setup issues: a reused account name, then HTTP 429 responses when extra registrations exhausted the shared server's authentication budget. The latter run recorded 20 passes, six registration failures, and ten skips. The final countdown coverage reuses the existing Tower account, restoring the original fixture count. Final combat verification runs all tests in the exact three CI groups (four Chromium projects, Firefox, and WebKit), each on a fresh local in-memory server. Production authentication limits and all geometry assertions remain unchanged.

An intermediate Firefox journey also exposed a test timing assumption: after the long viewport sweep, a later combat turn could make the original launch timestamp stale. The final test checks the countdown at battle entry and restores real time before the sweep. This changes test sequencing only; the production timer fix is unchanged.

ESLint now ignores `.tmp/**`, `.playwright-dist-*/**`, and `output/**`, matching the temporary, immutable preview, and generated output artifacts used by local QA. The first integrated lint run found four unused declarations in an existing ignored `output/warfront` scratch harness; those artifacts are now excluded consistently. Source checks remain enabled. The original narrative files are outside these generated directories.

Evidence for the integrated checkout is in `.tmp/refactor-integration/`. The countdown diagnosis and its before/final focused runs are in `.codex-worktrees/refactor-pass-20260908/.tmp/refactor-followup/`.

| Check | Integrated evidence log |
|---|---|
| Unit/contract suite | `full-tests.log` |
| Production build and size gates | `build.log` |
| Full frontend lint / final changed-test lint | `lint-final.log` / `countdown-entry-lint.log` |
| Full responsive suite | `e2e-responsive.log` |
| Warfront suite | `e2e-warfront.log` |
| Village Stores | `e2e-village.log` |
| Strict combat, four Chromium projects | `e2e-combat-cert-chromium.log` |
| Strict combat, Firefox | `e2e-combat-cert-firefox.log` |
| Strict combat, WebKit | `e2e-combat-cert-webkit.log` |

The final combat commands run from the repository root in separate PowerShell processes. Each group uses `COMBAT_LAYOUT_CAPTURE_PHASE=after` and `COMBAT_LAYOUT_STRICT=1`, with no viewport filter. Ports are 25139, 25140, and 25141 for Chromium, Firefox, and WebKit respectively. Each group's `COMBAT_LAYOUT_ARTIFACT_ROOT` is `.tmp/refactor-integrated-combat-cert-<group>-captures`.

```powershell
npm run test:e2e:combat-layout --prefix shinobij.client -- --project=chromium-layout --project=chromium-dpr125 --project=chromium-dpr15 --project=chromium-dpr2 --output=test-results/refactor-integrated-combat-cert-chromium
npm run test:e2e:combat-layout --prefix shinobij.client -- --project=firefox-layout --output=test-results/refactor-integrated-combat-cert-firefox
npm run test:e2e:combat-layout --prefix shinobij.client -- --project=webkit-layout --output=test-results/refactor-integrated-combat-cert-webkit
```

The Tower journey saves a 1024×768 countdown screenshot per browser/DPR project under `shinobij.client/test-results/refactor-integrated-combat-cert-*/`. The final WebKit countdown image and earlier Chromium image were inspected: the full battlefield, command deck, resource display, and leave control remain contained and visible.

## Local history

- `1ae5e162d` — reconcile stale stash and retain the additional passing pet tests and worktree ignore rules.
- `78e71fb39`, `6598e1480`, `e4ea187d1` — original refactor implementation and report.
- `0d681a12f` — countdown layout repair and deterministic browser coverage.
- `07d8f1575` — merge the refactor and repair into the original workspace's integration branch.
- `1ebbbbf83` — separate the countdown account fixture, retain its visual evidence, and exclude generated QA artifacts from lint.
- `61de7e8b2` — fold countdown coverage into the existing Tower journey to preserve the suite's original account count.
- `23d323f1e` — check the countdown at battle entry and restore advancing real time before the viewport sweep.

This follow-up clears the integration work that blocked use of the first pass. Further cinematic actor/effect extraction and App snapshot application remain separate work in the [refactor roadmap](refactor-pass-plan-2026-09-08.md).
