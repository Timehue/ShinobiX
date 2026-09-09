# Refactor pass — 2026-09-08

This records the first isolated pass. The subsequent [integration and Tower repair report](refactor-integration-report-2026-09-08.md) tracks resolution of the original conflicts and the browser failure described below.

The first pass separates pet presentation resources and variants, and extracts App's boot request sequence and save-session scope. Gameplay rules, API routes, save fields, and settlement policies are unchanged.

Work is isolated on `codex/refactor-pass-20260908`, based on local main `eda936ed1`, in `.codex-worktrees/refactor-pass-20260908`. The original checkout's 35 unresolved stash-application conflicts were not resolved or overwritten. Resolving those conflicts would require integrating older story work and unrelated security changes; it is separate from this refactor.

**Changes**

- `PetColiseum.tsx` retains the cinematic duel and the existing public exports. Its frame-based player and tactical arena match now live in `components/pet-coliseum/frame-battle.tsx` and `arena-match.tsx`.
- `sprite-resources.ts` owns the sprite/pose loaders, texture caches, and ghost material factory. `stage.ts` owns shared framing/projection values and styles; `stage-components.tsx` owns shared leaf renderers. `playback-state.ts` preserves the existing singleton command-to-camera bridge.
- A declaration comparison verifies that all **244** original top-level declarations remain, with no duplicate owners. Their bodies are unchanged apart from export modifiers and relative asset/module paths. Existing component props, callbacks, mutable resource lifetimes, and simulation calls remain compatible.
- `boot-restore.ts` coordinates the existing concurrent save/lock fetch, guest retry, timeout, and completion callbacks under the original session generation. Credential changes and snapshot application remain in App.
- `save-authority-scope.ts` coordinates the same account, version, revision, failure, and abort refs used by existing persistence and PvP admission. It introduces no second version or epoch store. Existing App function signatures delegate to it.
- Fifteen behavioral tests cover successful restoration, foreign snapshots, timeouts, session changes during each request stage, guest retry, rejected requests, account switches, logout, cancellation, and external version ordering. Existing source contracts now follow the extracted implementation without weakening their assertions.

**Measurements**

| Measure | Baseline | After |
|---|---:|---:|
| `PetColiseum.tsx` lines, counting the trailing newline | 10,433 | 7,525 |
| `App.tsx` lines, counting the trailing newline | 6,939 | 6,895 |
| App line budget | 6,948 | 6,895 |
| Initial JS/CSS gzip | 382,805 B | 383,344 B |
| Initial JS/CSS files | 14 | 14 |
| All emitted JS/CSS gzip | 2,270,014 B | 2,270,672 B |

Startup code increases by **539 bytes gzip (0.14%)**. This pass improves code ownership and testability; it does not claim a startup performance improvement. All existing build-size budgets are preserved and pass.

**Verification**

- Baseline production build: passed, including story generation checks, TypeScript, distribution integrity, and size gates.
- Baseline full unit/contract suite: 9,628 passed, one test-file failure in the unchanged `api/_route-request-shape.test.ts`. An isolated rerun passed all five cases. The initial sandbox attempt could not launch Node workers and is not counted as an executed baseline.
- Baseline and final full lint: zero errors and ten existing warnings. Changed-file lint after extraction: passed with no errors or warnings.
- Focused integration suite after extraction: **166/166 passed**.
- Final full unit/contract suite: **9,648/9,648 passed**, zero failures or skips.
- Final production build: passed, including both TypeScript builds and all size gates.
- Runtime-mode documentation check and `git diff --check`: passed.
- Before/after browser inspection: all three pet renderers loaded on desktop and mobile, **six cases per revision**, with zero page errors. Screenshots were inspected; animation timestamps are not synchronized, so these are visual comparisons rather than pixel-identical assertions.

| Browser gate | Full run | Follow-up |
|---|---|---|
| Responsive and accessibility | 385 passed, 256 intentionally skipped, 1 failed | The Chromium compact Tomoe guide case passed against the same immutable build snapshot. |
| Strict combat layout | 17 passed, 10 intentionally skipped, 3 failed | The failed Tower cases at DPR 1.25 and 2 passed individually. The WebKit Tower case still fails; the unchanged baseline also fails this test. |
| Warfront | 37 passed, 124 intentionally skipped | No failed cases. |
| Village Stores live Express | 1 passed | Local in-memory test server. |

The skip counts come from the existing browser/device guards; no tests or thresholds were disabled for this pass. Both full browser suites executed, but their original runs were **not all green**.

The Tomoe failure captured four dynamic-import errors for `c-CYJfZ07p.js`. The trace contains one unsuccessful request followed by a 200 response for that asset; the asset exists in the immutable snapshot, and the unchanged spec passed on rerun using that snapshot. This was not a demonstrated missing build asset.

The remaining WebKit failure is `e2e-live/combat-layout-matrix.spec.ts:2013`, “Tower combat shell keeps jutsu selection geometry stable,” during the 1024×768 arming transition. The refactor run reports a 47 px board-stage shift against a 1 px limit. A separate build restoring the two changed production entry files from `eda936ed1` also fails the same test and viewport, reporting a 23.5 px rendered-grid shift. Its entry JavaScript and CSS hashes match the initial baseline build (`index-CxNblxs8.js`, `index-Cq_XpYY9.css`). The final refactor keeps that exact CSS hash. This establishes a failing baseline for Tower geometry; it does not establish an all-green browser release gate. Investigate that transition as a separate behavior fix before treating the branch as release-certified.

The baseline comparison used a temporary Vite load plugin to read the original App and PetColiseum source from Git, emitted to a separate directory, and served it through the existing `STATIC_DIR` override. It changed neither production source nor the final build. All other production source and test assertions remained identical.

To reproduce the remaining case from the repository root after building:

```powershell
$env:COMBAT_LAYOUT_CAPTURE_PHASE = 'after'
$env:COMBAT_LAYOUT_STRICT = '1'
npm run test:e2e:combat-layout --prefix shinobij.client -- --grep 'Tower combat shell keeps jutsu selection geometry stable' --project=webkit-layout
```

Evidence is retained locally under `.tmp/refactor-evidence/`. These logs, screenshots, development scripts, dependencies, and generated `dist/` files are not release source.

**Scope and delivery**

No database migration, infrastructure change, or special deployment procedure is required. Nothing has been pushed, merged into the conflicted checkout, or deployed. Railway continues to build from source.

Implementation commits are `78e71fb39` (pet presentation extraction) and `6598e1480` (boot restoration and save account scope). Each can be reviewed or reverted independently. Apply them only after the original checkout's story integration is settled; do not cherry-pick into its unresolved index.

The remaining cinematic effects, actor, and director code is still in `PetColiseum.tsx`. App still owns snapshot application and screen routing. Save-handler extraction, large feature screens, and server cleanup remain later work from the plan; they were not folded into this bounded first pass.
