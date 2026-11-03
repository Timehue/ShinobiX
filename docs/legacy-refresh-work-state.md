# Legacy refresh completion record

Status: feature implementation, tuning and integration audit complete; release candidate prepared from current main, 2026-11-03.
Branch: `codex/legacy-main-integration-20261103`, created from freshly fetched
`origin/main` at `812acc43f4009210b48a2bd96fbaae7612f968bb`. The six intervening
main commits are preserved. All 63 Legacy work files carried over byte-for-byte,
without conflicts; an ignored backup remains in .ci-evidence/legacy-main-merge-backup.
Publication and combined-tree release-gate status belong to the associated GitHub
pull request and deployment workflow. The completed feature checks below record
the pre-integration baseline; they do not assert a production deployment.

## Main integration candidate

- Owner request: check current live main and merge the completed Legacy work.
- Current main includes mobile combat/loadout, Solo Cleanse, world startup,
  outskirts/raid and crafting-checklist fixes. Their changed files do not overlap
  this feature's changes. The final integrated branch starts on current main.
- Fresh combined-tree targeted tests passed: 346 tests in 40 files, zero failed;
  .ci-evidence/legacy-main-focused.log. This includes the Legacy audit plus the
  new main-branch Cleanse, raid, startup and crafting-checklist regressions.
- Main requires ten CI aggregates, including server contracts, build/security,
  client quality, certification, concurrency and the full browser suites. The
  integration PR carries their authoritative results before the authorized merge.

## Final integration audit

- Scope: qualification and all trial stages, actual activity-credit writers,
  save/replay protection, Stage II unlock, stage-derived mastery, separate slot,
  generated catalog/reference parity, all combat modes and browser presentation.
- Latest unchanged production baseline: 19,116 unit tests passed, 30 skipped,
  zero failed; build, bundle checks and client lint passed (details below).
- Fresh targeted audit: 245 tests in 34 files passed, zero failed;
  .ci-evidence/legacy-integration-audit-focused.log and
  legacy-integration-audit-files.json. Includes the real-handler player journey,
  activity transactions, concurrency/replay recovery and all-signature combat.
- Route-registration audit passed another 15 tests, zero failed;
  .ci-evidence/legacy-integration-route-check.log. Total fresh targeted unit
  coverage: 260 tests in 35 files.
- Loadout-sealing/preview matrix passed 1,600 cases: all 100 signatures, four
  specialties and stages II-V at levels 50/70/90/99. Verified all tags, cap carrier,
  mastery overrides, correct single resource bar, client/server percentages,
  rejection of a foreign signature and preservation through PvP/Tower sealing;
  .ci-evidence/legacy-integration-sealing-matrix.json.
- Actual resolver audit passed 400 stage/signature casts and 784 non-movement
  tag assertions: effects resolve on the correct fighter at the intended strength,
  timing and duration; immediate Heal/Shield/Siphon amounts agree. Movement and
  Tower area coverage are exercised by the targeted dispatcher/parity tests.
  All 100 signature art files exist with WebP headers;
  .ci-evidence/legacy-integration-effect-audit.json.
- Focused Legacy browser checks passed 14/14 across seven desktop/mobile projects
  (Chromium, Firefox and WebKit), exit 0;
  .ci-evidence/legacy-integration-browser.log. Desktop WebKit and 360px Chromium
  screenshots in legacy-integration-browser-results were visually reviewed.
  The owned .playwright-dist-14498 snapshot was removed after browser teardown.
- Code tracing matches the current design: new gathering/crafting/profession/Rift
  deeds join their save transactions; Tower and boss delivery uses durable replay
  receipts and excludes unsupported/idle credit. Live Tower entry opens before
  level 100; repeatable floor routes and Rift access do not require the final Era.
  Targeted attainability tests cover every qualification and both trial variants
  through all four stages, including rarity effort and non-PvP alternatives.
- No functional integration defect was found in the audited Legacy paths. No
  runtime changes were needed. Existing full-suite/build/lint evidence therefore
  remains current; local checks do not constitute a production deployment.

## Completed Common utility tuning

- Owner request: Common 40-AP signatures should have two working tags and
  percentage effects slightly above normal/global utilities.
