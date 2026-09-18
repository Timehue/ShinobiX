# Goal-directed Activity Spine

Implemented against `2f8b49bf3675cc29e5bd5b4ac067de78282e57d2` on September 18, 2026. The supplied reference (`335ef32865eccbb72702489cee79af410c5e6d9b`) was not checked out. Unrelated working-tree work was preserved.

## Verified baseline and preference behavior

The existing panel already contained Now, up to three Today cards, This Week and Long Term, with recovery/Academy/run/training/growth/exam/returner priorities. Ordinary Now still became a generic mission regardless of focus. Supply advice inferred preparation from level, companion advice relied on pet count, card advice on deck length, and tower advice could imply an unpublished or locked next floor. Legacy and Ranked buttons also needed more precise destinations.

The current product intentionally has **Auto only**. Commit `9d5770654` removed the selector and its saved-focus request wiring; `ActivitySpine.capability.test.ts` and `product-truth-player-focus.spec.ts` preserve this choice. This change keeps the real client request at `focus=auto`. The existing API still accepts a normalized explicit query focus and falls back to saved `character.masteryFocus` when the query is omitted, for compatible clients/saves. Unknown values use the shared normalizer. No preference is written, and `selectedFocus` stays distinct from capability-adjusted `resolvedFocus`. Explicit-focus browser cases use API fixtures, not an invented selector.

## Resulting recommendations

| Player state | Before | Now |
| --- | --- | --- |
| Next published chapter available | Generic mission | Open the next chapter through Story Hall; only completed/total progress is shown |
| Below the next chapter level | Generic mission | Train toward the actual requirement, or review growth if training is running; real exam holds still take precedence |
| Clan focus without membership | Generic mission; later membership block | Usable Clan Hall prerequisite, with solo play explicitly optional |
| Clan operation exhausted or finished | Generic mission / repeated operation | Review the Clan Hall rather than advertise another assault |
| Companion roster away, breeding, training or overflow only | Generic mission / count-based battle advice | Manage carried companions in Pet Yard |
| Usable carried companion | Generic mission | Optional practice, explicitly promising no XP, ranked progress or items |
| Forty-card illegal or unowned deck | Generic mission / count-based readiness | Card Hall → Deck, with an enabled preparation button |
| Legal deck and unlocked codex | Generic mission | Card Hall → Play |
| Accepted Legacy with a revealed mission objective | Generic mission | Missions with actual progress relative to the sealed trial baseline |
| Legacy information, other objective, ready claim or completed path | Hall of Legends | Profile → Legacy, with honest review/claim guidance and no automatic acceptance |
| Profession selected | Generic mission | Existing profession hub, explaining that costs and cooldowns must be checked |
| Recipe not affordable | Implied supply readiness | Central Hub → Crafter, labeled Review Recipes |
| Authoritative active run / recovery | Existing priority | Preserved ahead of discretionary focus; unavailable runs remain recovery-only |

Each immediate action is deterministic. Today excludes the same screen/section as Now, does not invent timer work, and can be empty during a pause. Navigation itself never starts a battle, crafts, joins a clan, claims a reward, assigns growth or accepts a Legacy. Section requests also work when the briefing is opened over an already mounted destination; later manual tab choices remain intact. Endless Tower recovery retains its own destination and does not relabel the separate Battle Towers weekly review as a resume action.

## Readiness authorities

| Domain | Authority used |
| --- | --- |
| Story | `STORY_LEVELS`, published village map and `storyBossEligibility`; unknown progress/village becomes a Logbook review |
| Progression | Existing `progressionHoldForCharacter`; finished training and growth remain higher priorities |
| Ranked | `ATTACKABLE_MIN_LEVEL`, rollout predicate, parsed season admission authority/current season, existing incapacitation rule; no invented loadout/power requirement |
| Clan | Existing week, progress, attempts, party and sector helpers; guidance uses a read-only party lookup so stale pointers are not cleaned up by a GET |
| Tower | Published `FLOOR_CATALOG`, `storyTowerEligibility`, cleared-floor and fee helpers, mode flag; lobby still verifies daily admission/squad rules |
| Companions | `activeCarriedPets` and the exact extracted Showdown busy predicate; practice does not borrow unrelated defense/PvE assignment locks |
| Chronicle cards | Shared `validateDeckIds` plus owned collection counts, canonical starter latch/unlock and fixed deck rules |
| Legacy | Existing minimum, accepted stage, `nextTrialKind`, sealed trial/baseline and `trialProgress`; direct reads avoid stats bootstrap writes |
| Profession | Shared `PROFESSION_CHANGE_LEVEL`, recognized saved role; dynamic resources/cooldowns remain an honest hub review |
| Supplies | Immutable `applyForge(character, 'supply', 'item-smoke-bomb', 1)` decision; the returned save is discarded |
| Capabilities | Existing public capability projection, exact required IDs, live freshness and click-boundary checks |

