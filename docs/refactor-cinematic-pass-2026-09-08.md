# Cinematic pet presentation extraction — 2026-09-08

This continues phase 2 of the [refactor roadmap](refactor-pass-plan-2026-09-08.md), from the verified integrated baseline `09150ec3b` on `codex/integrate-refactor-20260908`. The implementation and resource tests are committed as `83e0d7ef9`.

`PetColiseum.tsx` now owns cinematic match composition, UI state, public props, and the existing compatibility exports. Actors, playback, effects, and their resources have separate owners under `components/pet-coliseum/`.

| Module | Responsibility |
|---|---|
| `duel-stage.ts` | Shared coordinates, opening timing, effect cue types, and deterministic presentation helpers. |
| `duel-actors.tsx` | Model/standee rendering, actor spacing, poses, and cut-in portraits. |
| `duel-director.tsx` | Existing frame callback, event dispatch, camera choreography, and optional AI debug display. |
| `duel-resources.ts` | Geometry builders, geometry caches, lazy texture allocation, and cancellable prewarming. |
| `duel-projectiles.tsx` | Projectile bodies, projectile movement, and command focus marker. |
| `duel-weather.tsx` | Clock-driven battlefield weather and its local geometry. |
| `duel-element-effects.tsx` | Contact, aftermath, support, melee trail, power-up, and shockwave effects. |
| `duel-dash-effects.tsx` | Dash trails, collision effects, and pressure clashes. |
| `duel-set-pieces.tsx` | Arena-scale and signature effect renderers. |

## Compatibility and ownership

All **114 original top-level declarations** are preserved exactly, apart from export modifiers and relative module/asset paths. An AST comparison verifies a single owner for every declaration and no missing or duplicate bodies. Existing frame-based and arena-match modules are untouched. Public component exports and prop contracts remain at `PetColiseum.tsx`.

The extracted dependency graph has no cycles or imports back into `PetColiseum.tsx`. Module-level geometry maps and the lazy tornado texture remain singletons. Component hooks, frame ordering, cleanup, callbacks, command acknowledgments, reconnect behavior, terminal handling, gameplay rules, save fields, and CSS remain unchanged. Legacy private effect variants are retained in their corresponding modules; their removal would require a separate usage review.

Four behavioral tests cover shared geometry identity, isolation between effect phases and graphics qualities, cancellation before prewarming begins, and cancellation between prewarm slices. A late callback after cancellation cannot restart the work, and warmed geometry remains reusable.

## Measurements

Line counts include the trailing newline, matching the earlier reports.

| Measure | Integrated baseline | After extraction |
|---|---:|---:|
| `PetColiseum.tsx` lines | 7,525 | 1,704 |
| Initial JS/CSS graph, gzip | 383,338 B | 383,329 B |
| Initial JS/CSS files | 14 | 14 |
| All emitted JS/CSS, gzip | 2,270,807 B | 2,270,278 B |

The main file loses 5,821 lines (77%). Added import wiring and module boundaries do not constitute a performance optimization; the startup payload is effectively unchanged. All existing size budgets remain intact.

## Validation

- Declaration preservation and dependency-cycle check: passed.
- TypeScript: passed.
- Full unit and contract suite: **9,656 passed**, zero failures or skips.
- Full frontend lint: **zero errors and ten existing warnings**.
- Runtime-mode documentation check: current. Its first sandboxed attempt could not start the compiler subprocess; the permitted rerun passed.
- Production build: passed, including story generation checks, server/client compilation, distribution integrity, and size gates.
- Before/after browser checks: all three existing renderer entry points load at desktop and mobile sizes, **six cases per revision**, with zero page errors. Cinematic desktop and mobile screenshots were visually compared. Animation time is not synchronized, so this is not a claim of pixel identity.
- Graphics-quality lifecycle checks: **six passed** across low, medium, and high quality at desktop/mobile sizes. Each case performs three unmount/remount cycles, selects and locks an opening tactic in the live duel, checks the command deck and pause/resume, then verifies replay in the recorded cinematic mode. No page errors occurred.
- Terminal playback checks: **two passed**, desktop and mobile. Resuming a replay at its terminal snapshot reaches the modal result, contains keyboard focus, and restarts through Replay without page errors.
- Warfront browser gate: **37 passed, 124 intentionally skipped**, no failures.
- Village Stores live-server gate: **one passed**, no failures.
- Full strict combat gate: **20 passed, 10 intentionally skipped**, no failures or retries in the final runs. Chromium passed 14 cases, and Firefox/WebKit passed three each.
- Full responsive gate: **386 passed, 256 intentionally skipped**, no failures or retries (21.8 minutes).
- Combined required browser gates: **444 passed, 390 intentionally skipped** in the final runs.

Manual inspection of `lifecycle/result-390.png` also found an existing UI limitation: a long winner name such as “Guardhound” clips in the mobile result heading. The result-dialog body and CSS are unchanged from the baseline, as verified by the declaration comparison. The terminal checks establish focus containment and replay behavior; they do not establish that every result-heading string fits. Record the heading's wrapping/sizing as a separate UI repair.

The first custom lifecycle attempt expected the command deck before selecting an opening tactic. The existing UI correctly remained at “Choose the Fight Plan.” The corrected check selects Adaptive and locks it before testing live controls, then checks replay in the recorded cinematic mode where that control is available. Production code was not changed to accommodate the harness.

The initial WebKit combat group passed Solo PvE and PvP, then failed the countdown baseline's tile hit-test. Its trace records a 524 px board container with a 928.75 px grid still using the previous `1.053` scale after resizing. The later failure screenshot shows the correctly fitted board. Commit `9a68fdb9d` makes the countdown helper wait up to five seconds for the existing board-usability assertions before recording its baseline. All countdown transitions retain their immediate one-pixel geometry checks; no threshold, viewport, test, or authentication limit was relaxed. The incomplete Chromium run and initial WebKit rerun were stopped so final combat verification could run all three CI groups with the same corrected helper.

Final combat runs use the CI project groups on fresh in-memory servers: four Chromium projects on port 25158, Firefox on 25159, and WebKit on 25160. All set `COMBAT_LAYOUT_CAPTURE_PHASE=after` and `COMBAT_LAYOUT_STRICT=1`, with no viewport filter. Their logs are `e2e-combat-final-chromium.log`, `e2e-combat-final-firefox.log`, and `e2e-combat-final-webkit.log`. The responsive suite uses two workers and the immutable `.playwright-dist-25151` snapshot; its log is `e2e-responsive.log`.

Local evidence is under `.tmp/refactor-cinematic/`: `extraction.log`, `coliseum-move-verification.txt`, `resource-tests.log`, `tests.log`, `lint.log`, `new-test-lint.log`, `build.log`, renderer screenshots, lifecycle results, and browser-suite logs. Production artifacts remain generated output and are not committed.

## Next step

The next bounded implementation step is phase 3: extract App's snapshot-application decisions while preserving session authority, travel recovery, and battle resume behavior. The inspected boot and in-session paths share normalization/default preparation, but their side effects differ: the in-session path invalidates save authority and preserves the current screen, while boot reconstructs battle recovery and chooses a resume route. Start with their pure preparation decisions and keep those orchestration differences explicit; avoid one helper that accepts every App setter.

This pass changes cinematic presentation ownership only. No migration or special deployment procedure is required.
