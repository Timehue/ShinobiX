# ShinobiX hardening progress

Updated: 2026-08-27

## Current Phase

Phase 0 (repository discovery) and Phase 1 (source-of-truth audit) are complete for the active runtime and the primary combat family. A Phase 2 readiness matrix has been produced from existing executable coverage. The first authorized import-only cleanup is complete and verified.

The inventory/economy maps and targeted security, performance, scaling, load, and recovery audits are complete for this safe pass. The 100-player result is local/in-memory evidence, not a production-capacity claim; production data, PostgreSQL load, live restore, and multi-replica behavior remain explicitly unverified.

## Audit identity and worktree state

- Repository: `https://github.com/Timehue/ShinobiX.git`
- Commit at audit start: `03d433fc90abd6879c242aa59bc24bbe697094ad`
- Live `origin/main` verified before publication: `6d5289dd483d86ca37704e18f8d6551f1639a396` (the repository advanced concurrently during the audit)
- Branch: `codex/pvp-ci-live-20260826`
- Local runtime: Node `v24.15.0`, npm `11.12.1`
- Supported/container runtime: Node 22+, Docker pinned to `22.23.1`
- Active deployment config: Railway Docker, one replica, `node dist/server.js`

The worktree was already dirty and changed concurrently during the audit. Pre-existing edits included save/state-ownership work, `App.tsx`, onboarding/academy narrative, intro cinematic, profile styling, guide/claim helpers, assets, account-deletion tests, and trailer tools. `api/save/_state-ownership-parity.test.ts` and `IntroCinematicPreview.tsx` appeared or changed during the audit. None of those user-owned source files were edited by this hardening phase.

## Files Inspected

### Runtime and deployment

- `server.ts`, `app.js`, `railway.json`, `Dockerfile`
- root/client `package.json` and lockfiles
- `.github/workflows/ci.yml`, CodeQL, Clan Boss operation, and visual workflows
- `scripts/run-tests.mjs`, build-size, distribution, runtime-mode generation, release/readiness/rollback/backup/restore/integrity/soak scripts
- frontend `main.tsx`, `App.tsx`, auth/live-capability/bootstrap helpers

### Platform boundaries

- `api/_storage.ts`, `supabase-schema.sql`, checked-in Supabase migrations
- `api/_auth.ts`, player/admin auth routes, CORS/body/security/rate-limit helpers
- `api/save/[name].ts`, state-ownership manifest, save versioning, elapsed-state settlement
- `api/_realtime/**`
- `api/cron/_scheduler.ts`, `_job-lease.ts`

### Combat and mode ownership

- `api/combat-core/**`
- `api/pvp/session.ts`, `move.ts`, tags/catalogs, mutation, timeout, receipt/reward/recovery helpers
- `api/solo-pve/**`
- `api/towers/**`
- `api/combat-adapters/**`
- Clan Boss and Hollow Gate handlers/stores/tests
- `shared/runtime-mode-registry.ts` and its generator/output
- representative pet, war, mission, story, Card Clash, item, inventory, shop, bank, economy, crafting, progression, clan, village, and admin entrypoints

### Tests

The audit inventoried and/or executed combat-core, PvP, Solo PvE, Tower, Clan Boss, Hollow Gate, runtime-registry, route-wiring, save-ownership, legal prerender, and client component/data/lib tests. The repository has 1,050 discovered test/spec files at this snapshot.

### Security, performance, and recovery

- body-limit routing, HTTP security headers, CORS, request metrics, authentication/session/admin gates, rate limiting, image/content validation, Socket.IO client events, realtime stores, and graceful shutdown
- generic lock, save mutation, cross-key settlement, durable economy transaction/telemetry paths, PostgreSQL query/cache/index behavior, schema RLS/RPC/cron rules
- deployment, rollback, backup/restore, release certification, load soak, dependency advisories, secret-pattern scan, and balance simulators

## Verified Architecture

