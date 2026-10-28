# Logout save recovery

Prepared on `codex/first-contract-logout-recovery-20260913` in an isolated worktree. The release integration includes main through `33d02c47e`, preserving the latest dynamic-import recovery, world-map hover fix, and live-test reconnect guards.

An immediate logout can hit the existing save burst limit after First Contract activity. Previously, the client discarded the HTTP 429 retry hint and displayed the generic loss warning. A committed contract record can already be on the server when the final generic save is rejected.

Required saves retain a validated `retryAfterMs` hint in `SaveRateLimitError`. Logout explains the pause, distinguishes previously saved progress from unconfirmed changes, and offers **Stay in game**, with instructions to wait and use **Logout** to retry. Missing or malformed hints use general waiting advice. The existing explicit **Log out anyway** choice remains available.

The integration review corrected three additional problems:

- Logout failure dialogs initially focus **Stay in game**, so Enter keeps the session. The explanation is associated with the dialog for screen readers. Other confirmation callers retain their default action unless they opt in.
- Repeated Logout clicks share one pending attempt and one decision. Canceling releases that attempt so a later retry can proceed.
- Logout belongs to its originating account and session. A late save response or force-logout decision cannot end a replacement session; unmounting retires the attempt too.

`App.tsx` binds the existing save coordinator and session epoch to `player-logout.ts`; its line budget was lowered after extracting the orchestration. The existing second save for newly dirty progress remains in place. Server rate limits, save serialization, version authority, conflict recovery, pending payload protection, autosave behavior, and the requirement to await acknowledgement before normal logout are unchanged. This does not claim that a rejected save committed, add automatic retries, or change contract completion or rewards.

## Validation

- 112 focused recheck tests passed: logout orchestration and session races, persistence, error classification, pending save/unload protection, save queue, conflicts, account/version authority, App size, and the newly integrated main changes.
- All 8 tests in the final two main test-clock files passed after integration.
- The release preflight passed 134 focused tests after integrating `f15e5f0fe`, including the new dynamic-import gate and notice recovery tests.
- The earlier 67 server and First Contract checks passed for rate limits, save versions, versioned writes, Academy ownership, contract state, and mission-claim recovery. Those server paths were not changed by the refinement.
- Focused ESLint passed for every changed TypeScript file.
- Server TypeScript build passed.
- Client TypeScript and production build, distribution verification, and size checks passed.
- 29 production-bundle browser checks passed: 18 logout recovery cases and 9 existing First Contract cases across Chromium desktop (1366 × 768), Chromium compact (360 × 640), and WebKit mobile (390 × 844), plus 2 existing desktop Clan Hall checks for shared confirmation behavior. The Clan Hall suite intentionally skipped its 4 compact/WebKit duplicates.
- The existing Academy-to-First-Contract journey passed again against built local Express with real authentication and persistence (0 ms starter delay; starts on desktop and switches to mobile).
- Checks cover safe Enter activation, Tab/Shift+Tab containment, Escape cancellation, screen-reader description and axe accessibility, repeated clicks, held acknowledgements, missing hints, explicit force-logout, and contract restoration through login.
- Compact portrait and short landscape (640 × 360) screenshots were inspected; copy and both actions fit without clipping. Recheck browser output is under `shinobij.client/test-results/logout-recheck`; Express evidence is under `shinobij.client/test-results/logout-recheck-express`.

The new browser fixture exercises the real client with controlled server responses, including a held acknowledgement, cancellation, explicit force-logout, missing timing hints, and contract restoration through login. These checks establish client recovery behavior; server persistence and rate-limit enforcement are covered separately.

The local rechecks used Node 22.23.1. The results above describe focused coverage recorded before publishing the release candidate.

The complete [GitHub CI run](https://github.com/Timehue/ShinobiX/actions/runs/34794237410) and [Production Image run](https://github.com/Timehue/ShinobiX/actions/runs/34794239557) passed for `a86f36923e451347f894103c57b309fd6d60599f`. Every server, client, artifact, fresh-account, concurrency, combat, Warfront, and responsive release gate passed. The responsive matrix passed 628 cases, including all 42 logout recovery cases across seven browser/viewport projects.

While those checks ran, main advanced to `33d02c47e` with changes confined to live-test fixtures and their guard test. That update was integrated separately, and all 136 focused tests passed, including the new fixture guard. Game source, dependencies, and build inputs remain identical to the fully certified candidate. The combined main revision receives the normal push-triggered CI and production-image checks.

Deployment is verified separately by matching the production `/health` commit to the released revision; a main-branch push alone is not evidence that the live server has updated. The final main revision and live verification are reported with the release.