- All eight now carry exactly two tags. Percentage effects are authored at 32%
  at mastery 50, versus normal/global 30% and Rare 35%. Their A-rank cap carrier
  allows the 32% in combat and previews without changing Legacy rarity.
- Rallying Banner adds Increase Heal; Camp Respite adds Lifesteal; Neighbor's
  Vigil adds Increase Heal. Flat Heal/Shield keep normal mastery-scaled amounts.
- Canonical client rows, generated server catalog, reference and tier tests
  updated. A controlled PvP/Solo test checks both effects, real percentages,
  preview parity and the two-point premium at all four pre-100 mastery stages.
- Evidence: .ci-evidence/legacy-common-utility-before.json and
  legacy-common-utility-audit.json confirm all existing utility effects survive;
  the normal catalog and other 92 signatures are unchanged.
- Focused combat/catalog/reference/preview checks passed: 78 tests, zero failed,
  .ci-evidence/legacy-common-utility-focused-final.log. Production build and
  artifact/bundle gates passed: legacy-common-utility-build-final.log. The first
  build exposed a new test import across the server/client boundary; preview
  checks now live in the scripts test, and the corrected full build passed.
- Client lint passed: zero errors, the same 27 existing warnings;
  .ci-evidence/legacy-common-utility-lint.log.
- The sandboxed npm dependency installer failed before tests started
  (.ci-evidence/legacy-common-utility-full-unit.log). The authorized retry with
  normal npm cache/package access passed (exit 0): 19,116 passed, 30 skipped,
  zero failed out of 19,146 tests in 700 seconds;
  .ci-evidence/legacy-common-utility-full-unit-final.log. No screen/component
  changes in this follow-up; the completed UI suites below remain the baseline.

## Completed two-tag nerf

- Owner decision: 60-AP damaging Legacy signatures allow at most two tags,
  including Move and Increase Discipline; 40-AP pure utilities allow three.
- All thirteen over-budget damage signatures lose exactly one existing effect.
  No power, percentage, reach, shape, AP or cooldown compensation is added.
- Sovereign's Decree retains damage increase and lifesteal; Reflect is removed.
  The same controlled two-hit/counter scenario now reflects 0 rather than 588 HP.
- All 100 signatures remain distinct. The canonical client rows, generated server
  catalog, descriptions, reference generator and tag-budget lint are updated.
- Evidence: .ci-evidence/legacy-two-tag-before.json and legacy-two-tag-audit.json.
- Focused combat/catalog/reference validation passed: 75 tests, zero failed,
  .ci-evidence/legacy-two-tag-focused.log. Production build, artifact/bundle gates
  and client lint passed (zero errors, the same 27 existing warnings):
  legacy-two-tag-build.log and legacy-two-tag-lint.log.
- Required root unit suite passed: 19,113 passed, 30 skipped, zero failed out of
  19,143 tests in about 13 minutes; .ci-evidence/legacy-two-tag-full-unit.log.
  This follow-up changes data/descriptions, not screen/component code; completed
  UI suites below are the refresh baseline.

## Delivered

- All 100 signatures have distinct combat mechanics beyond percentages. Even
  ignoring utility metadata and irrelevant self-target reach, all 100 remain
  distinct. The 33 utilities each have a different effect combination.
- Existing identity IDs and artwork remain. Tier strength caps and cooldown 10
  remain; utilities use 40 AP and damaging techniques use 60 AP.
- Signatures unlock at Stage II, with mastery 20/30/40/50 at stages II through V.
- Each identity has two trial routes. Rarity increases the planning effort budget;
  every qualification path and newly issued trial has earning routes before 100.
  The final Era campaign is never a dependency. Finite or scheduled qualification
  proofs retain historical credit and have sustainable alternatives.
- New verified deeds cover normal Tower clears and performance, Clan/World Boss
  operations, Rift claims, gathering, actual item crafting and profession work.
- Save-based deeds commit with their source rewards. Legacy stat writers use CAS
  so concurrent deeds cannot overwrite each other. Pending combat receipts survive
  activity churn and retire only after authoritative source settlement.
