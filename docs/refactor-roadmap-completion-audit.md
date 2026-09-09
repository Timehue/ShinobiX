# Refactor roadmap completion audit

All six phases of the [2026-09-08 roadmap](refactor-pass-plan-2026-09-08.md) are complete within their stated bounded scope. This audit records implementation, compatibility, ownership and validation evidence, including the initial browser failures and their focused reruns.

Execution baseline: `de76c8483` on `codex/integrate-refactor-20260908`. Snapshot ownership and recovery decisions are committed as `90a8909b3`; save coordination and lifecycle ownership as `fff607576`. The user's eight narrative artifacts remain untracked and are outside this refactor.

| Requirement | Completion evidence | Status |
|---|---|---|
| 1. Resolve integration and preserve current behavior | Integration report, preserved backups, no unmerged index entries. All eight unrelated narrative artifacts match their original SHA-256 hashes. | Verified |
| 1. Story artifacts, baseline tests, screenshots, sizes | Integration and cinematic reports retain the baselines. Final build and browser runs, with the focused follow-ups below, verify the combined artifact. | Verified |
| 2. Resources, actors, cameras, effects, variants, playback | `pet-coliseum/` modules; 244 original declarations preserved across both passes; compatibility exports retained. | Verified |
| 2. Lifecycle, commands, replay/resume, KO, settlement retry, exit/re-entry | Original cinematic visual/quality/remount/command checks plus two permanent desktop/phone terminal cases pass. The latter verify focus, one retry, pending/error exit blocking, settled exit, unmount/re-entry and replay. Long winner-name clipping fixed separately in `cf7cac4f5`. | Verified |
| 2. Lazy loading, resource ownership, no new cycles or initial payload growth | Final production startup is 382,769 B gzip vs original 382,805 B; nine initial JS/CSS files vs fourteen. Direct consumer imports and shared rule chunk placement preserve lazy Three.js/Sentry and the original global CSS hash. No budgets raised. | Verified |
| 3. Boot snapshot application and restore decisions | `use-player-save-state` owns 21 fields and the shared hydration sequence; the ordered recovery classifier preserves lazy reads and epoch checks. Both fresh Academy journeys, including delayed response and refresh/logout/login, pass against built Express. | Verified |
| 3. Save coordination and dirty/flush ownership | One per-mount coordinator owns the existing version, flight and persistence; tracking/lifecycle hooks retain effect registration order and guarded clocks. Five moved function bodies match the baseline. The live onboarding/persistence cases pass. | Verified |
| 3. Account/session, version, travel, battle-resume invariants | Behavioral hydration, recovery, dirty tracking, queued/captured writes, retries and account-switch cases pass in the complete 9,700-test run. WorldMap recovery and both fresh-account persistence browser journeys pass. | Verified |
| 3. App compatibility and size ratchet | App is 6,573 lines vs the clean-build baseline's 6,939; budget lowered to 6,578. Compatibility exports remain. All ten final shared declarations and the App body match their prior source. The no-App-value-import gate now includes screens, components and features. Build and lint pass. | Verified |
| 3. Starter-grant response race found by the live fixture | Fixed separately in `c81c2a30c`. Four unit cases pass; both permanent full Academy browser journeys (normal and 500 ms delayed grant) pass, including refresh and logout/login. Persistence polling now uses the existing read-only admin path so observations do not advance the player version. | Verified |
| 4. Public and combat save projections | Committed `3e5659ab3`; compatible wrappers, unchanged allowlists, filters and ordering. Projection/forge/ownership tests pass. | Verified |
| 4. Ordered character sanitization | Committed `e4c229dec`; ten ordered stages and 33 helper declarations verified against baseline bodies; all 16 retained endpoint functions match. Endpoint 3,639 to 1,478 lines. See the save-pass report. | Verified |
| 4. Golden masters and security-sensitive contracts | Expected golden snapshots and canonical ownership manifest unchanged; all 9,700 root tests pass. Server compilation, deployment and rollback-readiness checks pass. | Verified |
| 5. WorldMap decomposition | `f6e41cc42`: six unchanged sector-art declarations and the Hollow Gate entry menu have separate owners. Source budget lowered to 5,251; 61 focused contracts and six desktop/mobile recovery/FirstPact baseline browser cases pass. | Verified |
| 5. FirstPact decomposition | `149e03e2b`: narrative selectors and crossing panel extracted; eight moved declarations and 71 retained functions unchanged. 71 focused contracts, three voice checks and four desktop/mobile browser cases pass. | Verified |
| 5. AdminPanel decomposition | `a11b2a0`: profession image editor extracted with unchanged body and shared publisher. 30 contracts pass. Both admin roles pass desktop/mobile uploads on old/new builds; all four corresponding screenshots are pixel-identical. | Verified |
| 5. PetShowdownBattle and Warfront | `5797986ad`: Showdown team HUD/tokens and Pet Ladder stage event effects/colors extracted. All 110 original declarations have one owner and unchanged bodies. 194 contracts and 24 old/new desktop/mobile/quality browser comparisons pass; Showdown HUD snapshots match. | Verified |
| 6. Server route and lifecycle boundaries | `4c52c4bfb`, `b01c976f4`: explicit registration owns 275 routes and 278 ordered imports. Nine retained entry functions unchanged. 95 focused contracts and 38 follow-up source contracts pass; live Express aliases/CORS/404 and Village Stores pass. | Verified |
| 6. Generated simulation and legacy cleanup | Canonical generation/parity checks pass without regeneration. Pet Ladder still consumes the three-lane renderer; generated mirrors and documented rollback adapters have compatibility consumers and are retained. No deletion justified by age alone. | Verified |
| Final checks | 9,700/9,700 root tests pass; lint has zero errors and ten existing warnings. Build/story/distribution/size, runtime docs, deployment and rollback checks pass. Every required browser case is covered successfully across the full runs and focused reruns below. | Verified |
| Final delivery | Responsibility extractions and fixes are separate local commits. Reports and measurements are retained; no migrations or generated dist changes are committed. Original narrative artifacts, the ownership manifest and golden snapshots are preserved. | Complete |

