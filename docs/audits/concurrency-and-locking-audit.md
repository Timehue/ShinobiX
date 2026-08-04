# Concurrency, Locks, and Stale-Write Audit — Phase 0 (2026-07-31)

> **Follow-up status (2026-08-03): F4 is RESOLVED.** Battle start and resolve
> now serialize on the battle key with fail-closed locks; defeat persistence
> also takes a fail-closed player-save lock. Concurrent starts retain one
> authoritative battle, and stale resolution cannot clear a newer battle.

> **P0-5 status (2026-08-01,** branch `refactor/currency-ledger-p0-5`**):**
> first step taken against **F8** (multi-replica stale-read risk) and **F9**
> (KV sagas instead of transactions). Player currencies are now projected into
> a versioned side-car ledger (`ledger:currency:<name>`,
> `api/_currency-ledger.ts`) on every hooked save write. The blob remains
> authoritative and nothing reads the ledger for gameplay — the projection
> exists to produce the evidence a read cutover needs, and it reports the one
> signal that matters (same `_saveVersion`, different balances) as a bug.
> `npm run ledger:audit` / `ledger:backfill` are the verification tools;
> the gated sequence to make currency authoritative — hook the remaining
> hand-rolled writers, flag the read cutover, then use a real transaction for
> money moves — is in `docs/runbooks/currency-ledger-cutover.md`. **F8 and F9
> themselves remain open**; this phase buys the ability to close them safely,
> it does not close them.

Baseline: `origin/main` @ `de50b3385`. Claims tagged **VERIFIED** (read from current
code) or **INFERRED**.

## 1. Lock implementation (`api/_lock.ts`, `api/_storage.ts`) — VERIFIED

- **Acquisition:** `withKvLock(target, fn, opts)` → `withLockCore`. Lock key
  `lock:<target>`. Acquire = `kv.set(lockKey, randomUUID(), { nx: true, ex: ttlSec })`
  (`_lock.ts:144-154`). NX is atomic on the live backend via the pg `kv_set_nx`
  SQL function (`_storage.ts:208-215`).
- **TTL:** default **5s** (`_lock.ts:98`). Crashed holders auto-release via TTL.
- **Retry/backoff:** 5 attempts, exponential 25ms·2^n plus jitter (`_lock.ts:104-114`);
  worst case ~775ms. `api/_realtime/travel-lease.ts:100` raises to 8 attempts for
  the player-facing lease claim (documented).
- **failClosed vs fail-open:** default is **fail-open** — on contention, `fn`
  runs UNLOCKED (`_lock.ts:17-21,162-163`). `{ failClosed: true }` throws
  `LockContendedError` *before* `fn` (`_lock.ts:118-120`).
- **CAS release:** `delIfEqual(lockKey, ownerToken)` — atomic conditional DELETE
  (`_storage.ts:236-246`), the recent hardening. Release errors are swallowed
  (`_lock.ts:126`) — the lock lingers to TTL, failing safe. `lock:*` keys are
  always base-routed (`_storage.ts:1246-1250`).
- **No re-entrancy, no fencing tokens:** a holder whose TTL expires mid-`fn`
  keeps running with no protection (comment acknowledges this at `_lock.ts:91-97`).
  Mitigated only by TTL sizing. INFERRED risk.

## 2. Lock hierarchy (observed convention)

De-facto ordering (outer → inner), consistent across nearly all nested sites:

1. **Shared/contended resource first** — village state (`game:village-state:*`),
   war records, clan record (`save:clan-*`), pools/boards, run/session keys.
2. **Player `save:<name>` second** (innermost).
3. **Two same-tier `save:` keys locked in sorted order** (`.sort()`).

`game:*` < `save:*` lexically, so state-first happens to match global sort order
(explicit comment at `api/village/treasury/transfer.ts:188-195`).

## 3. Call-site coverage

All `withKvLock` sites in `api/` were enumerated; highlights (full list retained
in the audit transcript):

