# Historical mentor payment repair

This change repairs recoverable mentor reward history predating PR #413 and
provides an offline report for operator review. No production scan, migration,
player-data write, or deployment has been performed as part of this work.

The per-student `clan-mentor-paid:<studentSlug>` record introduced by #413
prevents future release/rejoin replay, but a pairing released before that
record existed may have lost its `claimed` map. A newly empty pairing can then
admit an already paid milestone. This repair recovers only payment evidence
that still survives; it cannot reconstruct erased history.

## Evidence and limits

A valid student-role `character.mentorRewardReceipts` receipt was co-written
with the student's ryo credit. The strict parser requires named, unique known
milestones; the derived settlement ID; protocol fields; the exact student ryo
amount for that batch; a valid payment time no later than the snapshot; and a
current save creation time no later than that credit. Teacher receipts do not
identify the student and cannot supply this evidence. Current student progress,
currency balances, or milestone eligibility never imply a past payment.

Legacy `students[].claimed` can represent a reservation before a completed
payment. Old audits contain only a count and can precede complete payouts.
New-protocol named completion audits and `settledLog` corroborate a historical
settlement, but omit the immutable account creation stamp. Their bounded or
best-effort retention and a reused player name cannot independently link that
historical recipient to the current account. These sources are reported for
review and never automatically converted to paid flags without the current
student receipt anchor.

Receipts can be compacted, mentor records overwritten, and audits expired.
Previously released pairs may leave no discoverable row at all. Therefore an
empty report is not evidence that the historical replay gap is fully closed.
Missing or ambiguous evidence never authorizes a blanket paid flag or denial
of an otherwise legitimate reward. The runtime can recover surviving valid
student receipts before admitting a new batch; pending settlements continue
through the existing settlement recovery protocol.

## Offline report

The tool imports only pure evidence helpers. It does not load `.env`, import
storage, contact any service, discover players, or offer an apply switch.
Use only a trusted sanitized projection from an independently approved capture:

```json
{
  "capturedAt": 1792108800000,
  "rows": [
    {
      "key": "save:student-slug",
      "value": {
        "character": {
          "createdAt": 1792000000000,
          "mentorRewardReceipts": []
        }
      },
      "expires_at": null
    },
    {
      "key": "clan-mentor-paid:student-slug",
      "value": { "academy": 1792050000000 },
      "expires_at": null
    },
    {
      "key": "clan-mentor:teacher-slug",
      "value": { "students": [], "settlements": [], "settledLog": [] }
    }
  ]
}
```

`capturedAt` is the actual capture time in epoch milliseconds. It must be
positive and not in the future when the report runs. The row allowlist is
`save:*`, `clan-mentor-paid:*`, `clan-mentor:*`, and `audit:clan-mentor:*`.
Include only player `save:*` rows: the only permitted save fields are
`character.createdAt` and `character.mentorRewardReceipts`. Omit unrelated
character data, authentication fields, tokens, passwords, balances, and every
unrelated KV prefix. Do not pass a complete backup to this tool. A missing
student save may be represented by `value: null`; it produces a review finding.
An absent/null character may also be preserved in the sanitized row; it
produces the same review finding instead of an invented payment.
Omitted receipt fields preserve the difference between missing legacy history
and malformed receipts. `expires_at` is optional/null or an ISO timestamp;
rows expired at capture time are ignored and listed. Duplicate keys are
rejected even if one copy is expired.

Run from the repository using its installed dependencies:

```powershell
node --import tsx scripts/mentor-history-report.ts --input sanitized-snapshot.json --output mentor-history-report.json
node --import tsx --test scripts/mentor-history-report.test.ts api/clan/_mentor-history.test.ts
```

The output path must not exist, and must differ from the input. The report is
deterministic for the same snapshot, contains no raw saves/receipts, and never
changes its input. Protect the projection/report as player metadata and keep
both out of Git. Its `proposedWrites` name exact target keys with `expected`,
`add`, and `next` maps plus evidence references. Existing canonical paid flags
and their timestamps are preserved. Malformed canonical records are explicit
review cases with no proposed overwrite. Re-running against an approved
application's results proposes no repeated additions.

`unresolved` lists evidence that cannot safely authorize a payment flag. The
summary counts only the rows supplied; it is not a count of all historical
players or former pairs. Capture the input/report file hashes separately for
the approval record, without including any credential material.

