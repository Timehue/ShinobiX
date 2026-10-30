# Playtest recovery verification

## Sector contract delivery

New Explore receipts seal the discovery time and opt into retry-safe contract
delivery. Contract progress and credited request IDs commit together through
`compareSetMany`. Retries cannot move work into another UTC day or turn daylight
work into night work. A receipt can retry delivery for three days; deduplication
rows live four days. Later replay cannot recreate an expired counter.

The public board and claim endpoint still use the **current UTC day**. The shared
contract definition describes daily postings, and the sector card announces the
midnight UTC board reset. Recovering yesterday's work preserves its original
day; it does **not** make yesterday's contract claimable today. No grace period
or automatic expired-contract payout is introduced. An outage spanning midnight
can therefore leave recovered prior-day work unclaimable. The public endpoint
regression in `api/sector/contract.test.ts` pins this existing limitation rather
than silently transferring progress to a new contract.

Legacy outbox entries recover their timestamp from discovery authority when
possible. Entries whose timestamp cannot be recovered remain in the outbox
without blocking valid later contract or intel effects. Historical counters
cannot be reconstructed reliably because earlier delivery did not record
per-request credit proof. Village intel remains an independent at-least-once
effect.

## Deployment and rollback compatibility

`world:contract:<player>:<sector>:<day>` remains a **number**. Request IDs use the
separate `world:contract-receipts:` namespace. The transaction compares both
predecessors, so a concurrent legacy `kv.incr` causes a retry that includes its
increment. Tests cover legacy increments before and during the new transaction,
as well as lost commit acknowledgments. The storage layer's existing atomic
multi-key implementation is required; delivery fails closed if unavailable.

Numeric counters remain usable by older binaries, including after rollback;
the additional receipt keys need no destructive migration. However, older
workers still have their original delivery bugs. For strict retry guarantees,
drain/stop old workers before new workers serve requests; do not let old workers
drain new outbox entries. A mixed-version deployment does not gain the new
behavior until all old workers have stopped. No deployment was performed as part
of this verification.

## Five-treat accounting

The real browser-to-API journey charges 2,000 ryo and creates five Pet Treats
exactly once, including a lost-response retry and reload. The first recipe also
unlocks **Sparks Fly** (`craft-first`), whose separate achievement sync awards
2,000 ryo. Thus a first-time crafter can finish with the same wallet balance even
though the fee was charged. Established crafters retain the 2,000-ryo debit.

Desktop and mobile regressions cover both cases with realtime updates enabled.
This reproduces the apparent free-batch mechanism; it does not establish the
historical achievement state of the original live account.
