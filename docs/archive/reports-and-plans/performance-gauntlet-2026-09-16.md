# Performance gauntlet — local implementation and evidence

Historical local-pass report. See [the main integration and remediation report](performance-remediation-2026-09-16.md) for subsequent fixes, current-main validation and release status.

This pass preserves the existing UI, combat engines, rules, server authority, save acknowledgments, and release budgets. Nothing was pushed or deployed; no database migration or production load test was run. Dates in artifact names use UTC.

## Starting state and measurement boundaries

- Branch: `codex/safe-consolidation-polish`; starting commit: `e3c09fe10988badc2a4b6a96f1f1bf4c085428b3`. There were **767 existing changed/untracked paths**. Their status and tracked patch are retained locally; files edited by this pass have individual pre-edit copies. Earlier performance work is not claimed as new.
- No applicable `AGENTS.md` was found in the workspace or parent directories. Root and client `CLAUDE.md` conventions were inspected.
- Windows 11 (`10.0.26200`), AMD Ryzen 5 5600X, 12 logical CPUs, 34,237,440,000 bytes RAM; Node **24.15.0**, npm **11.12.1**. The repository/CI pins Node 22, which was not available on PATH. Installed client versions: Vite **8.2.2**, React **19.2.8**, Three **0.185.1**, Playwright **1.62.1**, TypeScript **6.0.3**. Both lockfiles are unchanged and their hashes are recorded.
- Railway's active command is **`node dist/server.js`**, serving the API and built SPA together. `app.js` is the legacy cPanel wrapper and was not used. The existing filtered runtime asset copier remains intact.
- Browser measurements use the ordinary production client build and compiled Express server, with disposable **QA memory storage**, scheduled jobs/presence jobs/realtime disabled, synthetic accounts, and a warm local server. They do **not** measure PostgreSQL, Railway startup, CDN delivery, or production capacity. Existing local production-mode build flags have Supabase realtime, Sentry, and product analytics disabled; sanitized flag presence is recorded in `build-profile.json`.
- No Android device/ADB or installed-app runtime was available. Phone results are Chromium viewport/CPU/network **emulation**, not Android GPU, battery, thermal, TWA, or WebView evidence. A PWA manifest exists, but that does not establish the user's installed runtime.
- Each candidate has a separate before/after experiment. The navigation baseline predates the Village event change; it is not a clean-checkout-versus-final-release comparison of all changes at once. The initial build failed on a pre-existing test import type error. A test-only deferred CommonJS import repair made that test's eight behavior cases pass and allowed compilation.
- This team's builds and broad tests were held during timing windows. The user subsequently confirmed concurrent model-authoring work in the shared workspace, so this was **not an isolated laboratory host**. Preserve the deterministic request/read/byte counts as the strongest findings; observed latency differences and tails have that additional attribution limit.

Sanitized machine-readable evidence, screenshots, source snapshots, and logs are in ignored **`test-results/performance-gauntlet-2026-09-16/`**. No tokens, production saves, or private request bodies are included. Do not commit the large artifact directory or generated `dist/`.

## Evidence-backed work queue and implemented changes

| Classification | Journey and exact owner | Evidence / cause | Change and correctness protection |
|---|---|---|---|
| MEASURED BOTTLENECK | Village browsing, `screens/Village.tsx` facility buttons | Hover/focus over unactivated facilities starts 108 optional JS/CSS requests, including on a save-data connection. | Remove speculative hover/focus imports; preserve activation loading, click navigation, focusability, layout, and artwork. Verify cold first entry and keyboard/touch use separately. |
| MEASURED BOTTLENECK | Pet match preparation, `lib/pet-glb-atlas.ts::loadEmbeddedAtlas` | Atlas extraction uses a separate fetch while GLTFLoader downloads the same revisioned GLB. | Use the installed Three FileLoader's concurrent request sharing. Same arraybuffer/credentials; no global raw-byte cache; same atlas parsing, images, rig, and fallback. |
| MEASURED BOTTLENECK (synthetic storage) | Shared game-state frame, `api/game-state.ts` / `village/_membership-reader.ts` | 52 membership checks deserialize full saves to read only `character.village`. | Batch fresh projections in three dependency waves. No save-result cache; compatibility stores and malformed legacy records retain fallback semantics. Election resolution, mutations, locks, and authority callers continue using their original readers. |
| VERIFIED CODE RISK, reproduced | Poll cache invalidation, `api/_proc-cache.ts::cachedFor` | An invalidated old builder can republish old data or delete a newer in-flight request, causing duplicate work. Four controlled interleavings failed. | Register the promise before invoking its builder; only the current promise may publish or retire its slot. Existing callers still receive their own results; TTLs and response contracts are unchanged. |
| VERIFIED CODE RISK, reproduced | Repeated pet entry, `lib/pet-model-preload.ts::warmShowdownModels` | Successful warmups leave the eight-second fallback timeout scheduled. | Clear the owned timer in `finally`; never abort shared model work or change the eight-second fallback. |

