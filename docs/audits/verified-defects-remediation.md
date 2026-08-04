# ShinobiX Verified-Defect Remediation Pass

Date: 2026-08-03
Repository: `NinjaK`
Branch: `main`
Starting commit: `ecb4e3bbfb5816620a1f2abf91df7c832709674f4f`

## Executive result

The explicitly authorized non-asset remediation work is implemented and passes the local verification gates below. Breeding and mythic asset work is owned by a separate session and is deliberately not assessed or claimed here. The remaining items are environment limitations, not claims of Railway, production PostgreSQL, physical-device, or release certification.

The pre-existing dirty worktree was preserved. No reset, clean, stash, commit, push, pull request, deployment, Railway environment mutation, or production-data mutation was performed.

## Defect status matrix

| ID | Status | Remediation and evidence |
| --- | --- | --- |
| `SX-SEC-001` | **Fixed** | Generic player saves now treat Ryo as server-authoritative: non-admin incoming Ryo is bounded to the stored value, and an upward write is rejected with `409 RYO_SERVER_AUTHORITY`. Ownership parity now includes Miraa wager date/count fields. Covered by the save ownership/integrity suites and the full suite. |
| `SX-BREED-001` | **Not changed** | Excluded from this session at the user's direction because breeding/mythic asset completion is active in another session. No status judgment is made here. |
| `SX-ECON-001` | **Fixed** | Miraa start/report now use durable settlement records, stable request identities, persisted roll seeds, receipts, replay handling, token recovery after short-lived-token loss, and one-time debit/credit application. Coverage includes underfunded, invalid, win, loss, forfeit, replay, expired/deleted token recovery, quota ordering, and legacy-path rejection. |
| `SX-ECON-002` | **Fixed** | Clan and village treasury transfers now use the shared durable reserve-first cross-key settlement helper. Source debits and receipts persist before recipient credit; locks are deterministic and fail closed; fresh recipient validation and retry behavior are covered by injected recipient-save failures and replay tests. |
| `SX-ECON-003` | **Fixed** | Miraa affordability is checked before quota mutation. The regression test confirms an underfunded wager changes neither balance nor wager quota. |
| `SX-DB-003` | **Fixed** | Seal-pool donation uses durable receipts, deterministic fail-closed locks, retry-safe donor/pool writes, and correct persisted pool balance assignment. The injected pool-write failure test confirms retry credits the pool exactly once. |
| `SX-DB-004` | **Fixed** | Profession selection uses a fail-closed lock, returns idempotent success for the same profession, and rejects a conflicting profession or lock contention. |
| `SX-UX-001` | **Fixed** | Pet breeding status polling now has request sequencing, abort/unmount handling, and save-version guards so stale responses cannot overwrite newer state. Pure guard tests cover overlapping responses and version mismatch. |
| `SX-UX-003` | **Fixed** | Pet Home tab targets now have a 44px minimum height. The built client and responsive browser suite pass. |
| `SX-LEGACY-001` | **Fixed** | Legacy visibility is gated by a server-authoritative definitions probe plus local preference. Local settings can hide content but cannot expose it when the server says disabled or unknown. The legacy journey suite and visibility matrix pass. |
| `SX-PET-001` | **Fixed** | Warfront event/objective/result keys are stable and team-qualified. The E2E suite listens for duplicate-key warnings precisely and passes all four scenarios without a relevant duplicate-key warning. |
| `SX-MAINT-001` | **Fixed** | Current topology is documented as Railway active, with cPanel/Passenger and Vercel described as retired compatibility/recovery references. `docs/RETIRE_CPANEL_RUNBOOK.md`, `Dockerfile`, `server.ts`, and `api/_storage.ts` now distinguish current operation from historical cutover material. |
| `SX-OPS-001` | **Fixed** | Scheduled work now claims distributed per-job leases with cadence-sized success dedupe windows. `DISABLE_SNAPSHOT_CRON` stops only snapshot boot/catch-up work, while the global switch still stops all jobs. Ranked rollover now holds a two-hour lock, persists the original settlement plan, and atomically writes each reset/reward with an in-save season receipt, so a partial failure retries without changing podium membership or paying/resetting anyone twice. |
| Battle-lock start race | **Fixed** | Battle start and resolve now serialize on the battle key with fail-closed locks; defeat persistence also locks the player save. Concurrent starts preserve one authoritative battle, stale resolution cannot clear a newer battle, and contention returns a retryable 503. |
| Shared-item tombstone divergence | **Fixed** | Item tombstones now persist across every dual-read source and suppress stale admin, built-in, and player-owned fallback copies. Shop and combat resolution use the same deletion semantics, preventing a later source from resurrecting deleted content. |

