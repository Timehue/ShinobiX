# Anbu async recovery, queues, and CI review

> Raw evidence files linked from this page (logs, transcripts, screenshots) were removed on 2026-10-16 to cut repository weight. Retrieve one with `git show 5124ba3f2:<path>`.

October 12, 2026. Stronghold entry remains level 50; enemy Anbu treasury raids remain level 100.

## Changes and integration

- The Anbu host now checks the authenticated server-owned active run for the selected sector when the browser has no saved run ID. A lost start response no longer strands an admitted fight behind the stronghold entry gate. Obsidian still ignores unrelated Anbu recovery.
- Raid context and its active pointer are staged before combat publication. A committed combat write or daily-attempt write whose acknowledgement is lost can be completed safely through recovery. A context that never published combat is discarded without charging an attempt.
- Prepared recovery repairs battle presence and the held-fight index without rewriting the combat row. A concurrent request can advance combat during recovery; its version and health remain intact, and recovery returns the current session.
- A ready run resumes without reserving another attempt. Prepared admission uses the run's original UTC date, so reconnecting across midnight cannot consume a second day's allowance.
- Anbu admission and new patrol publication serialize against the existing world-boss event/queue lock. A waiting boss ticket prevents a simultaneous Anbu fight; an owed patrol remains at its saved threat/step count and starts after that queue is cleared. Pending PvP, proven competing fights, travel, and actual sector presence are rechecked before admission/publication.
- The Anbu remains an asynchronous defender snapshot from the verified appointed/earned roster, with the existing seated-Kage fallback and daily loadout seal. Its real player's guard/PvP queue is distinct from the snapshot encounter. Existing war-resource caps, held-defense protection, reward receipts, cache turn-in, mission/Legacy/Era hooks, and sector-conquest ownership stay with their current server authorities.
- Refreshed the generated design-token handoff through `npm run export:tooling-handoffs`. The drift contract now passes; no CI thresholds or size limits were relaxed.

## Evidence

| Check | Result |
| --- | --- |
| Latest full canonical CI runner, with real Postgres required | **14,784 passed, 0 skipped, 0 failed, 0 cancelled; exit 0**; [final quality review](goal-final-quality-review.md) |
| Focused recovery/store concurrency tests | 10 passed |
| Anbu, stronghold, held-fight, and runtime contracts before the final concurrency refinement | 38 passed |
| Actual-component Chromium/WebKit browser checks | 52 passed, no page errors |
| Client and server builds | Passed |
| Full client ESLint | Passed: 0 errors, 17 warnings in existing files |
| Focused changed-file ESLint | Passed |
| Normal and production-variable size checks | Passed with existing limits |
| Distribution, deployment, rollback, mission catalog, release assets, generated handoff contracts | Passed |

The earlier local runs passed 14,767 tests and skipped the 14 real-Postgres cases.
The [Postgres follow-up](postgres-integration-review.md) resolves that gap: all
14 ran against an isolated Postgres 16.15 database, and the complete canonical
suite passed all 14,781 tests with zero skips. The separate live Tebex contract
remains disabled. This review does not claim a hosted GitHub workflow run or a deployment.

The subsequent [final quality review](goal-final-quality-review.md) adds bounded
terrain-raster projection tests and passes all 14,784 tests. It also runs these
eight Anbu cases and seven cave traveler/collision cases against real Postgres,
with direct SQL persistence checks, plus actual authenticated multiplayer.

Backend tests use isolated in-memory storage and disposable authenticated identities. Failure injection covers lost acknowledgements; a concurrent stored combat advance proves recovery cannot rewind another request. Browser checks mount the actual exploration, Anbu host, and Arena with deterministic API fixtures, including missing browser run IDs, reload, failed recovery, pending requests, viewport fit, patrol thresholds, settlement, and account isolation. The full suite covers the wider village/sector war, guard queue, PvP, Hollow Gate/Rift, mission, receipt, and recovery contracts.

Logs: full CI with Postgres required, prior full CI with 14 skips, first passing CI run, concurrency, focused contracts, [browser results](anbu-async-browser/results.json), client build, server build, client lint, changed-file lint, distribution, production size, handoff contract.

## Reproduce

From the repository root:

```powershell
npm run test:ci
node --import tsx --import ./scripts/test-asset-hooks.mjs --test api/village/anbu-async-recovery.test.ts api/solo-pve/_store.test.ts
npm run build:server
npm run check:tooling-handoffs
```

From `shinobij.client`:

```powershell
node scripts/stronghold-browser-qa.mjs --output=../docs/stronghold/underground-review/anbu-async-browser
npm run lint
npm run build
```