The following existing paths were inspected and retained: parallel save/battle-lock restoration with session guards; lazy optional screens; startup exclusion of Three; Sentry deferral; conditional mobile CSS; runtime-only public packaging; bounded service-worker caches; immutable hashed assets versus revalidated HTML; roster/session cleanup; and existing bone-texture disposal. There is no evidence here supporting a framework change, new global client cache, broad memoization, asset-quality reduction, database index migration, or game-logic rewrite.

The active persistence implementation is the `public.kv_store` JSONB path with a reused PostgreSQL pool plus compatibility storage adapters. The new projection reader uses that existing abstraction. No credentials or representative database were available for query-plan, lock-wait, or pool-saturation measurements. Process-local poll caches remain short-lived display data, not durable or globally authoritative game state. Their existing single-process deployment constraint is unchanged.

Rendering review covered the pet stage's frame loop, adaptive DPR/shadows, animation ownership, and scene disposal. No frame-rate or React-commit improvement is claimed: production React profiling and physical-device GPU measurements were unavailable. Shared pet atlas/parsed model caches retain their existing ownership. Cache eviction or parser-readiness changes would require separate evidence before disposing resources that mounted pets may still use.

The startup waterfall still contains eager CSS backgrounds below the fold, while feature `<img>` elements already use native lazy loading. This is a remaining **UNVERIFIED HYPOTHESIS** for startup contention, not a proven cause of the measured mobile delay. Main visual loading, image quality, fonts, authored timing, and CSS layout were preserved. The server's measured gzip responses, immutable hashed-asset headers, revalidated HTML, private API headers, and existing service-worker limits were not changed. Service-worker update/offline behavior itself was not browser-benchmarked here.

## Measurements

### Pet transport and warmup ownership

Five cold unique URLs, loopback HTTP, installed Three FileLoader, and a real **437,752-byte Oni Hound GLB**:

| Metric | Before | After | Absolute / relative change |
|---|---:|---:|---:|
| HTTP GETs per model | 2 | 1 | −1 / −50% |
| Response-body bytes per model | 875,504 | 437,752 | −437,752 / −50% |
| Outstanding fallback timers after 20 completed warmups | 20 | 0 | −20 / −100% |

The transport experiment stubs HTML image completion; it does not measure browser image decode, GLTF parse completion, shader compilation, or usable battle entry. Local timing was noisy (median 16.885→13.433 ms, maxima 93→128 ms); **no latency improvement is claimed**. The atlas now follows normal HTTP cache freshness instead of `force-cache`; actual server media headers are preserved. Parsed/atlas caches remain existing shared resources. The preload function still does not await GLTF parser completion, so complete model readiness remains a follow-up.

Evidence: `pet-model-preload-before.json`, `pet-model-preload-after.json`, `pet-warmup-timer-before.txt`, `pet-focused-after.txt`, `pet-findings.md`. Tests cover either load order, progress, abort/error retry, revision separation, shared resources, 145 roster GLBs, 20 disposal cycles, and the unchanged timeout deadline.

Post-change real-browser checks selected the existing desktop and phone projects from the seven-project Warfront configuration and targeted lifecycle/cold-readiness/failure scenarios. They passed **four applicable cases**, with two existing phone-inapplicable cases skipped by the original suite. Desktop and phone resource tests each collected **40 settled samples** over six fighter-replacement/quality/retire/remount cycles: active **18 textures / one geometry**, retired **two / one**, remounted **18 / one**; low quality **10 / one**, freeze/resume **18 / one**, and the sixth generation still **18 / one**, with zero page errors. The controlled canvas is 320×180 at DPR 1, so this is ownership/recovery evidence, not device GPU capacity. Cold entry revealed all eight actual rigs together; a real GLB 404 recovered through the supported fallback. All four success screenshots were inspected. No matched pre-change 3D PNG was retained, so no pixel-diff fidelity claim is made. Evidence: `pet-browser-results.json`, `pet-browser-resource-summary.json`, and `pet-browser/`.

