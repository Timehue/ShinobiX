# Loading and long-session performance improvements

This pass implements priorities 3 and 4 from the [performance review](performance-health-next-pass-2026-09-08.md), as selected by the user. It reduces unnecessary downloads and fixes a reproduced GPU-resource leak. No new player telemetry or server-health monitoring was added.

## Changes

- PvP screen and arena-art warmup now waits until a likely combat gateway: World Map, Arena, Battle Towers, village war or clan war. Save restoration, ordinary village/inventory/profile visits, Academy onboarding and data-saver connections no longer start the speculative download. Actual PvP launch/restoration still requests its assets immediately. Existing battle admission and lazy-screen loading remain authoritative.
- Cinematic visual-novel CSS loads with its stage or authoring editor from `styles/cinematic-vn.css`. The stylesheet moved out of the globally owned numbered-parts directory. All 832 declarations are unchanged, and a parsed comparison found no selector/property overlaps with later numbered parts. Other numbered stylesheets contain mixed feature/global rules and retain their established cascade order.
- Retiring a pet fighter now disposes the bone textures owned by its cloned skeletons, including the outline rig. Shared GLTF geometry, atlas maps and source skeletons remain cached. The existing Strict Mode reactivation guard and animation-mixer retirement behavior are preserved.

## Before/after evidence

Matched Chromium runs used immutable QA builds, identical save fixtures, blocked service workers and fresh browser contexts. Village measurements were taken two seconds after restoration; compression totals use gzip on the exact JavaScript/CSS files requested by the browser.

| Village entry | Before | After | Reduction |
|---|---:|---:|---:|
| Desktop JS/CSS, gzip bytes | 556,594 | 488,610 | 67,984 (12.2%) |
| Phone JS/CSS, gzip bytes | 562,460 | 494,476 | 67,984 (12.1%) |
| JavaScript requests | 72 | 62 | 10 |
| Desktop / phone CSS requests | 7 / 8 | 6 / 7 | 1 |
| Unused arena images | 234,134 bytes | 0 | 234,134 bytes, 2 requests |

Desktop viewport: 1366×768; phone: 390×844. The requested PvP module was identified from each build's manifest, since its emitted filename is hashed. It loaded on village entry before the change and remained deferred afterward. The 42 cinematic stage elements had identical measured geometry and computed presentation properties at both viewports. Screenshots were also inspected.

The final ordinary production build's initial JS/CSS graph decreased from 382,769 to 377,214 bytes gzip (5,555 bytes), with the existing nine startup files. This startup saving is part of the later village-entry saving above; the figures should not be added together. The production manifest also confirms cinematic CSS belongs to both the story stage and admin editor and is absent from the initial graph.

The resource test holds one WebGL renderer open with eight real production pet rigs, replacing fighters, switching low/high/medium quality, retiring them and remounting them for 12 cycles:

| GPU resource | Before | After |
|---|---:|---:|
| Textures at initial medium quality | 18 | 18 |
| Textures after 12 cycles | 882 | 18 |
| Textures after retiring the final fighters | 866 | 2 |
| Geometries throughout | 1 | 1 |

The fixed renderer consistently uses 10 textures at low quality, 18 at medium/high, and returns to the two shared cached textures after retirement. Both runs completed without browser runtime errors. These are resource counts from a controlled local workload, not an FPS claim or a production device-memory estimate.

## Regression coverage

- `battle-entry-warmup.test.ts`: noncombat, restore, Academy, legacy accounts, data saver and actual PvP launch.
- `pet-model-resources.test.ts`: 20 clone/disposal cycles, checking both rigs release their owned textures/materials and never dispose shared resources.
- `deferred-feature-loading.spec.ts`: real village-to-World-Map warmup and classic-to-cinematic reader transition on desktop and phone.
- `model-resource-lifecycle.spec.ts`: six repeated lifecycle/quality cycles on desktop and phone, plus real page freeze/resume with the renderer retained. Checks GPU counts return to their warmed values and animation frames resume.

The model QA entry is reachable only from `petvfx.html?modelresources=1`; it is absent from the ordinary production entry graph. Existing Warfront, combat, Academy and persistence suites exercise the surrounding gameplay.

## Validation

| Check | Result |
|---|---|
| Full release build, final client rebuild, distribution verification and size gates | Passed; budgets unchanged |
| Full client lint plus focused lint of all new files | 0 errors; 9 existing warnings, down from 10 |
| Loading and cinematic-style regression | 4 passed across desktop and phone |
| Full Warfront suite | 41 passed; 134 device-specific exclusions |
| Live Express economy, Academy and route wiring | 4 passed, including normal and delayed Academy persistence |
| Full unit/contract suite after the ownership fix | 9,705 passed; 0 failures, cancellations or skips |
| Full responsive suite | 393 passed; 276 exclusions; one new navigation fixture corrected, then all 4 focused desktop/phone cases passed |
| Full strict combat suite (`COMBAT_LAYOUT_CAPTURE_PHASE=after`, `COMBAT_LAYOUT_STRICT=1`) | 20 passed; 10 existing project-specific exclusions; Chromium display-scale variants, Firefox and WebKit covered |

Two validation issues were corrected: the stylesheet initially remained in the directory reserved for eager global parts, and the new navigation test initially changed the URL hash instead of clicking the game's navigation control. The directory's completeness guard remains intact, and the corrected navigation test passed on desktop and phone. Neither required weakening an assertion or a build budget.

Local evidence is under `.tmp/performance-pass/`, including `before/after-loading.json`, `before/after-model-cycles.json`, `css-ownership.json`, `feature-css-integration.json`, story screenshots/computed styles and the full check logs.

Final logs: `final-client-build.log`, `client-lint.log`, `unit-tests-final.log`, `responsive.log`, `loading-regression.log`, `combat-layout.log`, `warfront.log` and `live-express.log`. The eight pre-existing narrative documents/patches remain untouched and untracked; their hashes were checked again. Work remains on `codex/integrate-refactor-20260908`; no deployment or merge to `main` was performed.

The remaining Rite-stage dependency warning was reviewed: its fighter lookup is recomputed from the same fighter array, its grounding flag is fixed for the mounted QA page, and its animation/observer/timer cleanup already runs on effect retirement. This pass did not find a leak there requiring a runtime change.