Valid, nonempty canonical paid records with an active expiry receive a separate
`removeExpiry: true` proposal, even without a surviving receipt. Their
`add` map is empty and their `next` map preserves every existing timestamp;
the existing canonical flags already establish this history. The report
includes `expectedExpiresAt` so expiry retention is explicit in approval and
revalidation. Removing a TTL does not invent a payment or alter a balance.

## Approval and production execution plan

The following is a plan, not authorization or an executed migration. Obtain
the owner's approval for the exact reviewed report and proposed key/milestone
scope before any production migration or live player-data mutation. A
production capture, maintenance window, merge, or deployment also needs its
own authorization. The offline report tool cannot perform those actions.

1. Coordinate a separately approved maintenance window that prevents all
   mentor writes, including assign, claim, release, and scheduled recovery.
   Preserve the initial consistent evidence snapshot BEFORE draining pending
   work: an older deployed payer can compact the last surviving receipt while
   finishing a batch. Do not assume a production pause switch exists; agree
   the actual maintenance mechanism with the owner. Do not cancel admitted
   rewards, erase pending settlements, or infer payment from reservations.
2. With separately approved read access, capture a consistent, restricted
   projection and the current values/expiry metadata of candidate target keys.
   Never expose credential values. Run the offline report and review every
   candidate and unresolved class. No production scan has been run yet, so no
   real affected-player count is asserted here.
3. Submit an exact allowlist of `clan-mentor-paid:<studentSlug>` keys and each
   missing named milestone, evidence references, expected current fields,
   snapshot/report hashes, and each `removeExpiry` proposal with its expected
   expiry. The proposed automatic scope adds validated ever-paid flags and
   retains valid canonical flags permanently; it changes no saves,
   balances, clan rewards, pairing records, receipts, or recovery pointers.
   Approve expiry-only retention explicitly: #413's existing canonical flags
   with a legacy TTL otherwise remain exposed to future expiration.
4. After explicit approval, re-read every allowlisted current save and paid
   record while all mentor writers remain quiesced. Revalidate current account
   identity and the same valid student receipt, ensure each approved milestone
   still has evidence, and compare the live canonical record and expiry to
   `expected` and `expectedExpiresAt`. For expiry-only retention, the valid
   canonical flags themselves are the evidence; do not fabricate receipts.
   If evidence disappeared, an account was recreated, the record is malformed,
   or the expected value differs, stop that candidate and regenerate the
   report. Pending settlements remain owed and unchanged; their claimed marks
   never substitute for a receipt. Do not broaden approval from one
   student/milestone to another.
5. A separately reviewed executor may call
   `repairMentorStudentPaid(studentSlug, now, approvedMilestones)` from
   `api/clan/_mentor-settlement.ts` for the explicitly allowlisted milestones.
   That helper re-reads current receipt evidence and uses additive
   compare-and-set writes with no expiration. It cannot replace the
   quiescence, exact `expected` check, or approval gate. On a CAS conflict,
   reread and revalidate instead of overwriting. On retry, preserve live flags
   and skip already present fields. Log only approved key/field outcomes and
   evidence references; never log raw saves or credentials.
6. Re-capture the same projection, rerun the report, confirm applied additions
   and preserved pre-existing flags, and verify zero repeat additions for the
   repaired scope. After an approved deployment of the preservation code (or
   after the approved flags have preserved the reviewed receipt evidence),
   resume recovery and let admitted rewards drain through their sealed terms.
   Check unfinished/exceptional batches, then resume mentor actions and monitor
   recovery. Retain a restricted before/after manifest for review. Never
   delete a paid flag as a routine rollback: that can reopen a reward.

## Cases requiring a separate decision

For lost or compacted history, seek corroborating authorized archives or
backups that prove the named student credit and immutable account identity.
Document provenance, capture time, exact milestones, current account linkage,
and why the record proves payment. A teacher total, a claim count, a legacy
reservation, or a reused slug alone is insufficient. Archived evidence must
be revalidated by a separately reviewed importer; this CLI accepts only the
current sanitized projection and does not silently mix old identities into it.

For ambiguous cases that cannot be reconstructed, return the affected class
and available evidence to the owner/user for an explicit policy decision.
Until then, do not mark milestones paid, block accounts, subtract currency,
claw back rewards, or freeze legitimate claims indefinitely. Any deliberate
one-time replay allowance or broader eligibility change is a distinct product
decision, not something this repair can infer from missing history.