A separate bounded context-loss check passed **2/2** on desktop Chromium's **ANGLE SwiftShader software renderer**, using the unchanged compiled pet snapshot. Native restoration produced one loss and one restore event on the same canvas; the playback tick stayed at 2.65 for 11 lost-state samples, then advanced again, with eight actors present. That case used the existing `model-impostor` adaptive route. With native restoration withheld, the supported recovery replaced the disconnected canvas with a ready eight-actor `skinned-3d` canvas; the tick stayed at 2.75 for 75 lost/recovering samples and then resumed. This verifies the shared recovery guard, not native in-place restoration of every fully skinned route or physical-device recovery. Earlier harness attempts timed out before triggering loss because they assumed a persistent skinned-renderer selector; their evidence is retained and excluded from product results. No renderer, quality setting, model, or recovery code was changed for this experiment. Both recovery screenshots were inspected; evidence is in `context-recovery-v3-results.json`, `context-recovery-v3-browser/`, and `pet-findings.md`.

### Membership reads

Seven samples per version; four villages, 52 populated seats/saves, 128 KiB synthetic padding per save; cold frame cache, current councils/public index; simulated pool of 15 connections and 2 ms per read. This is a **mocked-storage handler benchmark**, not an end-to-end/database timing:

| Metric | Before | After | Absolute / relative change |
|---|---:|---:|---:|
| Membership read calls | 52 full-save reads | 3 projected batches | −49 / −94.2% |
| Serialized membership read bytes | 6,826,418 | 1,693 | −6,824,725 / −99.975% |
| Handler median | 49.095 ms | 30.558 ms | −18.537 ms / −37.8% |
| Handler min–max | 34.722–55.887 ms | 14.821–33.792 ms | descriptive spread; no p95 claim |

The response payload hash is identical. Production latency and representative PostgreSQL query plans are **UNMEASURED**. Missing/deleted/moved members, replacement earned seats, legacy fallback, read failure/retry, and fresh subsequent checks are tested. Evidence: `game-state-membership-before.json`, `game-state-membership-after.json`, and `proc-cache-and-membership-after.log`.

### Village navigation: before/after

Five samples per journey/profile/version, **20 before + 20 after**, through compiled Express static delivery with deterministic API fixtures. HTTP caching is disabled by routing; warm entry means same-document module reuse. Both desktop pointer sweeps and mobile keyboard/switch focus traversal were measured without activating a destination.

| Metric | Before median [min–max] | After median [min–max] | Absolute / relative change |
|---|---:|---:|---:|
| Optional JS/CSS requests during unactivated sweep, either profile | 108 [108–108] | 0 [0–0] | −108 / −100% |
| JS/CSS Resource Timing transferred bytes during sweep, either profile | 582,790 [582,790–582,790] | 0 [0–0] | −582,790 / −100% |
| Desktop JS execution during sweep | 62.061 ms [43.880–76.565] | 16.652 ms [14.226–19.463] | −45.409 ms / −73.2% |
| Emulated mobile JS execution during sweep | 252.007 ms [234.384–257.277] | 8.905 ms [6.906–13.067] | −243.102 ms / −96.5% |
| Desktop direct cold Bank entry | 433.8 ms [395.9–458.6] | 430.1 ms [423.1–447.8] | −3.7 ms / −0.9%; effectively neutral |
| Emulated mobile direct cold Bank entry | 674.2 ms [638.9–689.5] | 584.6 ms [569.1–614.0] | −89.6 ms / −13.3%; local observation |
| Desktop same-document warm Bank entry, direct-entry branch | 110.4 ms [88.7–156.0] | 129.6 ms [79.0–138.0] | +19.2 ms / +17.4%; overlapping ranges |
| Emulated mobile same-document warm Bank entry, direct-entry branch | 290.3 ms [282.1–316.4] | 191.6 ms [180.2–210.9] | −98.7 ms / −34.0%; local observation |

