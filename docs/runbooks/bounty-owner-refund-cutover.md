# Account-bound bounty refunds: staged cutover and rollback

Normal eligible combat winners receive the pooled bounty. If its target is deleted
or permanently banned before a kill, each proven original owner receives their own
stake. Posting fees remain spent. Unproven shares or account identities stay held.

## Storage and identity

The first new bounty debit creates a random `bountyOwnerId` on the existing auth
record. That ID and the debit commit in one save/ledger/auth transaction. It is
private server data, not a credential. Ordinary credential changes that preserve
the auth record preserve this ID. Account deletion removes it. A replacement
account cannot inherit a refund through its reusable name.

Placement retains the existing board-then-save lock order and acquires the auth
lease without waiting. It holds that lease through the saga commit. If a password
or other credential change is in progress, placement returns retryable 503 before
any debit. Retrying after that change creates/preserves the ID safely; the credential
writer cannot later overwrite it from a snapshot taken before publication.

The bounty's `contributions` record both amount and account ID. Every automatic
refund checks the current auth ID and asserts that exact auth row in the same
transaction as the currency credit. Missing, mismatched or unreadable authority
cannot authorize a payment. Legacy pools, including single-contributor pools,
lack account identity proof and require reconciliation.

An exceptional refund removes the head from `pvp:bounties` and publishes a separate
`pvp:bounty-owner-refund:v1:<target>:<uuid>` row in one `compareSetMany` transaction.
These escrow rows have no TTL. They retain original pool evidence, unresolved
amounts, account-bound claims, completion receipts/status and hold reasons.
Claim receipts on the owner save prevent duplicate credits after lost completion
acknowledgements. Paid entries remain as an audit trail.

Old board normalizers never read or write the separate escrow rows. They can still
strip contribution provenance from a live board during a mixed-version period;
that makes the corresponding refund unprovable and held, never guessed. Older auth
writers that strip an ownership ID likewise turn verification into a hold. No
SQL schema migration is required.

## Stage 1: compatibility deployment, refunds held

1. Keep `BOUNTY_OWNER_REFUNDS_ENABLED` unset or `0`. This is the default: new
   exceptional refunds are reserved safely but no automatic owner credits run.
2. Deploy the compatibility code through the ordinary reviewed release process.
   No operational step in this runbook is performed merely by preparing the patch.
3. Identify and stop incompatible application/cron workers before the migration
   below. Do not rely on `numReplicas: 1`, health checks, or a drain timeout as proof
   that no old process can still write. During the cutover, prevent bounty mutations,
   account deletion and permanent-ban cleanup by stopping their application writers.
4. Take and verify the normal KV backup while writers are stopped. It must preserve
   `pvp:bounties`, all `pvp:bounty-owner-refund:v1:*` rows, auth IDs, saves and currency
   ledgers together. Keep auth-containing backups private.

The earlier, unreleased prototype stored refunds under `pendingClaims` on the board.
Those entries are unsafe under older normalizers. If any were persisted in a test
or deployment, migrate them before allowing old or mixed writers to resume:

```sh
node --import tsx scripts/migrate-bounty-refund-escrow.mts
node --import tsx scripts/migrate-bounty-refund-escrow.mts --apply --writers-stopped
node --import tsx scripts/migrate-bounty-refund-escrow.mts
```

Inspection is the default. Inspection and apply use the same raw-state validation.
Inspection lists raw legacy obligations and explicit `blockers`, and exits nonzero
if any blocker exists. Duplicate legacy IDs and malformed pending rows require
manual inspection; apply refuses the entire current batch before transferring
any entry. It does not collapse duplicate IDs or normalize away raw evidence.
Apply requires the explicit stopped-writer acknowledgement
and refuses when automatic refunds are enabled. Each legacy transfer atomically
removes one board claim and creates separate escrow. It is restartable and never
auto-pays legacy claims; their original state is retained for reconciliation.
Malformed claims that normalization would discard block the migration for manual
inspection. Verify no `deleted-target:` pending board claims remain before restart.
The flag is an operator acknowledgement, not a mechanism that stops Railway workers.

## Stage 2: verified activation

1. Confirm all serving and cron processes run the reviewed compatibility version,
   the legacy migration is complete, and reservation/payment transaction tests and
   release checks pass on the deployed database backend.
2. Enable `BOUNTY_OWNER_REFUNDS_ENABLED=1` on the compatible deployment and restart
   it through the normal release procedure.
3. The existing full-admin economy reconciliation request with `bountyClaims: true`
   retries eligible separate escrow claims. Its `remaining` list includes held
   escrow keys. Ordinary claim sweeps also retry eligible separate escrow.
4. Check original-owner balances, retained posting fees, paid receipt/status and
   remaining escrow conservation. No equal allocation or automatic forfeiture is
   allowed. Manual resolution requires evidence of both amount and account identity.

## Rollback

Disable automatic refunds first, quiesce writers, and preserve a consistent current
KV backup. Roll back application code only; do not restore an older database snapshot
over new escrow or paid receipts. Separate escrow survives older board writes and
will wait until compatible code resumes. An old version will not service that queue.
Do not copy these rows back into old `pendingClaims` or recreate target bounty heads.
If legacy board refunds exist, migrate them while writers remain stopped before
rollback. Returning to compatibility code resumes only provable unpaid claims.

No unattended migration, production cutover, database backup/restore, or release is
authorized by this document. The full root suite and real PostgreSQL transaction
evidence remain release checks when they have not been run on the final tree.