The actual action endpoints remain authoritative and revalidate. Guidance is a snapshot, not an admission token. Ranked availability never guarantees an opponent. Missing domain facts never prove roster, deck, chapter, recipe or queue readiness. Malformed breeding, inventory and Legacy counters fail conservatively without crashing the entire panel or fabricating trial completion.

## Files and integration

- `api/player/_activity-spine.ts`: deterministic immediate recommendations, honest longer horizons, Auto selection and compact Today; superseded generic mission branch removed.
- `api/player/_activity-spine-facts.ts`: save-derived facts and at most two selective reads for Ranked or active Legacy.
- `api/player/activity-spine.ts`: authenticated authoritative integration; solo requests avoid the irrelevant clan-week read.
- `api/pet/_showdown-readiness.ts`, `api/pet/showdown.ts`: extracted identical pure admission predicate, shared with guidance.
- `api/clan-boss/_party.ts`: optional read-only lookup; existing mutating callers retain their behavior.
- `api/profession/choose.ts`: use the existing shared unlock constant without changing its value.
- `shared/activity-spine.ts`: optional narrow destination-section hint.
- `shinobij.client/src/lib/activity-spine-navigation.ts`, `use-activity-section.ts`: typed screen allowlist, one-shot StrictMode-safe section hints, and a validated notification for an already mounted destination.
- `CardHall.tsx`, `CentralHub.tsx`, `Profile.tsx`, `ClanHall.tsx`: open the existing Deck/Play, Crafter, Legacy/Stats and Clan Boss sections, including navigation within the current screen.
- `activity-spine-source.ts`, `use-activity-spine.ts`: bounded relevant-state key, coalesced save-version invalidation, cancellation and account/source isolation.
- `ActivitySpine.tsx`, `DailyBriefingModal.tsx`, `LeftProfileCard.tsx`: existing panel integration and training-boundary invalidation, preserving loading/error/offline/retry and accurate resolved-focus analytics.
- Colocated guidance, handler, navigation and capability tests plus `e2e/activity-guidance*.spec.ts` and their isolated harness/runtime option: selection, read-only authority, actual navigation, mobile, freshness and safety coverage.

No polling or per-card request was added. HP/stamina/chakra ticks do not change the source key. Relevant authoritative character adoption, successful mutation receipts, training completion boundaries and capability changes refresh the single panel request. Full-save acknowledgments only correct a changed source once, so unchanged periodic saves do not create a loop. Old or aborted responses cannot commit over a newer account/source; failed refreshes do not expose previous readiness as current.

## Measured impact

Both handlers were measured against the same local in-memory, authenticated fixture save, using the original HEAD handler/selector and the implementation. Save writes were prohibited. The Legacy case had an accepted path; Ranked admissions were enabled. These are solo-player counts, excluding network authentication and clan-specific reads that depend on the existing account state.

| Focus | Reads before → after | JSON bytes before → after |
| --- | --- | --- |
| Auto / available story | 5 → 4 | 2,636 → 2,630 |
| Companions / empty roster | 5 → 4 | 2,831 → 2,898 |
| Chronicle / not yet unlocked | 5 → 4 | 2,725 → 2,755 |
| Profession / unselected | 5 → 4 | 2,649 → 2,610 |
| Legacy / accepted path | 5 → 6 | 2,679 → 2,705 |
| Ranked / season review | 5 → 6 | 2,678 → 2,879 |

The scoped minified browser guidance bundle increased from 3,737 to 6,529 bytes; gzip from 1,729 to 2,903 bytes (**+1,174 bytes gzip**). This esbuild comparison externalized existing React/auth/analytics/capability-context dependencies equally on both sides and included the helpers imported by ActivitySpine. The separate destination hook and its screen consumers are covered by the production size gate, not this slice. It is a feature-slice comparison, not an isolated production-build delta amid unrelated workspace edits. Its import graph contains no server catalogs or runtime registry.