The cold Bank route still downloads three JS/CSS resources, **5,837→5,836 transferred bytes**; feature loading was not removed. After browsing, those bytes now arrive on activation instead of being among the 108 speculative requests. First Bank entry after the sweep was 473.3→430.7 ms desktop and 637.5→629.5 ms mobile, with overlapping spreads. Heavy deferred routes are covered by correctness tests, but their first-usable-action latency is **UNMEASURED** here. The bandwidth saving is the strong conclusion; these samples do not establish a universal navigation latency gain.

Each run also completed a **12-cycle Bank/Village loop** per profile, collecting after GC. Documents stayed at one, DOM node counts were equal at the start/end of each loop, and event listeners did not increase. Retained JS heap rose approximately 0.6 MiB within the loop both before and after; one window does not prove a heap plateau or an unbounded leak. Desktop/mobile before/after Village and Bank screenshots were inspected: geometry, artwork, text, and controls matched, apart from time-dependent animation/countdown state. No screenshot baseline was rewritten.

Evidence: `navigation-before-complete/` and `navigation-after/` contain raw resource timings, gzip response-encoding observations, summaries, screenshots, and resource counters. Earlier partial `navigation-before/` is an invalid harness-development run and is excluded explicitly.

### Startup and returning sessions

The real-handler startup harness completed **40 before + 80 after journeys**, with five baseline and ten final observations per profile/journey. The first after run had wide tails, so a second complete five-sample run was collected; **all observations were retained**. Both returning journeys submit a one-ryo deposit, validate the server response/version, wait for its displayed confirmation, and read the canonical local save. All **20 before + 40 after** save checks passed; no captured page/network errors occurred. This proves local memory-store reconciliation, not PostgreSQL durability. Account registration/seeding happens outside the measured returning journey. First-time onboarding duration is not measured.

| Profile and readiness milestone | Before median [min–max], ms (n=5) | After median [min–max], ms (n=10) |
|---|---:|---:|
| Desktop cold landing → usable password login form | 414.0 [391–469] | 575.6 [419–768] |
| Desktop warm landing → enabled create control | 114.3 [103–132] | 105.3 [80–145] |
| Desktop returning restore → first Bank deposit verified | 895.7 [844–910] | 730.4 [413–965] |
| Desktop warm Bank reload → deposit verified | 342.4 [339–371] | 302.9 [247–412] |
| Mobile cold landing → usable password login form | 4,999.9 [4,944–5,048] | 4,766.3 [4,522–8,493] |
| Mobile warm landing → enabled create control | 731.4 [686–1,209] | 700.2 [612–912] |
| Mobile returning restore → first Bank deposit verified | 3,778.8 [3,746–3,838] | 3,831.3 [3,550–5,288] |
| Mobile warm Bank reload → deposit verified | 1,338.6 [1,303–1,420] | 1,228.8 [1,095–2,376] |

**No broad startup improvement is established.** Desktop cold readiness has an observed median regression (+161.6 ms, +39.0%), and several after tails are worse even where medians are lower. The cause of that variability is unresolved; it must not be erased by selecting the faster repeat run. The implementation does not materially reduce the initial dependency graph. The constrained cold-landing LCP is **4,580→4,410 ms median**, with final range **4,276–8,200 ms**; it still misses the 2.5-second reference. These are lab observations, not field p75 results or a causal startup-speed claim.

Actual cold-landing JS/CSS CDP transfer was **441,317→441,254 B desktop**, **448,728→448,665 B mobile**; warm documents use **1,157 B** in both versions. Returning cold-feature documents transfer **182,396→182,385 B** of JS/CSS. These small differences are effectively neutral. The fixed three-second post-readiness window can cancel/omit unfinished images on subsequent navigation, so its all-resource byte totals are windowed measurements, not the complete media catalog.

Observed non-input layout-shift totals stay below **0.041** after. Recorded interaction-event durations reach **120 ms** at most across the final sampled interactions; warm landing has no qualifying interaction and is **UNMEASURED**, not zero-latency. This diagnostic is not INP. Long tasks, script/task durations, request encodings/cache headers, acknowledgments, rendered action times, and missing-LCP observations are retained in raw results and generated summaries; no React-commit or frame-time claim is made.

