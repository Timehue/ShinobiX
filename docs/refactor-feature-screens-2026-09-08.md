# Feature-screen refactor — 2026-09-08

This completes the supported presentation boundaries identified in phase 5 of the refactor roadmap. Stateful gameplay, request admission, settlement and publication authorities remain with their existing owners.

| Surface | Responsibility moved | Physical lines before → after |
|---|---|---:|
| WorldMap | Sector art, depth and ambience resolvers; Hollow Gate entry menu | 5,365 → 5,251 |
| FirstPact | Narrative selectors and crossing panel | 6,611 → 6,118 |
| AdminPanel | Profession picker image editor; final direct imports | 6,706 → 6,628 |
| PetShowdownBattle | Team HUD and shared presentation tokens | 4,203 → 3,924 |
| PetWarfrontStage3D | Event beams, pulses and labels; shared scene colors | 703 → 529 |

WorldMap keeps its existing travel and zoom hooks, position authority and request cancellation. Its six moved art declarations match the baseline; the size gate is lowered to 5,251. Sixty-one focused contracts pass, and desktop/mobile world-position recovery and FirstPact baseline cases pass (six browser cases).

FirstPact's eight narrative declarations and all 71 retained top-level functions match their prior bodies. The crossing panel retains its original markup and callbacks; canvas, cache and world lifecycle code remains in place. Seventy-one focused library contracts and three narrative-voice checks pass. Four desktop/mobile browser cases pass, including the aftermath dialog. Before/after screenshots preserve text and layout; measured differences are confined to live canvas and button animation.

AdminPanel's profession editor has one input: the current shared-image map. Its five stable image keys, FileReader callback, compression settings, shared publisher, alerts and file-input behavior are unchanged. Existing role gates stay in the parent. Thirty editor contracts pass. Both full and content admins pass the browser upload workflow on desktop and mobile against both the baseline and extracted builds (four cases per build). The checks verify repeated uploads, compression, the admin credential header and category-cache invalidation. All four corresponding screenshots are pixel-identical.

Showdown's team panel owns status chips, health/energy display and target/bench presentation. Shared element and move-family tokens have a separate module. All 74 original declarations have exactly one owner and unchanged bodies. Warfront's 36 original declarations likewise have one owner and unchanged bodies. Its three-lane stage is still used by Pet Ladder; deleting it would break a live compatibility path. The Rite engine and its separate admission/settlement contracts are retained.

The Showdown/Warfront focused suite passes all 194 cases. Twenty-four optimized browser comparisons pass: both renderers, desktop/mobile, three quality levels, before and after. All six Showdown HUD text/font/dimension snapshots match exactly. Pet Ladder retains its existing compact-screen DOM fallback; desktop medium/high use the extracted 3D stage. Screenshots and results are retained under `.tmp/refactor-screens/pet-parity/`.

The separately committed mobile winner-title repair wraps long pet names inside the Colosseum result and victory-hold panels. Two browser cases verify a long winner name, dialog focus, pending/error exit blocking, one settlement retry, enabled settled exit, unmount/re-entry, and replay. The development harness holds pending settlement until explicitly released by the test. Production settlement callbacks and clocks are unchanged.

The later shared-value import cleanup preserves every screen's non-import statements. The final completion audit records the combined browser gates, lint, build and unit results.

Evidence retained locally: `.tmp/refactor-screens/screen-declaration-parity.json`, `worldmap-body-parity.json`, `first-pact-body-parity.json`, `first-pact-visual-comparison.json`, `admin-visual-comparison.json`, focused logs and browser artifacts. No generated distribution files are committed.
