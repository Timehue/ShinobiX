# ShinobiX architecture hardening report

- Audit/refactor snapshot: 2026-08-27
- Audit-start commit: `03d433fc90abd6879c242aa59bc24bbe697094ad`
- Live `origin/main` verified before publication: `6d5289dd483d86ca37704e18f8d6551f1639a396` (repository advanced concurrently during the audit)
- Branch: `codex/pvp-ci-live-20260826`

## Executive Summary

ShinobiX is safer to change than it was at the start of this pass because its active runtime, domain ownership, combat rules, item faucets, economy flows, realtime boundaries, and operational evidence are now written down from executable code. The first refactor was deliberately tiny: Tower imports hex distance and filled-disk geometry directly from their canonical combat-core modules instead of through a PvP compatibility wrapper. It changed no formula or data shape and passed 123 focused tests plus the server build.

The audit did **not** certify every production row or claim unlimited scalability. It found a strong server-authoritative core with extensive replay/concurrency tests, alongside five material boundaries that need follow-up: a pre-authentication 50 MB parse surface, non-renewing five-second critical-section locks, process-local realtime/live pet duels, incomplete/expensive economy telemetry, and a PvP balance simulator that reports 150 tuning flags.

The local application layer carried 100 modeled concurrent players with zero errors. PostgreSQL, Socket.IO fanout, CPU/RSS, and a full mixed game workload remain unmeasured, so the correct production posture is still one Railway replica.

## Verified Improvements

- Added a verified active-runtime and domain map in `ARCHITECTURE_MAP.md`.
- Added rule-by-rule canonical combat ownership and divergence classification in `SOURCE_OF_TRUTH_AUDIT.md`.
- Added a combat coverage gate covering the shipped 217-jutsu catalog, 33 accepted canonical effect/tag families, targeting, equipment, resources, replay, modes, and terminal authority.
- Added checked-in item creation and all nine currency source/sink maps.
- Removed Tower's false dependency edge through `pvp/_aoe.ts`; the compatibility module remains for other callers.
- Restored the interrupted client dependency installation without changing lockfiles.
- Ran deployment, rollback, backup, asset, mission, breeding-odds, release-certification, build, distribution, runtime-registry, combat, balance, and 100-player checks.
- Added targeted security, performance, scaling, and failure-recovery findings with explicit test/production boundaries.

## Baseline and regression status

| Check | Result |
| --- | --- |
| Full discovered suite | 8,218 pass / 29 fail of 8,247 before dependency repair |
| Affected baseline rerun | 108 pass / 1 pre-existing fail after repair |
| Historical remaining failure | `App.tsx` was 7,546 lines vs ratchet maximum 7,538 at the audit snapshot; the hardening pass left that user-owned file untouched |
| Current live-main changed-file verification | 7/7 pass; concurrent commit `6d5289d` resolved the former `App.tsx` ratchet and its account-deletion/security guards pass |
| Focused post-refactor combat | 123 pass / 0 fail |
| Focused server safety suite | 228 pass / 0 fail across 29 suites |
| Server build | Pass |
| Client build/prerender | Pass outside sandbox |
| Distribution verification | Pass |
| Runtime-mode registry generation check | Pass |
| Release certification | 90/90 pass |
| Backup evidence | 16/16 pass |
| Deployment / rollback readiness | Pass / pass |
| Mission eligibility / release assets | Pass / pass |
| Pet breeding odds | One million deterministic rolls; expected distribution exactly observed |
| Clan Boss balance | Completed, 12 seeds per boss/party size |
| PvP balance | 3,200 fights; tool verdict `NOT BALANCED` with 150 flags |
| 100-player local soak | Pass: 3,777 calls, 0 errors, 46.2 req/s |

The initial `npm test` pretest failed because Windows could not unlink a locked Rolldown native binding. Direct test workers also could not spawn inside the sandbox. Both conditions were separated from source failures and relevant commands were rerun outside the sandbox. No new test or build failure was introduced by this work.

## Remaining Sources of Truth