Evidence: `startup-before/`, `startup-after/`, `startup-after-repeat/`, and the non-filtered `startup-after-combined/`. Their metadata records manifest hashes, profiles, limitations, and cache conditions. Retained schema-1 raw records call the local save check `durable`; the schema-2 harness now names it `canonicalLocalSaveVerified`, and the summarizer accepts both without implying database durability. Startup results are a control around the final rebuild, not attribution of every change to a clean-checkout release baseline; each claimed optimization has its separate experiment above.

The initial dependency graph is **1,437,591 B raw before and after**, with **380,856→380,852 B computed gzip across nine files**; these build-size values are not measured network transfer. All-product JS/CSS is **8,447,622→8,447,834 B raw**, including lazy product chunks. This is neutral for bundle size. Existing size gates pass without modification; runtime distribution is **481.8→485.2 MiB**, including the preserved concurrent model changes, with no authoring sources.

### Bounded local soak

An isolated post-change run used the existing `scripts/load-soak.mjs` with **24 synthetic players, 30 seconds, a three-second ramp, and loopback port 28622**, supervised by a 180-second outer deadline. All 24 accounts provisioned; the loops drained over 41 seconds. **463 calls, zero unexpected errors**: 197 autosaves (173 HTTP 200, 24 expected version-conflict 409s), 146 heartbeats, 72 save reads, 24 reward claims, and 24 successful conflict refetches. The local health-probe median was 17 ms. The existing harness passed its original thresholds. This is post-only local memory-storage stability evidence, not a before/after capacity or database-performance improvement. Raw endpoint distributions and harness diagnostics are in `local-soak.log`.

The existing archive navigation resource test also passed on all four Chromium viewport projects. Each collected **two 20-cycle windows**: documents stayed at one; node counts stayed at 2,273 desktop / 2,254 compact, phone and tablet; live elements stayed at 613 / 614; listeners were unchanged or decreased. Retained JavaScript heap rose **112,044–158,740 bytes in the second window**. This is a bounded retention check under the original assertions, not proof that heap growth plateaus indefinitely or that unrelated modes cannot leak. Per-project `archive-resource-cycles.json` files and `final-gate-summary.json` retain the raw counters.

### Regression gates

A verified official portable **Node 22.23.1** was acquired for the repository's pinned-major regression checks; it does not change application dependencies or the Node 24 benchmark environment. Its checksum and download source are recorded in `environment.json`; the local binary is `.tmp/performance-node-22.23.1/node.exe`.

| Gate | Command / execution | Outcome and evidence |
|---|---|---|
| Full build | `npm run build` (Node 24) | **PASS**: server/client TypeScript, production Vite build, legal prerender, `verify:dist`, and size checks; no budget changes. |
| Deployment configuration | `node scripts/check-deployment-config.mjs` (`check:deployment`) | **PASS**; `deployment.log`. No deployment executed. |
| Release assets | `node scripts/check-release-assets.mjs` (`test:release-assets`) | **PASS**: 135 achievement references, 235 badge WebPs, 21 Pet Home WebPs; `release-assets.log`. This gate is narrower than roster hash/size approval. |
| API regression subset | Node test runner with `tsx`, cache/membership/game-state tests | **37 passed**; `proc-cache-and-membership-after.log`. Four cache race cases were reproduced failing before the fix. |
| Pet regression subset | Node test runner with `tsx`, atlas/preload/resource tests | **13 passed**; `pet-focused-after.txt`. Touched pet lint also passed. |
| Initial compiler blocker repair | Node test runner with `tsx`, `api/pet/showdown.colosseum.test.ts` | **8 passed** after the test-only import repair. |
| Complete root unit suite | `node --import tsx scripts/run-tests.mjs` (the `test:ci` body, Node 22) | **FAILED**: 10,621 passed, four failed, seven skipped; attribution below. |
| Complete client lint | `npm --prefix shinobij.client run lint` | **FAILED (baseline)**: same three errors and 15 warnings before/after; attribution below. |
| Selected real-browser pet lifecycle/readiness | `playwright test --config playwright.pet-verification.config.mts` | **PASS**: four applicable cases, two original project-specific skips; resource/readiness evidence above. |
| Bounded WebGL context recovery | `playwright test --config playwright.context-recovery.config.mts` (corrected harness, retained v3 results) | **PASS**: two cases, no retries; 38 seconds. Native restore and clean-canvas rebuild under software graphics, with limitations above. |
| Complete responsive matrix | `playwright test --config playwright.responsive-verification.config.mts` | **FAILED**: 642 passed, 531 original project/opt-in skips, one failure, zero retries/flaky cases; 34.0 minutes. Mobile-map attribution below; `responsive-results.json`. |
| Complete mobile gauntlet | `playwright test --config playwright.mobile-verification.config.mts` | **FAILED**: 255 passed, 68 original skips, two World Map touch-target failures, zero retries/flaky cases; 11.9 minutes. `mobile-results.json`; attribution below. |
| Complete strict combat layout matrix | `COMBAT_LAYOUT_STRICT=1`, capture phase `after`; `playwright test --config playwright.combat-verification.config.mts` | **PASS**: 20 passed, ten original project-specific skips, zero retries/failures; 21.2 minutes. `combat-layout-results.json`, `combat-layout-captures/after/`. |
| Selected real Express journeys | `playwright test --config playwright.live-verification.config.mts` | **PASS**: five passed, three original mobile skips, no failures/retries; 2.8 minutes. `live-results.json`. |
| Complete visual suite | `playwright test --config playwright.visual-verification.config.mts` | **PASS**: nine cases, no failures/retries; 19.7 seconds. Existing golden images retained; `visual-results.json`. |