The initial build passed the production size gate at 8,592,781 total JS/CSS bytes. The final shared-tree build has **8,603,259 bytes**, exceeding the unchanged 8,600,000-byte total ceiling by **3,259 bytes**. Its startup graph passes at 1,450,078 raw / 387,847 gzip bytes. Manifest comparison with the immutable initial artifact shows a net 10,478-byte total increase: the guidance navigation/hook and its five consumer chunks account for 768 bytes; the remaining changes include concurrent VN artwork/chunk restructuring outside this pass. The final total gate is therefore reported as failed, not waived or described as passing. No size thresholds or unrelated artwork systems were changed to conceal it.

Measurement recipes and detailed local output: `.tmp/activity-measure.mjs`, `.tmp/activity-measurements.json`, `.tmp/activity-compare-builds.mjs` and `.tmp/activity-build-comparison.json` (ignored validation artifacts).

## Validation

Node 22.23.1 was used for tests (repository-pinned major). Local accounts use memory KV or Playwright fixtures; no production accounts or deployment were involved.

- Focused selector/readiness/handler/navigation/capability tests: **56 passed**. Expanded suite including canonical helpers and mentor recovery: **108 passed**. Final focused regression run after the late audit fixes: **39 passed**, including retained Ranked admissions for both participants.
- Final production server build and earlier separate server `tsc --noEmit`: passed.
- Final production client build and separate client TypeScript check: passed.
- Full client lint: passed, zero errors and 15 unrelated warnings. The final focused lint of the section navigation/screens/browser fixtures passes without warnings.
- Final `npm run verify:dist`: passed. `npm run sizecheck`: initial build passed; final shared-tree build exceeds the total ceiling by 3,259 bytes, as detailed above. Startup and individual chunk gates pass.
- Initial Chromium guidance acceptance and freshness: **14 passed**, including actual Story Hall, training, Clan Hall, Pet Yard, Deck, active Tower, Legacy and Crafter navigation, mobile scrolling, delayed responses, account switching, mutation refresh, unchanged autosaves, empty/paused gates and stale click checks. Final seven-project guidance run: **122 passed, 4 failed** of 126. Two failures were a fixture expecting the label “Overview” instead of the existing “Profile”; the corrected case passed in all seven projects. The other two were WebKit story-overlay ordering and startup timing. The fixture now operates whichever of the existing dialogs is on top, waits for both before dismissing the scene, and allows 20 seconds for app startup. The final isolated story/Legacy/mounted-Profile recheck **passed all 21 cases** against the same immutable build. Every one of the 126 guidance/browser combinations therefore has passing evidence across the main run and corrected-fixture reruns; the original failures remain recorded. Production story/modal behavior is unchanged. The final WebKit mobile screenshot was also inspected for readable wrapping and reachable actions.
- `npm --ignore-scripts test`: **11,200 passed, 2 failed, 1 cancelled** of 11,203. Skipping the pretest dependency reinstall preserved other active workspace tasks; the full test command itself ran unchanged. Failures were the unrelated Pet Yard source-text expectation (`pet-overflow-lifecycle-wiring.test.ts`) and a missing in-progress artwork asset (`vn-artwork.test.ts`). Both reproduced separately. The account-deletion lock test timeout passed separately (30 passed / 2 unrelated failures across those three files).
- Full responsive matrix: **1,073 passed, 620 skipped, 29 failed** of 1,722 in 1.9 hours. The guidance failure was the original Firefox Crafter fixture waiting for network idle; the corrected case passed in the focused seven-project run. Other failures comprise the separately investigated cases below, additional companion/healer failures on WebKit mobile, two WebKit mobile World Map timeouts, a tablet Mission Hall reload assertion and the same manifest mismatch on tablet navigation preload. The full run is recorded as failed, not as 1,722 passing tests.
- Broad-failure isolation on its original immutable artifact: Chromium **4/4 passed**; Firefox **3/4 passed**, with the unrelated multi-page companion/Sunscar visual case timing out during reload; WebKit **1/5 passed**, with companion accessibility scan and mentor-course timeouts plus two healer chakra-receipt mismatches remaining. These failures are not treated as passing, and those features were not edited by this pass.
- Later preload failures were traced to existing tests reading filenames from the rebuilt `dist` while the long-running suite served its earlier immutable snapshot. For example, Bank changed from `c-Bqm6FO2F.js` to `c-Dj6rINdJ.js`; the test looked for the latter on the former artifact. Against the matching final artifact, navigation preload passed **13/14** cases (one unrelated WebKit desktop timeout), and deferred PvP loading passed. A separate mobile Pet Yard audit still reports an undersized “Back to Village” touch target; that screen/layout is outside this pass.
- Strict combat-layout matrix: **19 passed, 10 skipped, 1 failed** in 50.1 minutes. The ten skips are existing intentional cross-browser skips for the two authority journeys that run only in Chromium; shared combat geometry still runs across browsers/DPRs. The failed Chromium PvP capture encountered a shared output-directory collision with a concurrent browser run. Its isolated rerun on the final build **passed** in 1.8 minutes. All 20 enabled combat cases therefore have passing results, with the original failed run retained in the record.