- React/Vite is served by one Express/Socket.IO Railway process.
- Every Vercel-shaped API handler is explicitly imported and mounted in `server.ts`; route-contract tests enforce reachability.
- PostgreSQL/Supabase `public.kv_store` is the physical application store. Atomic RPCs support NX, compare-set, increment, and hash changes.
- Player HTTP and socket identity converge on `api/_auth.ts`; socket event identity is bound at handshake.
- Persisted rewarded combat uses KV sessions, locks/CAS, sealed authority, and receipts. The live Socket.IO pet duel is intentionally memory-only and unrewarded.
- Scheduled durable jobs use exact-owner distributed KV leases even though Railway currently declares one replica.
- The primary shinobi combat family already shares core formulas, geometry, action planning, statuses, cooldown primitives, and jutsu effects. Solo imports the PvP resolver; Tower maps N-actor state through the adapter into that same resolver.
- Pet, Chronicle/Card Clash, and other registered engines are explicit separate authorities, not accidental copies of the shinobi engine.
- The executable runtime registry has 61 rows: 56 matches, three surface gaps, one known compatibility defect, and one owner decision.

See `ARCHITECTURE_MAP.md`, `SOURCE_OF_TRUTH_AUDIT.md`, and `COMBAT_REGRESSION_MATRIX.md` for evidence and boundaries.

## Baseline verification

| Check | Result | Evidence / interpretation |
| --- | --- | --- |
| `npm test` | **PRE-EXISTING/ENV FAILURE** before tests | `npm ci --prefix shinobij.client` could not unlink a locked native Rolldown binding (`EPERM`). This was an interrupted local install condition, not a source assertion. |
| `node --import tsx scripts/run-tests.mjs` in sandbox | **ENV FAILURE** | Test workers could not spawn (`EPERM`). The same command was rerun outside the sandbox. |
| Full discovered suite outside sandbox | **8,218 PASS / 29 FAIL / 8,247 total** | Runtime about 317 seconds. Combat suites were green. Failures were one save-ownership parity mismatch from concurrent edits, 27 client/prerender failures caused by missing `react-dom` after the interrupted install, and the `App.tsx` line ratchet. |
| `npm install --prefix shinobij.client` | **PASS** | Restored the missing client dependency; reported zero vulnerabilities and did not change a lockfile. |
| Rerun of the 29 affected tests | **108 PASS / 1 FAIL** | Save parity passed after its concurrent test update; all 27 missing-React failures passed. Only `App.tsx` remained over its line budget: 7,546 actual versus 7,538 maximum. |
| Current live-main changed-file verification | **7 PASS / 0 FAIL** | At `6d5289d`, the concurrently landed `App.tsx` reduction resolved the former ratchet failure; account-deletion and plaintext-prompt guards also passed. This was not a hardening-document change. |
| `npm run build:server` | **PASS** | TypeScript server build passed. |
| `npm run build:client` | **PASS outside sandbox** | Generated-story check, client project build/typecheck, Vite bundle, and prerender completed. The sandbox-only attempt failed to spawn Vite and was rerun with approval. |
| `npm run verify:dist` | **PASS** | Server distribution about 104.9 KiB; client distribution about 335.6 MiB; no authoring sources; no Vercel configuration. |
| `npm run sizecheck` | **PASS with warning** | Product JS/CSS about 7.54 MiB raw / 2.29 MiB gzip; story JSON about 552.9 KiB / 139.8 KiB gzip; combined tracked about 8.08 MiB raw / 2.43 MiB gzip; initial graph about 1.38 MiB raw / 373.2 KiB gzip. |
| `npm run check:runtime-mode-docs` | **PASS outside sandbox** | Generated registry is current. |
| Focused post-refactor combat suite | **123 PASS / 0 FAIL** | Core grid/AOE, PvP compatibility AOE, Tower canonical parity, Tower N-actor AOE, and Tower engine tests passed. |
| Focused server safety suite | **228 PASS / 0 FAIL** | 29 suites covering route wiring, request limits, authentication, admin sessions, rate limiting, locks, economy, storage authority, schema security, presence, pet-duel sessions, and release operations. |
| Post-refactor `npm run build:server` | **PASS** | The direct core imports typecheck and compile. |
| `npm run certify:release` | **90 PASS / 0 FAIL** | Isolated real-server journey covered save authority, reward survival, Solo PvE, PvP replay/settlement, and receipt authorization. |
| `npm run test:backup` | **16 PASS / 0 FAIL** | Backup checksums, topology, representative records, cleanup, and same-target refusal passed. No live export/restore was performed. |
| Deployment / rollback / mission / assets | **PASS** | `check:deployment`, `check:rollback-readiness`, `test:mission-eligibility`, and `test:release-assets` passed. |
| Pet breeding odds | **PASS** | One million deterministic rolls exactly matched the expected counts. |
| Clan Boss balance | **COMPLETED** | Twelve deterministic seeds for each boss and 1/2/4-player party size; offline tuning evidence only. |
| PvP balance | **NOT BALANCED** | 3,200 fights completed in about 351 seconds; the simulator reported 150 tuning flags. No balance values were changed. |
| 100-player local soak | **PASS** | 3,777 calls, zero errors, 46.2 req/s; endpoint p95 3–5 ms. In-memory KV, not PostgreSQL, and no Socket.IO lane. |
| Production data / ledger / live restore | **NOT RUN** | Credentials/external state were intentionally not used. These remain production/staging gates. |
| Browser E2E | **NOT RUN** | No screen/component source was changed by this phase. The existing dirty UI work belongs to another actor. |