Browser wrapper configs and sanitized Node-22 launchers live in the evidence directory. Playwright commands in the table abbreviate the exact pinned-Node CLI and absolute config paths recorded in those launchers. Original assertions, per-test timeouts and retries are retained; ports and artifact directories are separate; traces are disabled only for synthetic authenticated live sessions. Complete project matrices are preserved for the responsive, mobile, strict combat and visual suites. The pet gate selects two projects/scenarios as described above, retains original per-test limits, and does not set a global timeout. The responsive/strict combat wrappers have 60-minute overall bounds, mobile/live 30 minutes, and visual 15 minutes. The complete responsive suite uses two workers. The selected live Express gate contains `first-session-onboarding-express.spec.ts`, `server-route-smoke-express.spec.ts`, and `village-stores-express.spec.ts` on both original projects. It is not represented as the entire live suite.

The live gate actually exercised desktop Academy onboarding with both immediate and 500 ms delayed starter responses, desktop cooking into server-held Provisions/Materials, and API alias/CORS/JSON-error behavior on both project configurations. Its original guards skip onboarding/cooking on mobile; those are not claimed as mobile real-handler coverage. The independent startup harness did verify mobile returning-session Bank deposits against local authoritative saves. Visual checks covered desktop/compact/mobile landing sections, creator entry and the authenticated Central Hub; all passed against the retained goldens. Hash checks confirm all **19 existing golden files** are unchanged, with none added; both lockfiles and the branch/commit also remain unchanged.

Strict combat coverage includes Solo, PvP and Tower on Chromium DPR 1, 1.25, 1.5 and 2, Firefox and WebKit, plus Chromium party-MPvE and MPvP. It retains server action/receipt checks, jutsu-selection geometry, and original viewport/zoom assertions. Desktop and phone capture inspection found readable HUDs, targets, action trays and artwork. These are final-state geometry/behavior checks, not a fabricated before/after combat pixel comparison.

The responsive failure is `world-map-mobile.spec.ts:313`, after returning from a sector to the atlas: the Death's Gate chip measured **43.99993896484375 CSS px** against an unchanged **44 px** minimum. The trace places the previous click over that remounted chip, whose fractional offset is consistent with its existing hover translation; the other five chips are exactly 44 px, with no clipping or overlap. `WorldMap.tsx` and its zoom hook match the starting dirty blobs; this failure occurs before Village activation and uses API fixtures. This is strong evidence of an **existing timing/rectangle-precision issue**, but no pre-change execution proves baseline failure. One focused rerun against the same immutable build passed **1/1 without retries or source/assertion changes**. That rerun does not erase the full-suite failure. Evidence: `browser-failure-audit.md` and the retained responsive trace/recheck results.

The dedicated mobile suite's two failures are a **distinct, reproducible existing sizing defect** in `non-combat-ui-audit.spec.ts`'s World Map case. At 430×932 and 844×390, five village landmark controls measure approximately **43.9725 px** and **43.95494 px**, respectively, below the same 44 px minimum. The existing zoom hook rounds its inverse marker scale with `toFixed(3)`; multiplying that rounded inverse by the map scale explains the undersize. Diagnostics record zero active ancestor animations. Both the hook and test match their starting dirty blobs, and both focused original-assertion reruns reproduced the dimensions on the unchanged immutable build (**two failed, no retries**). No map code or test tolerance was changed. Evidence: `browser-failure-audit.md`, `mobile-map-recheck-results.json`, and both runs' touch-target diagnostics.