Commands used for the final checks (PowerShell, with `.tmp/performance-node-22.23.1` prepended to `PATH`; root directory unless noted):

```text
node --import tsx --test api/player/_activity-spine.test.ts api/player/_activity-spine-guidance.test.ts api/player/activity-spine.test.ts shinobij.client/src/lib/activity-spine-navigation.test.ts shinobij.client/src/components/ActivitySpine.capability.test.ts
node --import tsx .tmp/activity-measure.mjs
npm --ignore-scripts test
npm run build:server
npm run build:client
npm run verify:dist
npm run sizecheck
```

Client-directory checks:

```text
npx tsc -b --pretty false
npm run lint
$env:PLAYWRIGHT_PORT='43874'; npm run test:e2e -- --workers=2 --output=../.tmp/activity-responsive-results
$env:COMBAT_LAYOUT_PORT='43881'; $env:COMBAT_LAYOUT_CAPTURE_PHASE='after'; $env:COMBAT_LAYOUT_STRICT='1'; npm run test:e2e:combat-layout
$env:PLAYWRIGHT_PORT='43889'; npm run test:e2e -- e2e/activity-guidance.spec.ts e2e/activity-guidance-freshness.spec.ts --workers=2 --output=../.tmp/activity-browser-final-results
$env:COMBAT_LAYOUT_PORT='43890'; $env:COMBAT_LAYOUT_ARTIFACT_ROOT='C:\Users\Tyler R\source\repos\NinjaK\.tmp\activity-combat-recheck-captures'; npm run test:e2e:combat-layout -- --project=chromium-layout --grep 'PvP combat layout viewport matrix' --output=../.tmp/activity-combat-recheck-results
```

Isolated reruns use `.tmp/activity-existing-preview.config.ts`, which keeps the standard browser projects and explicitly binds to this task's verified preview. The final-artifact rerun used `ACTIVITY_PREVIEW_URL=http://127.0.0.1:43889` with:

```text
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/activity-guidance.spec.ts --grep 'available chapter goes through|Legacy opens Profile Legacy|Legacy switches an already mounted Profile' --workers=1 --output=../.tmp/activity-navigation-final-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/navigation-preload.spec.ts --workers=1 --output=../.tmp/activity-preload-final-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/deferred-feature-loading.spec.ts e2e/non-combat-ui-audit.spec.ts --project=chromium-mobile --grep 'village restoration defers PvP|pets is production-sized' --workers=1 --output=../.tmp/activity-mobile-wide-final-results
```

Original-artifact isolation used the same config with `ACTIVITY_PREVIEW_URL=http://127.0.0.1:43874`, `--workers=1`, separate `activity-wide-recheck-{browser}-results` output directories, and these exact project/spec/filter selections:

| Project | Specs (under `e2e/`) | `--grep` |
| --- | --- | --- |
| chromium-desktop | `first-pact-rpg.spec.ts guides-library.spec.ts` | `a completed crossing repairs\|First Pact Chronicle remembers\|public guide archive searches\|guide reader keeps navigation` |
| firefox-desktop | `android-qa-report.spec.ts pet-home-visual.spec.ts profession-hubs.spec.ts training-feedback.spec.ts` | `profile explains avatar access and scrolls at 1024x600\|refined companion and Sunscar pages\|healer retries a failed request\|stat cancel malformed` |
| webkit-desktop | `pet-mentor-guide.spec.ts pet-home-visual.spec.ts profession-hubs.spec.ts shinobi-combat-mobile.spec.ts` | `Tomoe provides a complete\|refined companion and Sunscar pages\|healer can treat a worldwide patient\|healer retries a failed request\|pvp phone combat restores` |

## Requirement coverage