The mobile result-heading clipping is fixed in a separate behavior commit, with passing focus/retry/exit/re-entry/replay browser coverage. See the feature-screen and server reports for ownership inventories and retained evidence.

## Final production measurements

`4c2a86beb` co-locates the already-loaded world and character rules in the existing world-authority chunk and lets pet art use automatic placement. This removes tiny shared startup chunks without merging source authorities or changing loading boundaries. The tradeoff is that these rule modules share a cache invalidation boundary. The entry remains 473 KB, well below the unchanged 640,000 B ceiling; it is not a thin bootstrap concealing a larger eager App chunk.

| Measure | Original clean-build baseline | Completed build |
|---|---:|---:|
| Initial JS/CSS gzip | 382,805 B | 382,769 B |
| Initial JS/CSS files | 14 | 9 |
| All emitted JS/CSS gzip | 2,270,014 B | 2,270,700 B |
| Global CSS hash | `index-Cq_XpYY9.css` | `index-Cq_XpYY9.css` |

Startup is effectively unchanged (36 B lower); this is an ownership refactor with fewer initial files, not a claim of a material download-speed improvement. All emitted code is 686 B gzip above the original baseline, including the separately recorded fixes. The existing aggregate and per-file budgets pass unchanged. No rejected probe configuration is part of production.

The completed branch is `codex/integrate-refactor-20260908`. At final audit, `main` points to `9a13ff264` rather than the original `eda936ed1`; this refactor does not rewrite or integrate that newer main history. Validation certifies the refactor branch's artifact. Local source, screenshot and test evidence remains under `.tmp/refactor-screens/` and `.tmp/refactor-final/`.

## Final verification record