The full `test:ci` body (`node --import tsx scripts/run-tests.mjs`, all discovery roots, no shards) completed in **791.914 seconds**: **10,632 tests; 10,621 passed; four failed; seven skipped; zero cancelled**. Full unit validation therefore remains **FAILED**, with these distinct causes:

1. The settlement-gate source assertion expects the old inline `sectorAttackPlayer` callback in `App.tsx`. Its replacement is already present in `starting.patch`, and the current App blob exactly matches the starting dirty blob: a **proven baseline assertion mismatch**.
2. The modal escape-hatch contract rejects `StrongholdDialog`'s `disabled={busy}` close control. That unrelated file was already untracked at the start and has an earlier modification time. It was not edited here, but no full initial content snapshot exists: **outside this pass / likely baseline**, not independently proved byte-for-byte.
3. The pet roster check rejects `legendary-1.glb`'s hash at test time against the approved manifest.
4. The Warfront asset check rejects the same GLB's **1,188,268 bytes at test time** against the unchanged **1,048,576-byte (1 MiB)** budget. This asset was initially clean (HEAD size **536,068 bytes**) and changed during the task. The user explicitly confirmed **intentional concurrent model work and instructed that it be preserved**. These two failures are **concurrent asset-work issues**, not pre-existing baseline failures. No source model, manifest approval hash, or size limit was changed to hide them. The assertion stops at the first oversized model and does not certify later models.

The unit-run profile, exact diagnostics, initial-state comparisons, and model drift inventory are retained in `root-tests-node22.log`, `root-tests-node22-profile.json`, `root-tests-node22-exit.json`, and the failure-attribution artifacts. Both lockfile hashes remain identical to the start. Future release certification must include the completed concurrent model work; this pass does not certify those outstanding model changes.

The full client lint baseline and final run both report the identical **three pre-existing `no-explicit-any` errors in `scripts/fixtures/stronghold-qa.tsx` (22, 27, 34) and 15 warnings**. Full lint therefore remains **FAILED (baseline)**. This unrelated fixture is preserved. No lint rules or assertions were weakened. The touched pet source/test lint subset passed; no new full-lint diagnostics were introduced. Evidence: `client-lint.log` and `client-lint-final.log`.

## Outcome by area and remaining work

| Area | Supported outcome | Limits / next evidence needed |
|---|---|---|
| Initial load | **Mixed; no improvement claim.** Initial code bytes neutral; desktop cold readiness median regressed and mobile tails widened. | Mobile cold LCP remains above target. Attribute initial main-thread/image contention before changing the critical graph or below-fold backgrounds. |
| First deferred-feature visit | **Bank neutral desktop / lower observed mobile median.** Still three feature resources; no eliminated readiness requirement. | Complete first-action timings for combat, Showdown, pet 3D, Echoes/VN, bosses, festivals, collections and breeding remain **UNMEASURED**. Functional coverage is distinct from a speed measurement. |
| Repeated navigation | **Less unnecessary work.** Unactivated facility traversal avoids 108 requests / 582,790 transferred bytes. Mobile Bank warm samples are lower; desktop warm samples are mixed. | No universal transition-speed claim; preserve cold-entry validation for heavier deferred modes. |
| API work | **Improved in synthetic storage evidence.** 52 full saves become three fresh projection batches with identical public response. Invalidation races no longer publish obsolete frames or erase current flights. | Actual database latency, query plans, replica behavior, and production lock waits remain **UNMEASURED**. No migration is justified by these results. |
| 3D scenes | **Transport work improved.** Concurrent GLB acquisition drops 50%; successful warmups leave no fallback timer pending. Bounded lifecycle/fallback and software WebGL recovery checks pass. | Frame pacing, GPU time, shader compilation, full rig-ready timing, native in-place fully skinned restoration, and physical Android remain **UNMEASURED**. Do not infer FPS from fewer bytes. |
| Long sessions | **Timer cleanup improved; navigation DOM/listener retention neutral.** Twelve navigation cycles and the bounded local soak completed. | The retained heap delta does not prove a leak or a whole-game plateau. Longer play, reconnect/account switching under real services, installed-app suspend/resume, thermal behavior and battery need their own environment/evidence. |