| Site | Key(s) | failClosed | Correct resource? |
|---|---|---|---|
| `api/save/[name].ts:2543` (generic save POST) | `save:<name>` | yes | yes |
| `api/save/_mutate-player-save.ts:53` (`mutatePlayerSave`) | `save:<name>` | yes | yes |
| `api/clan/treasury/transfer.ts:144` | clan rec + recipient save, sorted, nested | yes | yes |
| `api/village/treasury/transfer.ts:196,221,266` | village state → recipient save | yes | yes |
| `api/clan/seal-pool/donate.ts:54,110` | donor save → pool (inner pool fail-open **by documented choice**, `:106-109`) | outer yes | yes |
| `api/clan/seal-pool/distribute.ts:69,100,126` | pool → recipient → refund, sequential saga | yes | yes |
| `api/player/trade.ts:103-104` | both saves, sorted, nested | yes | yes |
| `api/pvp/claim-rewards.ts:57-66` (`withSavesLocked`) | all touched saves, sorted chain | yes | yes |
| `api/pet/battle-result.ts:334,381,399` | both saves sorted (ranked); own save (casual) | yes | yes |
| `api/weekly-boss.ts:603-844` | boss state; actor save — sequential saga with compensation | yes | yes |
| `api/village/claim-daily-agenda.ts:134,191` | save; then village state (treasury credit fail-open **by documented choice**, `:184-190`) | personal yes | yes |
| `api/battle/lock.ts:160` (defeat write) | `save:<player>` | **NO (fail-open)** | state-only |
| `api/_realtime/travel-lease.ts:106,126` | lease key; settle nests save via `mutatePlayerSave` | yes | yes |
| Chat/social endpoints | chat/inbox blobs | mostly no (by design) | yes |

**No currency path was found that locks only the actor's save while mutating a
shared resource.** The two deliberately fail-open shared-state credits
(agenda treasury, seal-pool donate credit) run *after* an NX idempotency marker
or debit is consumed, with comments justifying "credit unlocked beats losing the
player's spend."

## 4. Nested locks & deadlock analysis

Verified nesting sites: clan/treasury/transfer (sorted), player/trade (sorted),
pet/battle-result ×2 (sorted), pvp/claim-rewards (sorted chain), pvp/bounty
(board→save), village/treasury/transfer (state→save), hollow-gate-unlock
(state→save), clan/war/declare (war→save), clan/kick (clan→save),
clan/exchange/purchase (clan→save), seal-pool/donate (save→pool),
war-structure (state→war), sector-war/_merc-auto (war→contest), travel-lease
settle (lease→save).

- **F1 (low, INFERRED) — order inconsistency:** `clan/kick.ts:79-91` and
  `clan/exchange/purchase.ts:114+37` always take clan-record before player save,
  while `clan/treasury/transfer.ts:143-144` sorts the same two keys — for a
  player name sorting before `clan-…`, transfer acquires player-first. Cannot
  hard-deadlock (bounded acquire + 5s TTL); worst case mutual 503s. Defeats the
  purpose of the sort convention.
- **F2 (info, VERIFIED):** `seal-pool/donate` nests save→pool against the
  shared-first convention; no cycle exists today (distribute is sequential, and
  the inner acquire is fail-open), but fragile.
- **F3 (info, VERIFIED):** travel-lease self-contention is known and tuned
  (8 attempts, `travel-lease.ts:67-100`); lease→save order is consistent.
- `report-pet-event.ts:373-374` explicitly keeps `awardProfessionXp` outside its
  save lock "so we don't nest lock acquires" — the hazard is a known pattern.

## 5. Optimistic concurrency on the save path — VERIFIED

- Missing `_baseSaveVersion` stamp → 426 (`save/[name].ts:2725-2733`); stale
  (`baseVersion < storedVersion`) → 409 (`:2735-2740`). Clan and admin saves are
  exempt (clan uses a field-level delta validator).
- **F6 (minor, INFERRED):** the CAS is `<`, not `!==` — an inflated echoed
  version passes the guard (sanitizer still clamps content).
- The version check runs inside `withKvLock('save:<name>', { failClosed: true })`
  (`:2543`), the same key every server credit uses — the two layers compose.
- `mutatePlayerSave` → `writeVersionedPlayerSave` → `bumpSaveVersion`
  (`_save-version.ts:96-101`): every server credit bumps under the lock, forcing
  a stale autosave into 409→refetch instead of clobbering. Direct writers
  (weekly-boss, battle-result, kick, declare, hollow-gate-unlock) call
  `bumpSaveVersion` manually — spot-verified; parity test
  `api/save/_version-echo-coverage.test.ts` enforces echo coverage.

## 6. Per-domain verdicts

- **Travel leases:** atomic (failClosed lease lock), idempotent settle
  (re-checks lease + maturity + `sameLease`), self-heal in `lib/sector-reconcile`.
  Two-tab safe (`world:travel-lease:` on the storage no-cache list, `_storage.ts:43`). VERIFIED.
- **Battle lock (screen guard):** start and resolve serialize on the battle
  key with fail-closed locks; defeat persistence also locks `save:<player>`.
  Lock contention returns a retryable 503. **F4 (low, FIXED 2026-08-03).**
- **PvP settlement:** per-battle NX receipt + sorted lock chain, failClosed;
  receipts placed inside the lock — retry-safe, idempotent. VERIFIED.