| Handout section | Evidence |
| --- | --- |
| 1. Current baseline | Initial and final HEAD remained `2f8b49bf`; original selector/handler were compared without resetting the checkout |
| 2. Scope boundaries | Scoped diff contains guidance, section hints, pure shared readiness extraction, tests and this report; no action endpoint behavior, CSS or game content was rewritten |
| 3. Focus intent | Current Auto-only UI source contract and browser query assertion; handler tests cover explicit query, saved focus, invalid values and no preference writes |
| 4. Safety/recovery | Existing selector priority and unavailable-run recovery tests remain; canonical recovery and mentor tests are included in the passing expanded suite |
| 5–6. Goal-directed Now/all eight focuses | Pure readiness and selector tests exercise deterministic ready, blocked, exhausted/completed and unknown states using canonical authorities listed above |
| 7. Today | Compactness/duplicate checks, existing timer/claim behavior and real immutable recipe-decision test |
| 8. Truthful CTA/navigation | Typed destination allowlist, all section pairs and mismatch rejection; built-app navigation tests including already mounted screens |
| 9. Authority/capabilities | Handler fixture rejects storage writes; exact capability projection and pause/recovery tests; canonical deck, roster, season, trial and recipe helpers |
| 10. Freshness/performance | Browser harness covers stale responses, account isolation, successful mutations, unchanged saves, HP ticks, empty/paused gates and stale clicks; measured reads/bytes/bundle delta |
| 11. Test coverage | Focused, canonical-helper, handler, client and cross-browser results above; wider-suite failures are reported separately |
| 12. Eight player journeys | Existing-UI story, prerequisite, clan, companion, deck and active-run cases; real component freshness harness; mobile overflow/scroll assertions and screenshot inspection |
| 13. Validation/report | Build/type/lint/artifact/size checks, focused matrices and full responsive run completed; failures and reruns are recorded above. This document records sources, file purposes, limitations and measured impact |

The responsive CI job installs root QA dependencies and extracts the joined server/client release artifact before Playwright. That matches the new fixture's use of the compiled server selector; it does not depend on committing local `dist` output.

## Limits and scope

Profession resources/cooldowns, Tower daily/squad admission, and non-mission Legacy objectives intentionally lead to the existing review/preparation surface rather than fabricate a precise action. Readiness may change after the response; actions still recheck it. This work does not measure retention or enjoyment.

The guidance implementation does not change layout/CSS, combat or pet combat mechanics, rewards/economy, authored encounters/story, camera, audio, effects or artwork. Other concurrent work in the original shared checkout touches some of those files; those changes are outside this pass. Mentor settlement/recovery code was preserved. No new dashboard, selector, quest, router or recommendation service was added. The initial implementation phase did not commit or deploy; the subsequent user-authorized release is described below.

## Live-main release follow-up

The user subsequently requested checking and pushing live main. Remote `main` was `d451fde86831b7c25e1a9ddc01dbc0fa7ff4baad`, 13 commits ahead of the implementation checkout, including the mentor milestone crash-recovery fix. The 31 guidance files applied cleanly in an isolated checkout and matched the reviewed implementation. No unrelated dirty-workspace changes were copied into the release.

The production health endpoint reported `1a0b7a2e2b3cb9d2bdf789422500e0eacfbb55bb`; the newer main CI run failed only its mobile Pet Yard touch-target check. The user approved a 38px-to-44px return-button repair, which passed desktop/mobile audits locally. During validation, main advanced to `bac5764b14397a28b76b24b857d41290fa19da8c` and independently included that repair for touch viewports, together with Sunscar animation fixes. The release adopts those upstream changes and drops the duplicate local CSS edit. The guidance commit itself therefore contains no style or gameplay changes. Current main already sets the total asset budget to 8,660,000 bytes; this release does not change that threshold.

Integrated checks before the final upstream rebase:

- `npm run build`: passed, including server/client TypeScript, both production builds, `verify:dist` and `sizecheck`. Total JS/CSS is **8,593,196 bytes** against main's unchanged 8,660,000-byte ceiling; the earlier dirty-workspace overrun is absent from this isolated release. The emitted Pet Yard CSS contains the approved 44px minimum.
- Client `npm run lint`: passed with zero errors and 14 existing warnings.
- `npm run check:tooling-handoffs`: passed; generated handoffs need no edits.
- `npm --ignore-scripts test`: **11,257 passed, one failed, zero cancelled** of 11,258. The remaining source-contract assertion expected the request effect inside `ActivitySpine` instead of its extracted hook. Including the corresponding existing one-line assertion update fixed it; the isolated contract file **passed both tests**. No production code changed after the passing build.
- Guidance browser recheck on mobile Chromium and desktop WebKit: **35 passed, one timed out**. The isolated WebKit deck-navigation rerun **passed** without changing code or timeout; all 36 combinations have passing evidence.
- Pet Yard/map/Mission Hall checks across four projects: **11 passed, two skipped, one WebKit map-tour timeout**. The 45-second map timeout reproduced alone; with a local CLI timeout of 120 seconds, all its assertions **passed in 59 seconds**. Repository timeout defaults remain unchanged. The mobile Pet Yard screenshot was inspected; its 44px return control is readable and unobstructed.
- The updated source-contract file also passes focused lint with no warnings.

