# Live-main release follow-up — 2026-09-14

The owner explicitly requested checking current main and pushing these reviewed fixes to main. This supersedes the earlier local-only release boundary; historical compensation, destructive storage drills and unrelated original-checkout work remain outside this release.

## Integrated source

- Fetched main: `100aa421855b4ca99c507886ed88820b804d380a`.
- Reviewed finishing-pass head: `093e65570`.
- Combined code commit: `22345b387c28b2b4a2484fb6c4a74f5dc9f23d13`.
- Merge completed without conflicts. Main's newer save recovery, Fate Shard preservation, dependency updates and client/CSS cleanup are retained. The shared save-ownership file contains both main's existing Fate Shard rule and the two protected clan receipt fields.
- Exchange recovery continues through the existing atomic character/version adoption path. Main's daily-login reconciliation recognizes the clan receipts through the server-owned field set.
- Dependencies were installed from the merged lockfiles into this isolated worktree. Its former root module junction was removed without deleting or changing the original checkout's dependencies. Runtime: Node `v22.23.2`.

## Combined-code validation

| Check | Result |
|---|---|
| Root `npm test` | PASS — 10,490/10,490; zero failures, cancellations or skips; 361,891.9188 ms |
| Root production build, dist verification and size checks | PASS |
| Client lint | PASS — zero errors, 14 existing warnings |
| Deployment topology and rollback compatibility contracts | PASS |
| Mission eligibility, release assets and breeding odds | PASS |
| Tooling handoff drift | PASS |
| Full browser gate, two workers, isolated preview port 14651 | PASS — 662 passed, 512 intentional skips, zero failures; 34.2 minutes |
| Strict combat layout, unchanged assertions, isolated Express port 22650 | PASS — 20 passed, 10 intentional skips, zero failures; 33.5 minutes |

All 21 Exchange recovery scenarios passed across the seven browser projects. These two full gates passed on their first combined-code invocation; no retries were needed. Logs are retained alongside this report as `live-main-*.log`; browser artifacts use separate `live-main-full-browser` and `live-main-strict-combat` directories. `live-main-validation.json` records the tested source and retained log hashes. Earlier stage evidence and failures have not been overwritten. No production source, test threshold or skip policy was changed to obtain these results.

## Production observation and release boundary

Before release, public `/health` returned `ok:true` on `8162386bdf07eff55037a77d63af6276b94b5e67`. The landing page, manifest, service worker, privacy page and terms page returned HTTP 200 with their expected content types. This confirms public liveness, not database recovery or backup certification.

The release uses a normal, non-force main push after checking the remote head again. GitHub's accepted main revision and Railway's served revision must be checked separately; a successful push alone does not establish that a deployment finished.

No destructive restore, production crash injection, staffed war/Clan Boss drill or physical Android certification was performed. The previous report's remaining historical-transaction and certification limits continue to apply.