| Area | Status | Reason / next gate |
| --- | --- | --- |
| Shinobi jutsu effects | Shared implementation lives in `api/pvp/move.ts`, imported by Solo and used by Tower through an adapter | Correctly shared but poor module boundary: HTTP handler and effect library coexist. Add wrapper-boundary golden logs/FX/status/ground fixtures before extraction. |
| Geometry/AOE | Canonical in `combat-core`; `pvp/_aoe.ts` remains a compatibility export | Intentional temporary duplicate surface, not duplicate logic. |
| Basic actions/turn shells | Implemented per mode | Some differences are mode policy. Build an explicit intended-equality table before sharing. |
| Equipment admission/builders | Mode-specific normalizers with shared formula pieces | Add one cross-mode saved-character snapshot fixture before consolidation. |
| Terminal/reward orchestration | Mode-specific | Intentional: objectives, participants, parent/child proof, and rewards differ. |
| Pet and Chronicle combat | Separate engines | Intentional separate games; do not force them into shinobi combat core. |
| Inventory add/stack helpers | Several domain-local helpers | Policies differ (unique, counted, capped, duplicate instance). Characterize before unifying. |
| Economy transactions | Several receipt/saga abstractions | Functional specialization plus historical layering. Build a writer/settlement registry before consolidation. |
| Runtime entrypoints | `server.ts` active; `app.js` retained | Intentional Railway vs dormant cPanel/Passenger recovery compatibility. |

## Combat

### Centralized today

- grid distance/neighbors/pathing and AOE footprints;
- AP/resource costs and adjustment helpers;
- cooldown/status primitives;
- formulas and stat/equipment multipliers;
- action/jutsu planning and cast reduction;
- canonical tags/aliases and full-catalog inventory;
- shared `applyJutsu` effects across PvP, Solo, and Tower's adapter path.

Tower now imports geometry directly from the canonical modules. Solo already calls the PvP effect resolver, and Tower's canonical parity suite compares its non-positional tags to that resolver.

### Mode-specific by design

- session admission, action envelopes, AI, hazards, objectives, scheduling, logs/VFX timing, victory, parent/child proof, and rewards;
- pet cinematic/warfront/ladder engines;
- Chronicle/Card Clash rules.

### Regression and balance

Every shipped built-in/legacy jutsu is inventoried; unknown tags fail tests. Cross-mode differential tests and Tower canonical/N-actor tests protect the shared behavior. The post-refactor focused suite passed 123 tests.

Correctness is not the same as balance. The deterministic PvP audit ran 3,200 legal crossed fights and reported 150 flags. Examples: Sustain ranged from 71.7–93.3% in several level bands; Disruption fell to 6.7% at both endgame gear profiles; perfect named gear drove Ground to 87.5%. Seat remained 50/50, and higher-level runs exercised all 33 tags. No balance constant was changed in this architecture pass.

The known `pet-ranked-legacy-compat` cinematic-vs-legacy settlement disagreement remains a proven compatibility bug outside the current ladder path. The live pet-duel terminal hint also needs characterization because the server can replay/finish immediately when a participant emits `petduel:finished`.

## Economy

The authoritative currency fields are `ryo`, `bankRyo`, `honorSeals`, `fateShards`, `boneCharms`, `auraStones`, `auraDust`, `mythicSeals`, and `hollowShards`. Balances live in `save:<player>`. `ledger:currency:<player>` is a best-effort versioned projection, and `econ:*` is best-effort telemetry—not gameplay authority.

Major shops, sales, bank operations, crafting, missions, story, world, combat rewards, treasury movements, and war flows derive amounts from server catalogs/proof. Modern one-save writers use fail-closed lock plus exact CAS; cross-key writers use ordered locks, receipts, sagas, compensation, and reconciliation.

Remaining risks:

- production ledger/data scans were not run;
- telemetry coverage is explicitly a floor rather than a census;
- `econ:txns` rewrites up to 5,000 JSON records per instrumented delta;
- transaction-recent indexes use repeated non-CAS RMW and can lose observability entries;
- cross-key operations are not atomic database transactions;
- a five-second non-renewing lock can expire before a slow critical section finishes.

