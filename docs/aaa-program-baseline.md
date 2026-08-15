# ShinobiX AAA program baseline

Status: Phase 0 locally complete; hosted and external blocks recorded

Date: 2026-08-14 (America/Chicago)

Repository: `Timehue/ShinobiX`

This document records the inspected Phase 0 starting point and the local evidence
collected from the isolated worktree after discovery. The tables distinguish local,
hosted, blocked, running, superseded, and not-run results. A local pass is not a
hosted Linux/Node-22 pass, and file/config inspection is not a passing test result.

## Source and environment

| Item | Verified starting value |
| --- | --- |
| Fetched `origin/main` SHA | `d8948a311680b92a2a672ae0a0b35714e73e8b4f` |
| Working branch | `codex/aaa-cohesion-corrected` |
| Branch start | Matches the fetched `origin/main` SHA above |
| Isolated worktree state before this file | Clean |
| Node | `v24.15.0` locally; repository engines and `.nvmrc` require Node 22+, while CI uses Node 22 and the Railway image pins `22.23.1` |
| npm | `11.12.1` |
| Operating system | Microsoft Windows NT `10.0.26200.0` |
| Recorded at | `2026-08-14T19:42:27-05:00` |

The shared checkout from which this isolated worktree was created was not clean: it contained a tracked edit to `shinobij.client/src/lib/save-conflict-restore.test.ts` and untracked Warfront/output evidence directories. Those user-owned changes were not copied, removed, or modified here. The isolated branch therefore starts from the fetched commit, not from that shared-checkout patch.

## Railway deployment topology

The checked-in deployment contract is:

- Railway is the sole active host and builds with the repository `Dockerfile`.
- The Docker builder and runtime images are both `node:22.23.1-bookworm-slim`.
- The builder performs locked root and client installs, builds the server and client, verifies the distribution, and runs the size gate.
- The runtime installs root production dependencies only, receives `dist/` and `shinobij.client/dist/`, and starts `node dist/server.js`.
- Railway runs exactly one replica. `railway.json` configures a shallow `/health` probe with a 120-second timeout and `ON_FAILURE` restart policy with at most 10 retries.
- One Express process serves both the API and SPA. It also owns Socket.IO, in-memory presence, the one-second game loop, presence snapshots, and in-process scheduled jobs.
- The single-replica limit is intentional. Presence and Socket.IO are not backed by a shared multi-instance adapter. Durable scheduled-job leases reduce duplicate cron execution, but they do not make the full gameplay runtime horizontally safe.
- `/health` proves process liveness. `/health/db` or `/health?deep=1` performs the storage/readiness probe and must be used for release verification.

The actual Railway service variables, deployed commit, resource class, region, production health, and live replica state were not inspected from the local repository and remain external verification items.

## Storage and backup topology

The current code/config contract is:

- Supabase PostgreSQL is the durable system of record. Data is primarily stored as JSONB values in `public.kv_store`.
- Railway is expected to provide `DATABASE_URL`, selecting the direct `pg` pool. The Railway pool defaults to 15 connections and uses 30-second statement/client query timeouts unless explicitly overridden.
- If no PostgreSQL URL is present, the code can fall back to the Supabase REST adapter when its server credentials exist. The actual deployed adapter cannot be proven from repository files alone.
- All current production keys, including `save:*`, `shared:images*`, and `shared:imgfields*`, are expected in the base store. `KV_PROXY_URL`, `KV_PROXY_TOKEN`, `DISK_KV_DIR`, and `REQUIRE_DISK_OVERLAY` are retired-production/rollback-only settings and should be unset.
- Deep health should report `saveStore=base-store`. A `disk` or `remote-proxy` result means the retired overlay path has been re-enabled.
- Save/version conflict protection includes atomic compare-and-set behavior: direct PostgreSQL uses single SQL statements, while the REST path has the `kv_compare_set` RPC/migration.
- The server runs a daily in-process save-snapshot job with durable leases and a freshness marker. Supabase-managed backups or PITR and an independent application export remain separate required controls.
- `npm run test:backup` is a hermetic helper/contract test. It is not a database-backed export/restore drill and cannot prove production recoverability.

### Verified baseline backup/rollback defect and patch state