## Durable settlement design

The new `api/_durable-settlement.ts` module persists a settlement identity, idempotency key, request fingerprint, actor/resource/amount, state, attempts, failure reason, result metadata, and completion time. The state model is:

```text
pending -> reserved -> debit-applied -> credit-applied -> completed
   \-> cancelled           \-> reconciliation-required
                                  \-> completed on same-request recovery
```

`cancelled` records represent business-rule rejection before either economic side changed; the same idempotency key may be revalidated later. Partial writes are promoted immediately to `reconciliation-required`. A five-minute in-process scanner marks older non-terminal journals after 15 minutes without moving value itself. It uses per-transaction pending pointers during frequent passes and performs a full legacy repair scan only on boot or an explicit admin scan, avoiding a recurring wildcard scan of the 90-day journal.

Full admins can inspect records and trigger a bounded scan through `GET/POST /api/admin/economy-settlements`. `DISABLE_SETTLEMENT_RECONCILIATION=1` stops only the recurring scanner; `DISABLE_SCHEDULED_JOBS=1` remains the global scheduled-job control. `refunded` remains represented for future recovery workflows, but no automatic refund route was added.

Cross-key transfers use deterministic lexical lock ordering and `failClosed: true`. Both locked records are validated before the first debit. A recipient-save or completion-journal failure leaves receipts and the durable transaction available for the same-request retry; the retry does not debit or credit either side twice. The retired unreachable clan/village transfer implementations were removed.

## Verification record

### Targeted and full automated tests

- Focused settlement recovery/locking set: **38 passed**.
- Scheduler/ranked, battle-lock, and tombstone follow-up set: **49 passed**.
- Full repository runner: **4,767 passed, 0 failed, 722 suites**.
- Client lint: **0 errors, 7 existing warnings**.
- Client and server TypeScript checks: passed.

Fault-injection coverage includes durable index-write failure, reconciliation-record write failure, completion-journal failure, recipient save failure for both clan and village transfers, and seal-pool write failure. Concurrency coverage drives six identical cross-key requests simultaneously. These tests verify durable recovery, cancellation without false pending alerts, and exactly-once receipts rather than only happy-path responses.

### Production gates

Results:

- Root/server build: passed.
- Client TypeScript/Vite production build: passed.
- `verify:dist`: passed; no authoring sources in client dist and no Vercel config.
- Release assets: passed; 65 achievement references, 165 badge PNGs, and 20 Pet Home WebPs verified.
- Size check: passed with the existing warning at **6.85 MB** budgeted product JS/CSS.
- Static Railway configuration check: passed for one replica, `node dist/server.js`, and `/health`.
- `git diff --check`: passed; Git only emitted normal LF/CRLF normalization warnings.

### Browser verification

- Prior remediation cross-browser smoke suite: **30 passed, 19 skipped** across Chromium, Firefox, WebKit, compact/mobile, and tablet projects; no failures.
- Prior remediation Warfront suite: **4/4 passed** in single-worker Chromium.

The Warfront server output still contains known non-failing diagnostics for long tasks, the deprecated `THREE.Clock` API, and the existing pet atlas 404 fallback. These runs are browser/emulator verification only; they are not physical-device performance certification.

## Remaining limitations and explicit non-claims

- Breeding and mythic asset work is excluded from this report's conclusions and remains owned by the separate active session.
- Railway deployment state, Railway environment variables, production PostgreSQL, and production data were not inspected or changed.
- The scanner flags and surfaces stale journals but does not autonomously decide credits or refunds; recovery remains same-request or full-admin driven.
- No broad database redesign, hatch-modal accessibility overhaul, physical-device performance pass, or broad visual polish was performed.
- The existing seven client lint warnings and the product bundle size warning remain.
- This report does not certify the game as release-ready, production-verified, or fully audited.

## Change-control record

The working tree contained substantial user-owned changes before this pass. They were left in place. Asset changes from the separate session were observed during verification and were not edited or claimed here. This session's continuation includes durable settlement cancellation/reconciliation, the pending-pointer scanner, the full-admin operator route, failure/concurrency tests, removal of unreachable treasury implementations, distributed scheduled-job leases, retry-safe ranked rollover, battle-lock serialization, and unified item tombstones. No migration was added. No files were staged or committed.
