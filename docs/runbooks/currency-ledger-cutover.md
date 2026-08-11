# Currency-Ledger Cutover Runbook (P0-5 → follow-up)

Moving currency off the whole-save blob, one verified step at a time.

## Why this exists

Every currency change rewrites the player's entire save JSON. That is safe
today because the save lock and `_saveVersion` compose, but two structural
risks remain (Phase 0 concurrency audit F8/F9):

- the storage layer memoizes `save:` reads for 10s, so a **second Railway
  replica** could serve a stale read inside a locked read-modify-write;
- multi-key settlements are hand-rolled sagas, not transactions.

Neither is fixed by moving currency alone — but a per-domain ledger is the
prerequisite for fixing both, and currencies are the highest-value domain.

## What exists now (after P0-5)

| | Save blob (`save:<name>`) | Ledger (`ledger:currency:<name>`) |
|---|---|---|
| Authority | **Yes** — every read and write | No — projection only |
| Written by | every save path, as before | `syncCurrencyLedger`, from `writeVersionedPlayerSave` and the generic save path |
| Contents | everything | the nine balances + the `_saveVersion` they came from |

Tracked fields are derived from the ownership manifest
(`api/save/_state-ownership.ts`): character-scope, `currency` domain,
server-owned or clamped. Adding a currency there adds it here.

## The three states, and which one matters

`compareLedger` (and `npm run ledger:audit`) classify every record:

- **match** — projection agrees. What you want everywhere.
- **stale** — ledger `saveVersion` is behind the blob. **Benign**: a writer not
  hooked yet (several settlements hand-roll their own version stamp and blob
  write). Converges on the next hooked write or via `npm run ledger:backfill`.
- **divergent** — same `saveVersion`, different balances. **This is a bug**:
  two writers disagree about the same version of the truth. It is logged as
  `[currency-ledger] DIVERGENT`, reported by the audit, and makes the audit
  exit non-zero.

## Verification loop (do this before any cutover)

```bash
npm run ledger:audit -- --target=staging --confirm-storage=$STAGING_STORAGE_FINGERPRINT --json
# Then, only in the staging service shell:
ALLOW_STAGING_INTEGRITY_REPAIR=1 npm run ledger:backfill -- \
  --target=staging --confirm-additive-repair=ADD_SIDE_CARS_ONLY \
  --confirm-storage=$STAGING_STORAGE_FINGERPRINT
npm run ledger:audit -- --target=staging --confirm-storage=$STAGING_STORAGE_FINGERPRINT --json
```

Production targets are intentionally unsupported by the maintenance CLI. See
`docs/runbooks/integrity-and-patreon-staging-certification.md` for the complete
dry-run, repair, artifact, and rollback-safety procedure.

`ledger:audit` and `ledger:backfill` remain stable operator command names. Both
now route through the combined integrity scanner, and `ledger:backfill` invokes
the same guarded additive `--repair` mode; it does not bypass the staging
identity, deny-set, latch, or confirmation checks.

Cutover is gated on: **zero divergent records across several days of normal
play**, including at least one ranked-season rollover, one clan-boss weekly
settlement, and one PvP-heavy period (those use the hand-rolled writers).
`stale` counts trending to zero after a backfill is the second signal — a
persistent stale record names a writer still to hook.

## Remaining steps (NOT part of P0-5)

1. **Hook the remaining writers.** Any endpoint that stamps its own version and
   writes the blob directly (`pvp/claim-rewards`, `missions/claim-mission`,
   `pet/battle-result`, `weekly-boss`, `cron/_ranked-season`, …) should call
   `syncCurrencyLedger` after its write. Each one removes a source of `stale`.
2. **Read cutover behind a flag.** Add `CURRENCY_LEDGER_AUTHORITATIVE` (default
   off). When on, currency reads come from the ledger, with a blob comparison
   on every read and an automatic fall back to the blob on mismatch. Flip it
   only after the verification loop above is clean. Deliberately NOT added in
   P0-5: an unused flag is untested code, and the evidence to justify it does
   not exist yet.
3. **Transactional writes.** Once the ledger is authoritative for currency, a
   currency move is a single-row update and can use a real Postgres
   transaction instead of a KV saga — which is what actually retires
   concurrency finding F9 for the money paths.
4. **Next domain.** Repeat for inventory, then pets. The manifest already
   classifies them, so the same projection shape applies.

## Rollback

Nothing to roll back. The ledger is additive and unread; deleting the
`ledger:currency:*` keys or reverting the P0-5 commits leaves gameplay
untouched.