At fetched `origin/main`, the base-only export places `save:*` rows in restored
PostgreSQL while the runbook enables an explicitly empty legacy overlay. That
would divert `save:*` reads away from the restored base and make valid saves appear
absent; the tooling also reports the legacy-overlay save count, which can be zero.

The Phase-0 branch contains a repair in
`scripts/kv-backup.mjs`, `scripts/kv-backup.test.mjs`, and
`docs/BACKUP_RESTORE_RUNBOOK.md`. The current focused hermetic suite passed 16 of
16 tests with 0 failures, cancellations, skips, or todos (`299.16 ms`). This
proves the checked-in helper/contract cases only. No database-backed export/restore
drill has run, and this document does not claim recoverability.

The current rollback-readiness checker is a static contract gate. It checks the monolithic `supabase-schema.sql`, one-replica Railway settings, and the presence/wiring of backup scripts; it does not inspect every file in `supabase-migrations/` and does not execute a prior-build compatibility, active-session, or receipt replay drill.

## Current CI structure

| Workflow / job | Trigger and current scope | Baseline status |
| --- | --- | --- |
| `CI / test-build` | PR, push to `main`, manual; one serial Ubuntu/Node-22 job with a 45-minute timeout covering installs, root tests/contracts/audit/build, release certification, local soak, client lint/build/audit, browser install, responsive E2E, and combat-layout E2E | GitHub run `31850478893` on `d8948a3` was **cancelled at 45 minutes**. Completed steps through responsive/accessibility passed; combat-layout had started test 18 of 30 without a final summary, and client audit was skipped. This is a current hosted red/incomplete result. |
| `Clan Boss operation certification / certify` | Path-filtered PR/push to `main`, or manual; Ubuntu/Node 22; 20-minute timeout; server build, operation certification, and balance audit | No current hosted result is recorded in this baseline. Local focused commands are recorded below and do not substitute for the hosted workflow. |
| `CodeQL / Analyze (...)` | PR, push to `main`, weekly schedule, or manual; matrix for JavaScript/TypeScript and Actions | GitHub run `31850478918` on `d8948a3` succeeded. The workflow comment about an expected advanced-setup upload rejection is operationally stale or already resolved; the settings state still requires an authorized read before changing the comment. |
| `Visual regression (manual) / visual` | Manual only; Windows; client build, Chromium visual regression, and baseline-size gate | No current hosted run is recorded; it is not an automatic PR gate. |

The principal CI job now has a **confirmed** 45-minute timeout, not merely a
timeout risk. It also repeats expensive work: the client is installed explicitly,
root `npm test` invokes `pretest` and installs it again, the root build builds the
client, and a later client step builds it again. Compiled artifacts are not
uploaded/reused across downstream certification jobs. Only combat-layout evidence
is retained by the main workflow.

The main CI workflow does not currently invoke `test:pet-breeding-odds`, `scan:data`, `ledger:audit`, `test:hollow-gate-soak`, Warfront E2E, or visual/visual-size checks. Clan Boss certification is a separate path-filtered workflow. No existing check may be dropped when Phase 1 splits the serial job.

## Mode-authority map state

`docs/architecture/verified-mode-authority.md` now exists as a completed Phase-0
static call-path audit. It covers the corrected handoff's minimum modes and the
additional mounted ANBU Infiltration, war mercenary, Clan War PvP/Card/Pet, Pet
Gauntlet, co-op Tactical, and Dungeon Card families. It records actual runtime
ownership and surface gaps without treating unmounted migration code as live.

The map confirms current code defects that must remain open for Phases 2 and 3:

- the Sector War garrison fallback resolves shinobi combat with Tower rather than
  the owner-selected PvP family;
- Dungeon Pet is client-selected/client-resolved while the final rewarding dungeon
  settlement does not consume a pet-combat proof;
- the public Pet Ranked route still resolves through the legacy pet simulation
  while a Showdown implementation is staged elsewhere;
- Hollow Gate Pet has a mounted legacy caller and an unmounted Showdown-capable
  path, requiring an explicit cutover decision;
- Tactical Arena currently aliases Warfront instead of exposing the distinct
  named mode required by the owner handoff; and
- Dungeon Card uses server-controlled Chronicle combat, but the final dungeon
  grant does not consume its terminal proof.

This completes the Phase-0 static map, not the implementation fixes it identifies.

## Branch protection