- **Shops/crafting:** `mutatePlayerSave` + replay receipts
  (`redeemedShopPurchases`/`redeemedShopSales`, `shop/sell.ts:21`). Two-tab safe. VERIFIED.
- **Clan/village treasury:** dual-lock failClosed wrapped in **economy-tx saga
  records** (`api/_economy-tx.ts`: reserved → applied → complete/needs-reconcile,
  90-day TTL, consumed by `admin/economy-reconcile.ts`). Credit-before-debit
  ordering. Failures leave a durable reconcile trail. VERIFIED.
- **F5 (low, VERIFIED):** `world-state.ts:1011` legacy honor-seal deduct is
  fail-open, but the branch is dead (`villageWarEnabled()` force-on).

## 7. Multi-write sagas where a Postgres transaction would be safer — VERIFIED

No SQL transaction appears anywhere in `api/` — every multi-key operation is a
hand-rolled KV saga with compensation, despite the backend being a single
Postgres table:

1. `village/treasury/transfer.ts` — state debit + recipient credit (+ economy-tx).
2. `clan/treasury/transfer.ts` — clan rec + recipient save.
3. `village/hollow-gate-unlock.ts` — save debit + state write, manual refund (`:57-67`).
4. `clan/exchange/purchase.ts` — debit + treasury credit, refund + LOSS audit record.
5. `clan/seal-pool/donate.ts` / `distribute.ts` — save ↔ pool, refund-on-failure.
6. `clan/territory/collect-supply.ts` — N territory zeroes + one clan credit
   ("lose, never duplicate" + durable LOSS record).
7. `weekly-boss.ts` join — session + run + attempts + stamina, with compensation (`:614-641`).
8. `player/trade.ts`, `pet/battle-result.ts` — two save writes under the
   two-lock envelope; crash between writes leaves one side unapplied.
9. `save/[name].ts:2781-2784` — save blob + registry hset (benign).
10. `_economy-tx.ts` itself — record and described writes are separate ops.

**F9 (structural, VERIFIED):** this is the single largest structural improvement
available — the storage is literally one Postgres table.

## 8. `STRICT_RAW_SAVE_LEDGER` — VERIFIED

Gate: `process.env.STRICT_RAW_SAVE_LEDGER === '1'` (`save/[name].ts:420-422`).
**Off by default** (`.env.example:170` ships it commented;
`_equipment-ownership.test.ts:7` treats unset as production default). It gates
the count-consuming inventory ledger (`enforceRawSaveLedgerBoundary`), makes
`creatorItems` server-owned (`_admin-item-catalog.ts:14`), and affects a
starter-array path (`pvp/session.ts:710`). A structural-only equipment
validation still runs unconditionally (`save/[name].ts:511-539`). Known
pre-flip risk: named-weapon definition lookup can silently drop gear under
strict mode (see combat-authority audit).

## 9. Findings summary

| # | Severity | Status | Finding |
|---|---|---|---|
| F1 | Low | INFERRED | AB/BA lock-order inconsistency (sorted vs clan-first sites) — transient 503s, never hard deadlock |
| F2 | Info | VERIFIED | `seal-pool/donate` nests save→pool against convention; safe today, fragile |
| F3 | Info | VERIFIED | Travel-lease self-contention known and tuned |
| F4 | Low | **FIXED 2026-08-03** | Battle start/resolve and defeat persistence now use fail-closed locks; concurrency and stale-resolve regressions are covered by tests |
| F5 | Low | VERIFIED | `world-state.ts:1011` fail-open deduct in a dead branch |
| F6 | Minor | INFERRED | Version guard is `<` not `!==` — inflated echo passes (content still sanitized) |
| F7 | Accepted | VERIFIED | Two documented fail-open credits after consumed debit/marker |
| F8 | Medium if scaled | INFERRED | `_storage.ts:49-53` 10s in-process read cache includes `save:` keys — coherent on one Railway instance; on >1 replica, a locked-but-stale RMW clobber becomes possible (lock acquire/release themselves bypass the cache and stay replica-safe) |
| F9 | Structural | VERIFIED | Zero Postgres transactions; ten+ hand-rolled KV sagas |
| F10 | Open | From memory, not contradicted | Mission-claim 409-clobber refetch race remains open (see reward-settlement audit) |

Overall: the lock layer is unusually well-engineered for a KV design — atomic NX
acquire, CAS release, jittered backoff, failClosed on every currency path found,
deterministic ordering at nearly all nesting sites, version-CAS on the generic
save path, and saga records with an admin reconcile surface. Residual risk
concentrates in F8 (replica scaling) and F9 (saga-instead-of-transaction), not
in missing locks.
