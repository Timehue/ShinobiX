# Currency-Ledger Cutover Runbook (P0-5)

Moving currency off the whole-save blob, one verified step at a time.

## Why this exists

Every currency change used to rewrite the player's entire save JSON and
nothing else. That is safe because the save lock and `_saveVersion` compose,
but one structural risk remains (Phase 0 concurrency audit F9): multi-key
settlements — a trade, an Exchange sale, a treasury donation — are hand-rolled
sagas across several KV rows, not transactions. (F8, a cached `save:` read
inside a locked read-modify-write, is fixed: `save:` is on the storage layer's
no-cache list.)

A per-player ledger that commits in the same Postgres transaction as the save
is the prerequisite for fixing F9 for money, and currencies are the
highest-value domain.

## What exists now

| | Save blob (`save:<name>`) | Ledger (`ledger:currency:<name>`) |
|---|---|---|
| Holds | everything, including the ten balances | the ten balances, the `_saveVersion` they were committed with, the account binding (`bornAt`), a write counter |
| Written by | every save writer | the same writers, **in the same transaction** when the write moves currency (`commitPlayerSaveRecord`, `api/save/_commit-player-save.ts`) |
| Read by | every reader, as before | the commit check, the backfill sweep, the audit |

The ten fields are derived from the ownership manifest
(`api/save/_state-ownership.ts`): character-scope, `currency` domain,
server-owned or clamped — `ryo`, `bankRyo`, `honorSeals`, `fateShards`,
`chroniclePoints`, `boneCharms`, `auraStones`, `auraDust`, `mythicSeals`,
`hollowShards`. Adding a currency there adds it here.

**The save's currency fields stay an exact mirror of the ledger.** Every
existing reader of `character.ryo` keeps working, a `git revert` of any step is
safe on its own, and deleting `ledger:currency:*` never loses money — the
next money write or sweep pass recreates each row from its save.

### How a write reaches the ledger

- `kv.compareSetMany` (`api/_storage.ts`) — an all-or-nothing compare-and-set
  across several keys in ONE Postgres transaction against the existing
  `kv_store` table (no DDL). Lease fencing runs once inside the transaction; a
  moved predecessor rolls the whole batch back and returns `false`.
- `commitPlayerSaveRecord` — every player-save writer commits through it:
  `writeVersionedPlayerSave[WithStore]` (so `mutatePlayerSave` and the Hollow
  Gate writers), `writeSaveProjected`, the generic autosave, admin
  `?signal=1`, snapshot restore, claim-mission, war funding, mercenary hire,
  the ranked-season rollover, and the pet/PvP ranked and consumable sagas. A
  write that does not move currency is the same single compare-and-set as
  before, with no ledger I/O.
- The AST ratchet (`api/save/_versioned-save-writes.test.ts`) pins the raw
  writers left (clan blobs, admin content slots, the QA fixture). The runtime
  guard (`api/_save-write-guard.ts`) logs and counts any `save:<player>` write
  the Postgres store sees outside the helper — keys the ratchet cannot resolve.

### The check at every money write

`classifyCurrencyLedger` compares the stored row with the stored save:

| Status | Meaning | Action |
|---|---|---|
| `match` / `lagging` | agrees (lagging = behind after currency-neutral writes) | proceed |
| `missing` / `legacy` | no row yet / still the v1 projection | create / upgrade from the save |
| `orphan` | a row from a deleted account of the same name | replace |
| `ahead` | the row is newer than the save (a restore) | the save wins |
| `lagging-different` | a writer moved currency without the helper | the save wins |
| `divergent` | same account, same version, different balances — a bug | **report-only today:** the save wins, CRITICAL log; **after step 4:** the write is refused |

Each non-normal status is counted per day at
`telemetry:currency-ledger:<event>:<YYYY-MM-DD>`, returned by
`GET /api/admin/economy` (`currencyLedger`, last eight days), and shown in the
Admin Panel under **Diagnostics → Economy → Currency ledger**, with the two
events that block step 4 listed first.

### Backfill

The leased sweep (`api/cron/_currency-ledger-sweep.ts`, every 10 minutes from
the in-process scheduler) reconciles 25 players per tick under each save's lock,
asserting the save it built from in the same transaction, and removes rows
whose save is gone. `npm run ledger:repair` runs the same reconcile on demand.

## The sequence

Each step is its own revertible change, and a plain deploy is the rollout —
no step is "set a Railway variable".

1. **Prep (done).** `ledger:` reads uncached; the ledger row is deleted with
   the account; client decreases of the decrease-only currencies are counted
   (`autosave-decrease`).
2. **Storage primitive (done).** `kv.compareSetMany`.
3. **Atomic dual-write (done).** Save and ledger in one transaction through one
   commit helper, classified on every money write, backfilled by the sweep,
   raw writes surfaced by the runtime guard.
4. **Fail closed (next, gated).** Flip `CURRENCY_LEDGER_GATE_ENFORCED` in
   `api/save/_commit-player-save.ts` so a `divergent` row refuses the write
   (and the sweep holds it for review instead of repairing it). Two things
   must land WITH that flip, or a divergent account is wedged rather than
   protected:
   - `CurrencyLedgerDivergenceError` is not the save-version-conflict error,
     so `mutatePlayerSave` routes it through `onUnconfirmedWrite`, not
     `onConflict`. Map it to the clean-refusal path, and give the player a
     retryable reply rather than a 500.
   - An operator route that repairs one held account from its save (the
     sweep's `reconcileCurrencyLedger` with the gate bypassed for that name),
     so a held account is never stuck until a deploy.
5. **Atomic settlements.** Trade, the Sunscar Exchange, the save-debit sagas and
   the cross-key treasury transfers commit every row they touch in one
   transaction — retiring F9 for money.
6. **Patch commits** (separately approved SQL). A pure money move updates the
   ledger row and patches only the blob's currency fields and version.

## Verification loop (before step 4)

```bash
npm run ledger:audit      # read-only; must exit 0
```

Step 4 is gated on: **zero `ledger-divergent` and zero `raw-save-write`
across at least seven days of normal play** (the Currency ledger box reads
"nothing blocking the fail-closed step"), including at least one
ranked-season rollover, one clan-boss weekly settlement and one PvP-heavy
period, with `ledger-lagging-different` trending to zero and the audit
reporting no `missing` / `legacy` rows (the sweep has reached everyone).

## Emergency switches (opt-out, never a rollout step)

- `DISABLE_CURRENCY_LEDGER_ATOMIC=1` — back to the plain compare-and-set
  followed by a best-effort ledger projection.
- `DISABLE_CURRENCY_LEDGER_GATE=1` — after step 4, lets the save win a
  `divergent` disagreement again.

## Manual data edits

Edit a player's currency through admin `?signal=1` (or bump `_saveVersion`
with the edit). A hand edit of the save's balances that keeps its version
reads as `divergent` on the next money write: report-only today, refused
after step 4. A restored backup reads as `ahead` or `lagging-different`, and
the save wins.

## Rollback

Revert the step. The save stays correct at every step, and a v2 ledger row is
a superset that the v1 code reads. Leftover rows are harmless and can be
deleted.
