# Concrete decisions for the remaining value defects

These are proposed scopes, not implemented migrations. Existing magnitudes and
normal player interactions remain fixed. The repository's [CLAUDE.md](../../../CLAUDE.md#hard-rules)
requires: “Do not change Supabase schema, SQL migration files, or storage structure
without approval.” C3/C4 require new durable operation evidence, so the concrete
protocols below await that approval. The handoff also forbids guessing progression
intent, which leaves C2's stacking formula for the owner.

## C2 — prospectively apply the displayed pet-training bonus

Decide whether the displayed clan/village percentage adds to the existing mastery
percentage before Loyal/happiness multiplication and current rounding/morale, or
has a separately specified stacking rule. The UI proves a missing benefit but does
not unambiguously resolve that full formula. Only newly started training should
seal an approved corrected amount; never recalculate a running/finished old timer.

Required tests: no clan, stale doctrine/upgrades without membership, each village/
Den level including caps, mastery/no mastery, Loyal, happiness boundaries, both
morale windows, minimum/rounding, identical start retries, completion once, legacy
timers and save-version conflicts. No change to training duration or base XP.
Historical compensation is a separate evidence-based decision, not part of the
prospective parity patch.

## C3 — clan mission interrupted shared credit

The existing pending receipt proves intent, not that the clan row was credited.
Expired pending is therefore unsafe to translate into successful claim/Clan Points.

Smallest proposed recovery contract:

1. Identify the operation by clan slug, ISO week and mission key, and seal the
   canonical grant and eligible member evidence. Do not accept a new client amount.
2. Co-write the shared treasury/XP grant and its protected operation receipt in
   the same clan-row mutation under the existing clan lock. Protect the field
   from ordinary generic saves, as C5 now does for existing treasury receipts.
3. A retry with positive shared-row proof can finish the existing listing/audit/
   per-member points outbox without applying shared value again. Personal points
   must not be granted merely because an intent exists.
4. A versioned **new-protocol** pending operation with no shared credit evidence
   can resume only under a reviewed, fenced write protocol. Historical pending
   receipts lack that distinction and must remain explicitly unresolved.
5. Keep old committed/scalar-latch compatibility replay-blocking. Never delete
   an uncertain pending receipt to make the button work.

Before approval, inspect how normal clan saves preserve the selected receipt
field and how long a weekly proof can remain replayable. A bounded receipt ring
must not evict evidence while its source proof can still authorize recovery.

Required failure tests: before reservation; lost reservation acknowledgement;
before shared write; committed shared write with lost acknowledgement; before
receipt commit; listing/each member point write interrupted; concurrent members;
week rollover; membership change; invalid activity; response lost after final
commit; old scalar/committed/pending receipts; expired lock/CAS fencing.

## C4 — Exchange War Supply acknowledgement ambiguity

Current behavior refunds player points and purchase allowance after **any** thrown
clan write. The disposable probe proves that this can refund a successful credit.
An absent acknowledgement is not sufficient evidence for a refund.

Smallest proposed recovery contract:

1. Reuse the existing request-identity pattern invisibly in the current purchase
   action. One click/retry is one intent; a genuinely new purchase gets a new
   identity. No new confirmation or modal.
2. Seal catalog item, cost, clan, actor, period/limit and authoritative reward.
   Co-write the points debit, limit increment and its intent receipt in the
   player save.
3. Co-write War Supply credit and the matching protected applied-side receipt in
   the shared clan row. A retry inspects both positive proofs and completes only
   the missing side; it never rolls a new reward or consumes a second allowance.
4. Refund only when the protocol can prove no shared credit was committed and
   cancel its intent safely. Uncertain writes remain recoverable pending work,
   not automatic refunds or an invitation to buy again.
5. Use existing settlement/journal/diagnostic primitives where they fit, after
   checking lock order and source/recipient types. Do not force the whole
   Exchange through an unrelated helper merely for code reuse.

Required tests: personal-only purchases unchanged; new vs repeated intent;
simultaneous duplicate; mismatched item/clan/amount/actor; full inventory before
debit; membership/period rollover; interruption before/after each applied-side
write and journal update; lost response; rollback compatibility; pending receipt
searchability. Keep current prices, limits, cache pools and War Supply amounts.

## Already-deployed historical state

C5 prevents future client overwrites of the existing clan treasury receipt field;
it does not prove that every old stored receipt was valid. If vulnerable code was
deployed, investigate source receipts against matching durable transaction and
recipient proof before reconciling them. Do not automatically erase old receipts
or replay transfers. The same rule applies to historical C3 pending claims and
C4 LOSS/refund records. Capture a fresh backup before any approved correction;
run the procedure on a distinct safe target first.