## Inventory

All checked-in item creation paths were mapped: first save, shops/packs, missions/story, dungeons, war/weekly/ranked rewards, chests/events, crafting/named forge, Hollow Gate, Anbu, Clan Exchange, cafeteria, elemental cores, and admin grants. Important routes validate server catalog/proof and commit debit plus grant inside one save mutation or an explicit saga.

No item behavior changed. Outstanding risks are domain-specific stacking/uniqueness semantics, named-forge recovery publication after the authoritative commit, Clan Exchange refund reconciliation, and absence of a live production scan for negative/orphan/unknown item state.

## Realtime

Socket authentication is strong: the HTTP auth function is reused, identity is bound at handshake, sector input is normalized/lease-constrained, frames are capped at 64 KiB, presence is coalesced to 1 Hz, movement to 80 ms, stale players sweep after 90 seconds, and reconnect/presence snapshots reduce deploy flicker.

The weak boundary is live pet-duel event rate/terminal signaling. Input count is bounded, but progress broadcasts and full replay hints are not. More fundamentally, rooms, presence, and live duel state exist in one Node process. That is correct only because deployment configuration and its test pin one replica.

## Database

The physical model is one JSONB KV row per key in PostgreSQL/Supabase. Primary-key reads, prefix index, expiry index/cron, atomic NX/CAS/increment/hash RPCs, cache exclusions, query timeouts, and a 15-connection Railway pool are verified.

Database concerns:

- application-level multi-key sagas instead of database transactions;
- non-renewing lock TTL/fencing;
- unbounded prefix scans and arbitrary-size direct-PG `mget` arrays;
- whole-save JSONB rewrite cost;
- economy/ledger/receipt write amplification;
- public DB TLS uses encryption without certificate verification;
- PostgreSQL performance was not exercised by the local soak.

## Scaling

The 100-player local HTTP test passed with p95s of 3–5 ms and zero errors. This supports the current one-process application target but is not a production capacity ceiling.

The projected next bottleneck is the real database path: save blob bytes, pool waits, lock duration, and side writes. If `SESSION_SECRET` is absent, blocking scrypt becomes an earlier event-loop bottleneck. Socket hub fanout and live duel replay are also unmeasured.

No 200/300-player results or mixed combat/Card Clash/socket workload exist. Those tests should run only after metrics include CPU, RSS, event-loop delay, pool/query timing, and Socket.IO traffic.

## Horizontal Scaling

Multiple Node replicas are blocked by process-local presence, Socket.IO rooms/user notifications, live pet-duel sessions, local rate-limit buckets, and the one-second soft-state loop. Persisted combat, saves, scheduled jobs, and most economy work are substantially closer to multi-worker readiness because they use shared state and leases.

Do not raise `numReplicas`. If measurements eventually require it, first implement/test cross-node room delivery and shared/fenced presence/live-session ownership, or deliberately keep one realtime owner while scaling stateless HTTP workers. No current measurement justifies Redis or a larger platform redesign.

## Security

| Severity | Finding |
| --- | --- |
| Critical | None found. |
| High | Selected routes permit 50 MB JSON parsing before authentication/rate enforcement. |
| Medium | Unbounded pet-duel progress/finish event work; public DB certificate verification disabled; production session/admin token posture not readiness-gated. |
| Low | Restart may share KV token; AI daily generation counter is best-effort/non-atomic. |

Positive evidence includes shared HTTP/socket auth, session revocation, constant-time admin checks, strict important rate limits, RLS, image/HTML controls, no source secret literals, no known production dependency advisories, and 90/90 adversarial release checks.

## Operations

- Railway Docker, single replica, active `dist/server.js`, and `/health` pinning passed the deployment check.
- Schema rollback readiness passed with no destructive table/column/truncate statements.
- Sixteen hybrid backup/restore evidence tests passed, including checksum, topology, representative record, and same-target refusal.
- The live backup export/restore drill was not run; production credentials were intentionally not used.
- Graceful shutdown stops jobs/realtime/pool and drains HTTP with a four-second backstop. Durable workflows recover selectively; a long generic request may still be cut off.
- `/health` is liveness. Protected `/health/db` is deep readiness with single-flight/cache/rate limit. Railway does not currently restart on database unavailability, which avoids flapping but requires external deep-health alerting.
- Mission eligibility, release assets, distribution verification, build size, runtime registry, and breeding probability checks passed.