| Gate | Full run | Focused follow-up |
|---|---|---|
| Root unit/contracts | 9,700 passed, zero failures | Final App ratchets: nine passed; Vite auth contracts: twelve passed |
| Client lint | Zero errors, ten existing warnings | Final configuration and combat-fixture lint also pass |
| Production build | Server/client compilation, story verification, distribution and all size gates pass | Startup numbers above reproduced in the production artifact |
| Runtime docs / deployment / rollback | All pass | No generated-document drift or destructive statements |
| Responsive | 389 passed, 266 intentional skips, one WebKit story-choice stability timeout | All five WebKit mobile narrative cases pass unchanged in isolation, including the failed case |
| Strict combat layout | 19 passed, ten intentional skips, one WebKit PvP failure | All six PvP browser/DPR cases pass after the fixture correction in `3e7df49dc` |
| Warfront | 39 passed, 129 intentional skips, zero failures | Includes both permanent Colosseum terminal cases |
| Live Express | Four passed, zero failures | Normal/delayed Academy, Village Stores, API aliases/CORS/JSON failures |

This covers all 453 distinct required browser cases successfully after focused reruns, with 405 intentional skips. It is not a claim that the first full browser commands were failure-free.

The PvP trace records the browser sending `action: "wait", auto: true` while the viewport sweep was still measuring one turn. The fixture had disabled the server deadline but left the browser countdown running. It also failed to seat the absent opponent when P1 won the coin flip. The corrected fixture joins both real accounts through Express, waits for the actual countdown overlay to clear, and holds Date plus heartbeat clock samples at one point inside that turn. Animation frames, server battle state, actions, viewports, and all geometry assertions remain unchanged. All six variants pass with this setup.

The WebKit narrative failure timed out waiting for a visible, enabled choice to become stable during the combined run. Its full five-case narrative suite passes unchanged in isolation. No production change or assertion relaxation was justified by that non-reproducing failure; the retained trace documents the remaining timing sensitivity under combined load.

Evidence: `.tmp/refactor-screens/roadmap-final-unit.log`, `roadmap-final-lint.log`, `roadmap-final-build.log`; `.tmp/refactor-final/{responsive,combat-layout,warfront,live,narrative-isolated,pvp-clock-seated}.log`; screenshots/traces under their corresponding output directories. Final source hashes, user-artifact hashes and report-link checks are retained. Temporary comparison servers are stopped; rejected probe builds are removed while their logs and the verified artifact remain.

## Post-completion integration check

A second wiring audit found one coverage gap: CI selected only Village Stores from the live Express suite, so the new Academy persistence and route-alias regressions ran locally but were absent from the required check. The existing `CI / e2e-village-stores` job now selects all three spec files on its joined release artifact, retaining its check name and 15-minute limit. A workflow contract prevents these cases from being omitted again. Endpoint-registration instructions and test diagnostics now point to `server-api-routes.ts`; the CI documentation also acknowledges the existing Warfront gate.

Fresh verification:

- The import graph covers 1,830 source files. All 51 audited extraction modules are reachable from `main.tsx` or `server.ts`: 50 at runtime and `player-save-types.ts` through type imports. No unresolved relative code imports, case mismatches or static import cycles touching these modules were found.
- All 136 explicit public export names across the nine compatibility surfaces are retained. App's narrative normalizer alias and the shared mutable Hollow Gate prices still resolve to their canonical owners.
- All 275 route paths, handler identifiers and their order exactly match the execution baseline. The 814 local files required by compiled `dist/server.js` resolve inside the shipped `dist/` tree; Docker copies that whole tree.
- Save callbacks retain their shared refs and setters, one coordinator per mount, ordered dirty tracking and snapshot hydration. Sanitizer stages preserve their ordering and shared bloodline-forge closure, consumed-ID set and pending receipts.
- The full unit/contract run passes **9,701/9,701**. The exact expanded CI selection passes **4/4 live Express cases** in 2.4 minutes: normal Academy, delayed Academy, route aliases/CORS/JSON failures and Village Stores.
- Distribution and size gates pass again. Startup remains 1,451,845 B raw / 382,769 B gzip across nine files, with Three.js outside the initial graph. Production source is unchanged by this follow-up; the prior build, lint and complete browser-matrix evidence remains applicable.

Evidence: `.tmp/refactor-final/integration-{graph,boundaries}.json`, `integration-{unit,live,dist,size}.log`, and the live browser output under `integration-live/`. The import and compiled-dependency audits are static; the four Express cases separately exercise the built runtime. These are local branch checks; the updated workflow will run on the next push. No deployment or migration step is required for the extracted modules beyond the normal source build.


