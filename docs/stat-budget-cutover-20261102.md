# Stat budget cutover: 2026-11-02 00:00 UTC

PR #555 changed the PvP counter key without retaining same-day reservations.
This correction routes by the authoritative reward event's UTC day. Requests
for earlier events keep the original shared counter, original 60-point ceiling,
and per-battle receipts. The new 120-point PvE/mission and separate 50-point PvP
budgets begin with events on November 2. New combat roll ranges remain as
requested; an existing reservation always replays its original awarded amount.

The transition deliberately defers the raised/separate daily budgets until
that boundary. The budget reply reports the effective 60-point ceiling before
the boundary. No save mutation, counter copying, or SQL migration is required.

## Release conditions

1. Pass exact-head review, CI and Production Image for the correction and its
   main integration. Do not promote uncorrected main `927337eb`.
2. Verify Railway serves a descendant of this correction, public and deep
   health pass, and the previous workers have drained **before November 2
   00:00 UTC**. Account for every production replica.
3. If those conditions cannot be confirmed before the boundary, stop promotion
   and move the boundary forward in a newly reviewed and tested commit before
   any deployment of the split-counter code. Do not change the date after split
   counters have started receiving rewards; that would require another explicit
   compatibility review.
4. Delayed old-day claims continue using the old key even after the boundary.
   Never copy or delete their receipt rows. Existing retention rules still apply.

The broken #555 build must not serve production, including briefly during a
rolling deployment. If it has served traffic, stop and assess both key families
before promotion; this correction does not claim to reconcile already-created
split counters for pre-cutover days.

Regression coverage seeds actual old-key rows and exercises old reservation
replay after midnight, numeric legacy counters, mixed old/new CAS races, lost
acknowledgements, duplicate requests, and independent post-boundary budgets.
