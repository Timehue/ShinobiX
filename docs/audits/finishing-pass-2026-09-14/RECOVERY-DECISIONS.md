# Approved recovery scope and remaining certification

The owner approved C3/C4's narrow durable recovery fixes and C2's additive
training formula on 2026-09-14. The owner selected **local checks only for now**.
These approvals satisfy the repository's storage-change approval requirement;
no Supabase schema, auth, admin, role, rate-limit or IP policy changed.

## C2 — new pet training sessions

The server adds Pet Den (0.3% per level, member only) and village Pet Yard
(0.25% per level) to the existing mastery percentage. Both upgrade levels cap
at 50. Existing base XP, duration, Loyal/happiness multipliers, JavaScript
rounding/minimum and morale processing retain their order. Old training
sessions finish using their sealed reward; no compensation was granted.

`api/pet/training-clan-bonus.test.ts` exercises the real handler: baseline,
each bonus, both bonuses, stale nonmember data, caps, mastery/Loyal and legacy
sealed completion. Existing pet/morale/ownership tests are reused by root tests.

## C3 — new weekly clan mission settlements

1. The existing private primary receipt identifies clan/week/mission and seals
   canonical shared value and the original eligible contributors. Its random
   server owner binds the shared proof; a predictable fingerprint alone cannot
   authenticate a field pre-seeded before generic-save protection existed.
2. Shared treasury/XP and `clanMissionSettlements` are co-written by CAS under
   the existing clan lock. A suspended worker cannot overwrite a successor.
3. Personal points use their own protected, co-written mission receipts,
   independent of the 30-entry display history. CAS preserves the save version.
4. The primary becomes committed only after personal writes succeed. The
   claimed listing is a projection of positive shared proof plus final receipt.
5. New-protocol pending work can resume after the existing active lease expires;
   positive shared proof resumes personal work without repeating shared value.

Admission remains current ISO week only. Primary committed receipts last
10 days; pending primary rows do not expire. Applied shared/personal evidence
is retained 21 days, longer than admission. Historical pending receipts and
prior-week ambiguous work are not automatically replayed or deleted. Old
committed/scalar receipts retain compatibility behavior.

## C4 — Exchange War Supply purchases

1. The updated client keeps a stable request ID in session storage (memory
   fallback) through an uncertain response. A confirmed successful purchase
   clears only that intent; a genuine subsequent purchase receives another ID.
   The ID uses the game's existing corrected server clock.
2. The existing durable journal is reserved before debit. It seals player,
   clan, catalog quote and a random server proof token. A source proof without
   this reservation never authorizes shared credit. No journal is reconstructed
   from untrusted historical fields.
3. Debit, allowance count and source proof share a versioned player CAS.
   Before the debit commits, eligibility and the allowance period are rechecked
   at actual purchase time; a pending reservation cannot strand a player on a
   full historical week. Once debited, retry preserves that exact purchase.
4. Shared War Supply and its token-bound proof share a clan CAS. Existing
   clan-then-player locks remain in place. Missing acknowledgements are checked
   against positive applied-side proof and never trigger automatic refunds.
5. Journal completion follows both sides. Existing Economy Settlements discovery
   can find the journal; no admin interface or permission change was introduced.

Requests admit recovery for 90 days; applied proofs persist 100 days. Those
bounds prevent replay from outliving its evidence. No visible timer was added.
Prices, rewards, limits, personal-only purchases and the visible purchase flow
remain unchanged. An unfinished legacy no-ID debit can resume. **A legacy
client's lost final success cannot be distinguished from a genuine second
purchase**; only updated clients provide that identity. Session storage also
does not promise recovery identity across a new device or closed browser session.

`api/clan/_reward-recovery.test.ts` injects before/after applied-side failures,
final-journal failure, concurrent retries, expired-lock workers, rollover,
expired/future IDs, forged value/identity and pre-seeded receipt fields. Client
tests verify lost/malformed responses, genuine repeated purchases, corrected
clock and unchanged personal-purchase requests. Generic-save tests prevent
forging or clearing the new protected fields.

## Historical state and live certification

New field protection cannot retroactively establish old data's provenance.
The new protocols bind applied proofs to private server reservations and refuse
conflicts. Do not delete old ambiguous receipts, replay grants or issue refunds
without correlating source save, recipient clan and authoritative journal.

These are local memory fault tests and browser checks, not process/database
restore certification. The [operator checklist](OPERATOR-CHECKLIST.md) remains
unexecuted on an isolated deployed database. Rollback must use a reviewed image
that preserves these fields and does not run the former blind-refund Exchange
path while recovery is pending. Test retained-image/newer-save compatibility
before deployment. No live target, schema migration, refund, push or deployment
was performed in this task.