After rebasing onto `bac5764b1`, the guidance diff was verified unchanged. The final focused suite passed **41/41**; the final client build, artifact verification, size check and tooling handoff check all passed. Final JS/CSS totals **8,593,814 bytes**. A further **5/5** browser smoke cases passed on that final build: Story Hall and illegal-deck navigation in desktop WebKit/mobile Chromium, plus the mobile Pet Yard audit using main's 44px fix. The preview manifest remained unchanged throughout those checks.

Additional release commands (same pinned Node version and isolated checkout):

```text
node --import tsx --test shinobij.client/src/capability-refresh-ui-contract.test.ts
npm run check:tooling-handoffs
```

The final focused command is the five-file focused command above with `shinobij.client/src/capability-refresh-ui-contract.test.ts` appended. Release browser commands run from the client directory with `ACTIVITY_PREVIEW_URL=http://127.0.0.1:43911`, then `43912` for the final smoke:

```text
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/activity-guidance.spec.ts e2e/activity-guidance-freshness.spec.ts --project=chromium-mobile --project=webkit-desktop --workers=1 --output=../.tmp/release-guidance-browser-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/non-combat-ui-audit.spec.ts e2e/world-map-mobile.spec.ts e2e/first-contract-handoffs.spec.ts --grep 'pets is production-sized|six spatial region views|keyboard focusing off-camera|combat handoffs select Combat' --project=chromium-desktop --project=chromium-mobile --project=webkit-mobile --project=chromium-tablet --workers=1 --output=../.tmp/release-repair-browser-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/activity-guidance.spec.ts --project=webkit-desktop --grep 'a forty-card illegal deck' --workers=1 --output=../.tmp/release-deck-recheck-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/world-map-mobile.spec.ts --project=webkit-mobile --grep 'six spatial region views' --timeout=120000 --workers=1 --output=../.tmp/release-map-extended-results
node ./node_modules/@playwright/test/cli.js test -c .tmp/activity-existing-preview.config.ts e2e/activity-guidance.spec.ts e2e/non-combat-ui-audit.spec.ts --grep 'available chapter goes through|a forty-card illegal deck|pets is production-sized' --project=chromium-mobile --project=webkit-desktop --workers=1 --output=../.tmp/release-final-smoke-results
```

The task's completion message records the final pushed commit and its CI/production health verification.

### Responsive CI capacity follow-up

Guidance commit `c3788d5e3d74c76ba2b88acf37f71f8e9dbcac3a` reached `main` and production; the public health response matched it and authenticated Post-deploy health run `35329769682` passed. Its build/security, server contracts, release certification, concurrency, Village Stores, Warfront and all combat browser jobs passed. Responsive shard 1 passed. Shard 2 completed all Stronghold audits, then reached test entry 824 of 875 without a reported assertion failure before GitHub cancelled it at the 29-minute job limit. That timeout is not a passing suite.

Following the repository's time-budget policy, a separate CI-only repair partitions the same responsive suite into three shards while retaining the 29-minute limit, all CSP/Stronghold checks, immutable artifact verification, evidence uploads, and the stable fail-closed aggregate. It changes `.github/workflows/ci.yml`, its existing contract test, `docs/CI.md`, and this report; no gameplay or browser application code changes.

Validation used pinned Node 22: `node --test scripts/ci-workflow-contract.test.mjs` passed **8/8**, `npm run check:deployment` passed, and `git diff --check` passed. From the client directory with `CI=1`, discovery ran:

```text
node ./node_modules/@playwright/test/cli.js test --list --reporter=json
node ./node_modules/@playwright/test/cli.js test --list --reporter=json --shard=1/3
node ./node_modules/@playwright/test/cli.js test --list --reporter=json --shard=2/3
node ./node_modules/@playwright/test/cli.js test --list --reporter=json --shard=3/3
```

All four commands completed successfully. Comparing discovered test IDs and projects verified **1,750 total entries**, partitioned **584 / 583 / 583**, with **zero omissions and zero duplicates**. Discovery verifies coverage partitioning; the subsequent hosted run supplies execution results.