Branch-protection state was not queried from GitHub during this local inspection, so it is **unknown** and must not be described as enabled. The fetched baseline does not contain `docs/required-branch-protection.md`. If repository permissions do not allow direct configuration, Phase 1 must create that file with the final stable required check names and settings.

## Known red, incomplete, and externally blocked checks

| Classification | Finding |
| --- | --- |
| Confirmed hosted red/incomplete result | GitHub CI run `31850478893` was cancelled at the 45-minute limit. Combat-layout has no final summary and client audit was skipped. Completed earlier steps do not make the workflow green. |
| Current hosted security result | GitHub CodeQL run `31850478918` succeeded. This is current hosted evidence for CodeQL only, not a Phase-0 completion result. |
| Local credential block | `DATABASE_URL`, Supabase server credentials, and overlay/storage variables are absent from the current local environment. `scan:data` and `ledger:audit` therefore cannot produce valid database-backed results here without authorized safe-target credentials. |
| External evidence block | Production/staging deep health, backup freshness/PITR, restore drill, branch protection, real PostgreSQL staging, capacity, and credentialed admin/player journeys require external access and a safe target. |
| Documented unverified rollout evidence | Existing Clan Boss release documentation says its new hosted workflow and several disposable-staging/real-PostgreSQL cases had not yet been verified when written. That statement is historical until current GitHub/staging evidence is checked. |
| Backup repair focused verification | The fetched baseline has the empty-overlay restore defect. The current worktree patch passes its 16/16 hermetic helper/contract tests, but it has not been exercised against a real isolated database and does not prove restore or production recoverability. |

The hosted results above and local results below are separate evidence sets. Neither
may be used to infer production health, feature-flag state, or external capacity.

## Baseline command gate

This table records the local baseline gate in the isolated Windows worktree with
Node `v24.15.0` and npm `11.12.1`, including passes and explicit external blocks.
Most evidence is console-only; no durable release-evidence path
was assigned beyond ignored Playwright output. An initial sandbox `spawn EPERM`
affected worker-based test attempts. Authorized reruns produced the final test
results below, so the infrastructure-only attempts are not recorded as product
failures.

| Command | Local status | Evidence and scope |
| --- | --- | --- |
| `npm ci` | **PASS** | Locked root install: 174 packages, 0 vulnerabilities, approximately `11.75s`. |
| `npm ci --prefix shinobij.client` | **PASS** | Locked client install: 319 packages, 0 vulnerabilities, approximately `14.03s`. |
| `npm test` | **PASS** | Final post-hardening summary: 6,265/6,265 tests across 882 suites; 0 failed, cancelled, skipped, or todo; `946749.746 ms`. The earlier 6,260-test run is superseded. Initial sandbox `spawn EPERM` was infrastructure-only. |
| `npm run check:deployment` | **PASS** | Static Railway/Docker topology contract; approximately `1.039s`. It does not inspect live Railway. |
| `npm run check:rollback-readiness` | **PASS** | Static rollback contract; approximately `1.106s`. It does not replace restore, prior-build, active-session, or receipt-replay drills. |
| `npm run test:backup` | **PASS** | Final focused hermetic result: 16/16 tests, 0 failed/cancelled/skipped/todo, `299.16 ms`. It covers every disk-routed prefix but does not prove a real export/restore or production recoverability. |
| `npm run test:mission-eligibility` | **PASS** | Offline catalog gate; approximately `0.900s`. |
| `npm run test:release-assets` | **PASS** | 65 referenced assets, 165 badge PNGs, and 21 Pet Home WebPs checked; approximately `1.284s`. |
| `npm run test:pet-breeding-odds` | **PASS** | 1,000,000 deterministic rolls; approximately `1.912s`. |
| `npm run check:tooling-handoffs` | **PASS** | Generated-handoff drift gate; approximately `1.160s`. |
| `npm run scan:data` | **BLOCKED — SAFE TARGET/CREDENTIALS REQUIRED** | No local database credentials; no database-backed result exists. |
| `npm run ledger:audit` | **BLOCKED — SAFE TARGET/CREDENTIALS REQUIRED** | No local database credentials; no economy-ledger result exists. |
| `npm audit --audit-level=high` | **PASS** | Root audit reported 0 vulnerabilities; approximately `1.0s`. This does not replace the separate client audit. |
| `npm --prefix shinobij.client audit --audit-level=high` | **PASS** | Client audit reported 0 vulnerabilities; approximately `1.43s`. |
| `npm run build` | **PASS** | Final exact-tree server/client build, dist verification, and size gate passed. Reported server output `99.1 KB`, client dist `300.2 MB`, tracked budget `7.84 MB` raw / `2.37 MB` gzip, and all emitted JS/CSS `7.38 MB` raw / `2.26 MB` gzip. |
| `npm run certify:release` | **PASS** | Freshly rebuilt artifact: 87/87 checks; approximately `17.83s`. Local compiled-artifact certification only. |
| `npm run soak:smoke` | **PASS** | Freshly rebuilt artifact: 172 calls, 0 errors, 24/24 users, health p99 `2ms`; approximately `18.51s`. This is a local in-memory smoke, not capacity certification. |
| `npm --prefix shinobij.client run lint` | **PASS** | Client lint; approximately `105s`. |
| `npm --prefix shinobij.client run build` | **PASS** | Client typecheck/production build; approximately `79.7s`. |
| `cd shinobij.client; npx playwright install --with-deps chromium firefox webkit; cd ..` | **PASS** | Browser install exited zero; approximately `2.68s`. |
| `npm --prefix shinobij.client run test:e2e` | **PASS** | 95 passed, 87 project-filtered skips, 0 failed; approximately `2.9m`. Local Windows/browser evidence only. |
| `npm --prefix shinobij.client run test:e2e:combat-layout` | **PASS** | 20 passed, 10 intentional project-filtered skips, 0 failed; approximately `16.4m`. The WebKit combat file was the slow file at approximately `8.0m`. |