No new failure was introduced by the audit documents or the import-only refactor. The focused combat suite, server build, runtime-mode documentation check, and diff check all passed after the change.

## Tests Added

None. The repository already contained adequate characterization for the first narrow change:

- exact combat formula and grid/AOE tests;
- every shipped jutsu inventoried and assigned to a behavior family;
- full-catalog PvP/Solo differential parity;
- Tower-to-PvP non-positional tag parity;
- Tower N-actor cast-scope/hit-scope/determinism tests;
- action idempotency/concurrency/recovery tests for PvP, Solo, and Tower;
- parent/child authority and adversarial settlement tests for Hollow Gate.

Adding a duplicate assertion would not reduce uncertainty. The missing cross-mode equipment snapshot fixture is recorded as a prerequisite for a later equipment-builder consolidation.

## Changes Made

- Added `ARCHITECTURE_MAP.md` with the verified active runtime, storage, realtime, scheduler, domain, and deployment map.
- Added `SOURCE_OF_TRUTH_AUDIT.md` with rule-by-rule combat ownership and proven divergence classification.
- Added `COMBAT_REGRESSION_MATRIX.md` with current coverage and explicit extraction gaps.
- Added `ITEM_CREATION_MAP.md` with checked-in item definitions, player-facing faucets, sinks, transfers, invariants, and unresolved production-data questions.
- Added `ECONOMY_FLOW_MAP.md` with all nine ledger fields, their source/sink paths, locking/receipt boundaries, telemetry coverage, and saga risks.
- Added `SECURITY_AUDIT.md`, `PERFORMANCE_AUDIT.md`, and `SCALING_AUDIT.md` with severity/evidence tables, measured local load, horizontal blockers, and recovery behavior.
- Added `FINAL_HARDENING_REPORT.md` with verified improvements, remaining sources of truth, technical-debt priorities, and evidence-backed scores.
- Added this progress ledger.
- Changed Tower geometry imports from the historical `pvp/_aoe.ts` compatibility wrapper to their canonical owners, `combat-core/grid.ts` and `combat-core/aoe.ts`. The wrapper remains intact for existing callers.
- No formula, balance, AP, cooldown, reward, item, economy, save schema, database schema, public API, or UI behavior was changed.

## Regressions Found

### PROVEN BUG