- Existing totals, completed stages and receipts remain. Valid issued trials keep
  their sealed objectives; free objective rerolls stay on the accepted identity
  and select the new routes. Paid Fate Shard identity replacement is future work.
- Sage previews, unlock ceremonies and active-trial earning guidance match the
  Stage II rules. The existing `ENABLE_LEGACY` switch remains; no schema migration
  or new deployment setting is required.

## Refresh baseline validation

- Full production build, artifact verification and bundle-size gate passed:
  `.ci-evidence/legacy-production-build.log`.
- Final server compile passed, including the stronger identity regression guard:
  `.ci-evidence/legacy-final-server-build.log` (session 94721, exit 0).
- Client lint passed: zero errors, 27 warnings in unchanged files:
  `.ci-evidence/legacy-client-lint-final.log`.
- Focused authority/definition/combat suites passed, including all 100 signatures
  in PvP, Solo and Tower combat at pre-100 levels with stage-derived mastery.
  The final semantic catalog guard passed 14 tests:
  `.ci-evidence/legacy-semantic-identity-check.log`.
- Recovery/concurrency suite: 92 passed, zero failed:
  `.ci-evidence/legacy-recovery-verified.log`.
- Prepared four-person squads using ordinary progression gear won all 24 sampled
  normal Tower fights at floors 1 and 5, levels 50/70/90/99. This demonstrates a
  practical group route, not a guarantee for every build or solo squad:
  `.ci-evidence/legacy-pre100-tower-sim.log`.
- Focused Legacy browser suite: 14 passed across seven projects:
  `.ci-evidence/legacy-browser-focused-elevated.log`.
  Desktop WebKit and narrow Chromium Legacy screenshots were visually reviewed.
- Full unit invocation: 19,105 passed, 30 skipped, five failed of 19,140:
  `.ci-evidence/legacy-full-unit.log`. The expected jutsu census was updated for
  the authored shapes; two obsolete failure fixtures now intercept CAS. Two
  timing-related failures passed with lower concurrency. All six selected files,
  covering every reported failure and the war fixture, then passed: 33 tests,
  zero failed, `.ci-evidence/legacy-unit-failure-reruns.log` (exit 0).
- Required strict combat layout: 20 passed, 10 configured project skips, zero
  failures, 1.0 hour. Capture phase `after`, strict `1`, session 21672 exit 0:
  `.ci-evidence/legacy-combat-layout.log`. Captures are in
  `.ci-evidence/legacy-combat-layout-captures/`; the WebKit armed Tower screen
  at 512x384 was also visually reviewed.
- Required full responsive/accessibility suite: 3,332 passed, 1,123 skipped, six
  failed of 4,461 scheduled cases, 2.7 hours, session 47740 exit 1:
  `.ci-evidence/legacy-full-smoke.log`. All six failures passed exact isolated
  retries against this task's same immutable build, without changing source,
  assertions, timeouts or production configuration:
  - Story recovery, card teardown, First Pact fallback and pet mentor: 4/4 passed,
    `.ci-evidence/legacy-smoke-reruns.log` (session 39363, exit 0).
  - WebKit profession switching: 1/1 passed in 14 seconds,
    `.ci-evidence/legacy-smoke-reruns-2.log` (session 75276, exit 0).
  - Compact Companion Home arena avatars: 1/1 passed in 7.6 seconds,
    `.ci-evidence/legacy-smoke-reruns-3.log` (exit 0).
  The ignored retry config imports the base settings and uses one worker against
  this task's known preview, rather than a different application build.

The original full unit and smoke invocations were not green; their reported
failures are all resolved by corrected fixtures or passing isolated retries.
No failed case remains unresolved. Do not repeat the full suites without a new
change or concern that warrants it.

`git diff --check` passed. No dist files or bulk evidence are tracked. The owned
`.playwright-dist-14498` temporary preview copy was removed after test teardown.
Feature baseline validation processes are closed. Release validation and
publication status are recorded by the integration pull request.

## Review artifacts

- `docs/legacy-jutsu-reference.md`: every Legacy, signature, effect, AP, range,
  base effect power and live resource-cost examples.
- `docs/legacy-roster.md`: qualifications, trial routes and effort estimates.