## Additional applicable existing gates

| Command | Status | Coverage |
| --- | --- | --- |
| `npm run test:hollow-gate-soak` | **PASS** | One test, 50,000 replays, `261.99 ms`. Local deterministic soak only. |
| `npm run certify:clan-boss-operation` | **PASS** | 78/78 checks; approximately `5.4s`. Local focused certification, not disposable-staging or multi-human proof. |
| `npm run audit:clan-boss-balance` | **PASS** | Exit zero; approximately `1.36s`. |
| `npm run check:story-content` | **PASS** | Four assets; `566126` raw bytes / `143154` gzip bytes; approximately `0.71s`. |
| `npm --prefix shinobij.client run test:e2e:visual` | **PASS after repair** | The deterministic Central Hub image initially failed twice by 40,606 pixels (`4%`). Its August 5 baseline predated the August 7 player-focus UI. Only that baseline was regenerated; the final run passed 4/4 in `11.3s`. |
| `npm --prefix shinobij.client run test:e2e:visual:size` | **PASS** | Four PNGs total `2,605,263` bytes, below the `3,145,728`-byte cap. |
| `npm --prefix shinobij.client run test:e2e:warfront` | **PASS / PERFORMANCE WARNINGS** | 8 passed, 16 intentional DPR-filtered skips, 0 failed in `3.1m`. Browser telemetry reported repeated `100–3,114ms` long tasks and a `THREE.Clock` deprecation; the missing-atlas 404 was the deliberate fallback case. |
| `npm --prefix shinobij.client run test:e2e:live` | **DEFERRED — SUPPLEMENTAL** | This extra suite is not in the handoff's exact Phase-0 command set. Release certification and combat-layout cover its required baseline paths; run it when its live-Express journeys are changed. |

There are no separate package aliases for broad Story, Tower, PvP, Pet Showdown, or economy unit suites; their checked-in unit/contract coverage is collected by the root `npm test` auto-discovery. This must be kept explicit when CI is split so those tests are not silently lost.

The explicit local Phase-0 baseline is complete. Later code changes must rerun the
relevant gates. The focused backup pass remains hermetic and does not certify a
real restore; both credential-blocked database commands and the external checks
above remain open release evidence rather than inferred passes.

## Execution and evidence rules

When the gate is run, record for every command:

- exact command and runtime versions;
- start/end time and duration;
- pass, fail, canceled, blocked, or not applicable;
- executed test count and final summary;
- artifact/evidence path;
- exact failure or external blocker.

A canceled run, missing final summary, zero-test discovery, unavailable credentialed check, or stale historical report is not a pass.