## Technical Debt Priorities

### P0 — launch/production threat

- No proven critical data-authority or account-takeover blocker was found.
- Treat the PvP simulator's `NOT BALANCED` verdict as a release decision blocker if competitive ranked fairness is a launch requirement; tune in a separate balance change set with simulator deltas and human play evidence.

### P1 — serious

1. Narrow/gate the pre-authentication 50 MB body routes.
2. Instrument lock hold time and prevent lease expiry from admitting concurrent economic writers.
3. Add pet-duel progress/finish event budgets and terminal characterization.
4. Verify public-DB certificate validation and production secret/token-only readiness.
5. Run a PostgreSQL-backed 100-player mixed staging workload.
6. Run read-only production data/ledger audits and a disposable live restore drill.

### P2 — important

1. Add cross-mode equipment snapshot and `applyJutsu` wrapper-boundary golden fixtures.
2. Replace economy telemetry large-list RMW and build executable writer/settlement registries.
3. Add game-loop sleeper-materialization single-flight duration metrics.
4. Page large key scans and batch reads for background/admin jobs.
5. Prove A/B-worker behavior before any horizontal-scale implementation.

### P3 — cleanup

1. Decompose `server.ts`, `App.tsx`, and mode god-files only behind existing contracts.
2. Retire dormant compatibility wrappers/entrypoints only after operational rollback requirements change.
3. Remove raw admin/restart credential fallbacks after deployment configuration is proven.

## Architecture Score

Scores are out of 10 for the verified snapshot, not aspirational design.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Correctness | 8.3 | 8,218 initial passing tests, 90/90 release journey, exact authority/receipt patterns; live main later resolved the historical ratchet, while two known combat compatibility/protocol issues remain. |
| Maintainability | 7.2 | Clear domain cores and extensive tests, but `server.ts`, `App.tsx`, `pvp/move.ts`, and several saga surfaces are large/mixed-responsibility. |
| Server authority | 8.9 | Forged currency/progression/outcomes rejected; catalogs/proofs derive results; sockets bind identity. Some legacy/best-effort compatibility remains. |
| Security | 7.4 | Strong auth/RLS/rate/image/content controls and clean dependency audit; large pre-auth parsing, socket event abuse, TLS/config risks remain. |
| Combat consistency | 8.5 | Core geometry/formulas/status/action rules shared; full-catalog parity and 123 focused post-change tests. Mode shells and equipment admission still repeat. |
| Economic integrity | 7.7 | Save authority, locks/CAS/receipts/sagas and replay tests are strong; telemetry/census/live ledger audit and lock fencing are incomplete. |
| Database safety | 7.5 | Atomic RPCs, no-cache authority, timeouts, indexes, expiry cron; whole JSONB rows, unbounded scans, multi-key sagas, and TLS verification risk. |
| Realtime architecture | 6.8 | Correct single-process auth, throttled presence/movement, reconnect handling; horizontal incoherence and pet-duel event gaps. |
| Operational readiness | 8.1 | Build/deploy/rollback/backup-test/release/soak tooling passed; no live restore, deep-health is not the platform healthcheck, production data not audited. |
| Scalability | 6.9 | 100-player local HTTP pass with headroom; database/socket/memory metrics and 200/300 tests absent; one replica required. |

Overall evidence-weighted score: **7.7/10**.

## Final recommendation

Keep the architecture evolutionary. The primary combat family is already far more centralized than filenames imply, so the safest work is to strengthen boundaries and evidence rather than relocate thousands of lines. Address the P1 availability/locking/configuration risks, run a real PostgreSQL-backed mixed workload, and separate balance tuning from architecture. Only then consider another narrow extraction such as moving the shared jutsu resolver out of the PvP HTTP module.