Existing responsive/functional suites cover many listed screens and recovery paths using fixtures; the local live suites exercise real handlers where specified in the gate results. Neither substitutes for an end-to-end timing distribution on every gameplay journey. Real Android/installed-runtime validation is blocked by absent hardware/runtime; database and staging validation require a representative approved non-production service. No production work or new infrastructure is required to use these changes. Deployment remains a separate approved action; no schema migration was created.

## Changed files and obsolete work removed

- `api/game-state.ts`, `api/village/_elder-council.ts`, and new `api/village/_membership-reader.ts`: scoped fresh display projections; behavior tests in `_membership-reader.test.ts` and `game-state.performance.test.ts`.
- `api/_proc-cache.ts` and `_proc-cache.test.ts`: replacement-flight guards and the four invalidation regressions.
- `shinobij.client/src/screens/Village.tsx` and new `e2e/navigation-preload.spec.ts`: remove the two speculative hover/focus handlers; verify keyboard/pointer/touch activation without prefetch.
- `shinobij.client/src/lib/pet-glb-atlas.ts`, `pet-model-preload.ts`, and new `pet-glb-atlas-loading.test.ts` / `pet-model-preload.test.ts`: remove duplicate native fetch acquisition and clear the superseded fallback timer.
- `api/pet/showdown.colosseum.test.ts`: test-only deferred-import compatibility repair for the starting compilation failure.
- Reproducible measurements: `scripts/benchmark-game-state-membership.mjs`, `scripts/measure-pet-model-preload.mts`, `scripts/summarize-startup-benchmark.mjs`, and `shinobij.client/scripts/benchmark-{startup,navigation-preload}.mts`.

No asset, authored content, dependency, combat rule, API validation, migration, service worker, or budget was deleted or weakened. Unrelated worktree changes are retained.

For review in this heavily changed workspace, `performance-pass-only.patch` contains an explicit **20-file allowlist**: nine modifications against retained pre-edit copies and eleven files added by this pass. It excludes existing App/layout work, models, manifests, lockfiles, and generated output. Its file list, numstat and SHA-256 manifest accompany the patch; `generate-review-patch.mjs` regenerates it from current source and validates application against disposable baseline copies without touching the Git index. This is a review artifact, not a patch to reapply onto the already modified working tree.

## Reproduction

Run from the repository root with installed lockfile dependencies. Local Windows sandbox restrictions may require permission for Node test workers, the installed build tools, and Chromium subprocesses. Do not substitute a production URL.

```powershell
npm run build
node scripts/verify-dist.mjs
node scripts/check-build-size.mjs
node scripts/check-deployment-config.mjs
node scripts/check-release-assets.mjs
node --import tsx scripts/benchmark-game-state-membership.mjs --output=test-results/performance-gauntlet-2026-09-16/membership-repeat.json
node scripts/measure-pet-model-preload.mts test-results/performance-gauntlet-2026-09-16/pet-model-repeat.json
node --import tsx shinobij.client/scripts/benchmark-navigation-preload.mts --label repeat --output test-results/performance-gauntlet-2026-09-16/navigation-repeat
node --import tsx shinobij.client/scripts/benchmark-startup.mts test-results/performance-gauntlet-2026-09-16/startup-repeat
node scripts/summarize-startup-benchmark.mjs test-results/performance-gauntlet-2026-09-16/startup-repeat
```

The navigation harness uses deterministic API route fixtures, which disable Chromium's HTTP cache. It distinguishes cold module entry from same-document module reuse and records actual response encodings/Resource Timing bytes. Its phone profile uses 390×844, touch, save-data, 4× CPU slowdown, 40 ms latency, 1.6 Mbps down and 750 kbps up. The startup harness uses real local handlers and synthetic authenticated saves with HTTP caching enabled, separates cold/warm documents, blocks service workers/external hostname resolution, and verifies a Bank action against authoritative local state. Neither makes a field-INP claim.

Web reference targets remain LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 at field p75. Five local samples establish neither field certification nor reliable p95. Keep existing build/transition assertions; no universal API/FPS budgets or promised percentage improvements are introduced.