- `pet-ranked-legacy-compat` can present a cinematic winner that legacy settlement rejects for already-issued compatibility notices. Current Pet Ladder admission does not enter this path.
- A participant in the unrewarded live pet duel can emit `petduel:finished` immediately. The server deterministically replays and ends the fight without gating the hint on observed terminal progress, despite the inline comment saying a premature hint is ignored. This does not mint rewards, but it violates the documented live protocol expectation.

### No new regression

- The historical `App.tsx` line-budget failure predated and was unrelated to these documentation changes. Concurrent live-main commit `6d5289d` subsequently resolved it, and the focused ratchet/security rerun passed 7/7.
- The initial save-parity and missing-React failures were not stable source regressions: they cleared after the concurrent test update and dependency restoration.

## Pre-existing Failures

- None remain in the affected baseline set on verified live main. The earlier `App.tsx` 7,546-versus-7,538 ratchet failure was resolved by concurrent commit `6d5289d`; this hardening pass did not edit that file.

## Unknowns

- Live admin-published content was not queried. The shipped 217-jutsu inventory is exact for checked-in built-in/legacy content, not a claim about current production rows.
- No production database scan or currency-ledger audit was run; data integrity remains unverified for this snapshot.
- Production-only/admin-published items and live economy rows were not queried; `ITEM_CREATION_MAP.md` and `ECONOMY_FLOW_MAP.md` are exact for checked-in code, not current production data.
- The 100-player measurement used local in-memory KV and an HTTP-only workload. PostgreSQL pool/query pressure, Socket.IO fanout, CPU/RSS, event-loop delay, and a full mixed game workload are unknown.
- No live multi-replica experiment has been run. Code inspection proves process-local Socket.IO rooms/presence/live duels, but not a measured failure rate.
- No live shinobi Stealth effect was found. It is unknown whether a product surface expects one.

## Risks

### ARCHITECTURAL RISK

- `api/pvp/move.ts` is simultaneously an HTTP handler and the shared effect library imported by Solo and Tower. A future extraction is justified, but only after wrapper-boundary logs/FX/status timing are pinned.
- Basic actions and some validation shells are repeated across modes. Existing parity is safer than speculative unification.
- Cross-key economy workflows use several receipt/lock/saga abstractions. Their use must be mapped before consolidation.
- Generic distributed locks have a five-second, non-renewing TTL. Exact release is safe, but a slow critical section can lose mutual exclusion after expiry; no duplicate was reproduced.
- The generic save handler and state-ownership contract were changing concurrently; no audit edit should be layered onto them until that work stabilizes.

### PERFORMANCE RISK

- Railway's direct pool defaults to 15 connections. The one-second game loop and API traffic share the process; real query/latency measurements are still needed.
- The game-loop interval does not await async sleeper materialization. Current work is bounded by removals, but overlap should be instrumented before adding database-heavy tick work.
- Client distribution and product JS/CSS are large enough to trigger the existing size warning, though current budgets pass.
- Selected routes permit a 50 MB JSON parse before handler authentication; legitimate inputs on several of those routes are much smaller.
- Economy telemetry rewrites a capped list of up to 5,000 transactions per instrumented delta.

### SCALING RISK

- Presence, Socket.IO rooms, live pet-duel sessions, in-memory rate limits, and caches are replica-local. Two replicas would not form one coherent realtime world without affinity or a shared adapter/state design.
- Durable scheduled jobs are lease-safe, but the realtime one-second loop is not a distributed simulation and should remain soft-state-only.

## Next Safe Step

1. Narrow/gate the pre-authentication large-body routes with route-limit tests.
2. Instrument lock hold duration and characterize pet-duel progress/finish cadence before changing either concurrency protocol.
3. Run a PostgreSQL-backed mixed 100-player staging soak, read-only ledger/data scan, and disposable live restore drill.
4. Do not extract `applyJutsu` yet. First add a wrapper-boundary golden fixture for logs, FX/VFX, status activation fields, ground serialization, and shields.
