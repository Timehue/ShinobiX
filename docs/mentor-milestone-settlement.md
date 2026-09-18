# Mentor milestone settlement

How a clan mentor claim (`POST /api/clan/mentor`, `action: 'claim'`) pays the
sensei and the student exactly once, and how an interrupted claim is finished.
Code: `api/clan/_mentor-settlement.ts` (settlement), `api/clan/mentor.ts`
(handler), `api/clan/_mentor.ts` (rules and amounts, unchanged).

## Why it changed

The old handler did four separate writes: it marked the milestones claimed in
`clan-mentor:<sensei>`, credited the sensei's Honor Seals and
`clanEventContrib`, credited the student's ryo, and then awarded the sensei's
Clan Points in a fourth write. Its own comment accepted that "a crash or
contention-throw after this point loses a payout". Once the mark was written,
nothing could ever pay the missing part: a retry saw no claimable milestone.
`api/clan/_mentor-settlement.test.ts` scenario 8 reproduces that case; it
failed on the old handler (student left at 0 ryo after a 200 retry).

## Economic contract (unchanged)

Per milestone: sensei +50 Honor Seals and +5 `clanEventContrib`, student
+1,000 ryo (`mentorPayout`). Per claimed batch: one Clan Points request of
`min(100, milestones × 25)` from source `mentorMilestone`
(`mentorClanPointsRequest`). That request goes through the existing pure
`awardClanPoints` as a single request, so a batch that would cross the weekly
cap is still refused whole. `clanEventContrib` and the Clan Points fields
(`clanPoints`, `weeklyClanPoints`, `lifetimeClanPoints`) stay separate fields.
Eligibility, milestones, the three-student limit and the anti-alt check are
untouched.

## Storage

| Key | Contents |
| --- | --- |
| `clan-mentor:<sensei>` | The authority. `students[]` (pairings, each with a durable `pairingId`, the `claimed` milestone map and `settledBy`), `settlements[]` (admitted, unfinished batches) and `settledLog[]` (the last 20 finalized batches, diagnostics only). Every write is an exact compare-and-set. |
| `clan-mentor-pending:<sensei>` | Discovery pointer for the reconciler. Its value is a random token. |
| `clan-mentor-of:<student>` | The existing one-sensei-per-student marker. |
| `character.mentorRewardReceipts` | Per-save payout receipts. The field is server-owned (`always-ledger-char` and `strict-ledger-char`): a generic autosave can neither forge nor erase it. |
| `clan-mentor-settlement:status` | Summary of the last reconciler run, diagnostics only. |

All `clan-mentor*` keys bypass the per-process read cache (`api/_storage.ts`).
A cached snapshot would defeat the compare-and-set writes across workers.

## Sequence

1. **Admit** (under the mentor-record lock). The handler reads the student's
   real save and computes reached, unclaimed milestones. It then freezes a
   settlement: its id (`mentor-` + a hash of `pairingId` and the milestones),
   both participants, each one's account `createdAt`, the sealed amounts and
   the progress evidence. A fingerprint over all of those terms is stored with
   it. The discovery pointer is written first. One exact CAS then appends the
   settlement and reserves the milestones in `claimed`. A legacy pairing gets
   its `pairingId` in that same write. That is the only time it is minted, and
   a read never mints one. Nothing from the client is used; the handler reads
   only `playerName` and `studentName`.
2. **Pay the sensei.** One `mutatePlayerSave` write applies the Honor Seals,
   the contribution and the batch's Clan Points decision. The decision uses
   the current week, clan and cap. The same write adds a receipt with the
   applied outcome, including `awarded`, `weekKey` and any `weekly-cap` or
   `not-in-clan` reason.
3. **Pay the student.** One `mutatePlayerSave` write adds the sealed ryo to
   the current balance, plus a receipt.
4. **Finalize.** Both receipts now exist. One exact CAS removes the settlement
   from `settlements`, records `settledBy[milestone] = id` on the pairing (only
   if that pairing still exists), and appends a `settledLog` entry.

Each payment step starts by reading the save. A matching receipt means that
side is already paid, and the step writes nothing. Otherwise, under the save
lock, the step reads the save again and then re-reads the mentor record. It
pays only while the settlement is still pending there, with the same
fingerprint. The write is an exact CAS against the save it read.

## Why nothing is paid twice or lost

- **Retries and lost responses.** The settlement is durable from admission.
  A retry, whatever its request, resumes that exact settlement by id, and
  receipts short-circuit any side already paid. The claim endpoint has no
  request ID, and none is needed.
- **Overlap.** Milestones are reserved in the admission CAS. Two racing
  admissions cannot both commit, and a pending batch's milestones are never
  claimable again.
- **Lost acknowledgements.** A thrown or ambiguous write never counts as
  proof either way. The step reads the stored save back, and only a receipt
  with a matching fingerprint makes it paid. The readback may find a newer save
  (the player trained right after the credit). That newer save is kept and its
  receipt is recognized. An older snapshot is never restored.
- **Stale writers.** Every write is an exact CAS. A writer that resumes after
  its lock lease expired fails its CAS, reads back, and finds the successor's
  receipt. It cannot pay again, and it cannot overwrite the mentor record,
  including through a stale assign or release.
- **Retention.** A receipt is removed only by a later payment from the same
  mentor record, and only after its settlement has left that record. The
  removal is itself a save CAS write. A worker that read the save before the
  removal fails its CAS. A worker that read it after the removal also re-reads
  the mentor record after that point, where the settlement is already gone.
  Nothing expires on a timer. Unfinished settlements stay in the record until
  they are finished. A save holds at most 64 mentor receipts. Reaching that
  limit is an exception held for review, and receipts are never evicted.
- **Paid milestones stay paid.** Replay protection comes from the pairing's
  `claimed` map (at most four entries) plus the receipts. Display histories
  (`clanPointHistory`, `settledLog`) and rolling lists
  (`serverSettlementReceipts`) play no part in it.
- **Clan Points week.** The award uses the week of the first committed
  sensei payment. The receipt stores the decision, so a retry in a later week
  reuses it. A capped zero never becomes a second chance, and a newer week's
  total is never reset.

## Recovery entry points

- **Claim POST (authenticated).** The handler first finishes that student's
  unfinished batches from their sealed terms. Only then does it admit new
  milestones as a separate batch. The anti-alt check gates new admission only:
  a batch that was checked when it was admitted is allowed to finish.
- **Scheduler.** `fireSettlementReconciliation` runs every 5 minutes and once
  at boot, under the existing `settlement-reconciliation` job lease
  (`api/cron/_scheduler.ts`). It calls `recoverPendingMentorSettlements`, which
  finds work through the `clan-mentor-pending:*` pointers. It visits at most 25
  senseis and 50 settlements per run, one at a time, within a 60-second
  budget. It never scans player saves. The boot run also walks
  `clan-mentor:*` records once and re-publishes any missing pointer.
- **GET is read-only and unauthenticated, as before.** It never settles
  anything. It lists owed-but-unpaid milestones under `claimable` (plus a new
  `pending` field), so the existing Claim button stays enabled for them.

A failed attempt is recorded on the settlement: `attempts`, `step` (`teacher`,
`student` or `finalize`), `lastError` and `nextAttemptAt`. Transient failures
back off from 5 minutes up to 6 hours. Permanent problems are held for review
and back off from 1 hour up to 24 hours: `recipient-missing`,
`identity-mismatch`, `receipts-malformed`, `receipt-conflict` and
`receipt-capacity`. Held settlements are never marked complete. They are
logged by id, and a claim for them answers `409` with `review: true`.

## Responses

| Outcome | Status | Body |
| --- | --- | --- |
| Completed, in this request or finishing an earlier one | 200 | The existing fields (`ok`, `claimed`, `seals`, `contrib`, `studentRyo`, `milestones`, `character`, `_saveVersion`) plus `settlementIds` and `replayed`. `character` and `_saveVersion` come from the same sensei save record. |
| Nothing new | 200 | `{ ok: true, claimed: 0 }` (unchanged). |
| Admitted but not finished | 503 | `retryable: true`, `settlementId`, `pending`. It carries no `character`, so the client applies nothing. |
| Held for review | 409 | `review: true`, `settlementId`. |

The client applies the returned snapshot through `commitVersionedCharacter`
and never adds deltas. A retry therefore cannot apply a reward locally twice.
No client change was needed.

## Pairing lifecycle and identity

- **Release** removes only the pairing. Its unfinished settlements stay and
  are paid from their sealed terms. Release clears the student marker with a
  compare-and-delete, and only when the marker still names this sensei.
- **Recovery** never writes `students` for a pairing it does not match by
  `pairingId`, and never writes the marker. A released pairing is not revived,
  and a newer assignment is left alone.
- **Re-assignment rules are unchanged.** Releasing and then re-assigning the
  same student creates a new pairing with a new `pairingId` and an empty
  `claimed` map, as it always did. That is existing policy, not something this
  fix introduced. Whether a re-assigned pairing should be able to earn the same
  milestones again is a design question for the owner.
- **Account identity.** Each recipient is bound at admission to the account's
  immutable `character.createdAt`. The save sanitizer freezes that value once
  it is stamped. A deleted account whose name is re-registered gets a new
  stamp, so the batch is held as `identity-mismatch` and never pays the new
  account. A missing save is held as `recipient-missing`.

## Legacy records

Claims settled before this change carry only `claimed[milestone] =
timestamp`, with no `settledBy` and no receipts. That stamp shows only that
the old handler marked the milestone. It does not show which of the three
credits landed. Legacy milestones stay claimed and are never paid again
automatically. New-protocol completions are the ones that have `settledBy`.

To investigate a report of a historical missing reward, read these sources.
Do not infer anything from current balances.

1. `audit:clan-mentor:claim:<ts>` (30-day TTL). It was written only after the
   old claim's credits returned.
2. The sensei's `clanPointHistory` entry with source `mentorMilestone` and
   event id `mentor:<sensei>:<student>:<ts>`. `<ts>` equals the `claimed`
   timestamp, which shows the fourth write landed. Also check
   `audit:clan-points:<sensei>:*` (90-day TTL).
3. The nightly save snapshots (`docs/BACKUP_RESTORE_RUNBOOK.md`) around the
   `claimed` timestamp, for the Honor Seal and ryo deltas.

Any repair is a manual, per-case operator decision. There is no bulk
reimbursement or migration.

## Deployment and rollback

- **Old writers.** The previous handler rewrote the whole
  `clan-mentor:<sensei>` record as `{ students }`. A request served by an old
  process while this version is live would therefore drop `settlements`.
  Railway replaces the single container after the new one is healthy, so the
  overlap is seconds long. A pending settlement is needed for any harm, and
  the only harm is losing that one batch's unpaid half, which is what the old
  code already did. After deploying, check `clan-mentor-settlement:status`.
  Do not run old and new versions side by side for longer than a deploy.
- **Rollback** to the previous handler while settlements are pending is
  unsafe. The first old-code write to that sensei's record drops the pending
  batch. Before rolling back, drain first: wait until no
  `clan-mentor-pending:*` keys remain, or finish the listed settlements with a
  claim or a reconciler run. The reserved `claimed` stamps survive a rollback,
  so milestones are never paid twice. The `mentorRewardReceipts` field is
  harmless to old code.
- **No schema, SQL or environment changes.** `DISABLE_SETTLEMENT_RECONCILIATION=1`
  also pauses mentor recovery, and claims still finish pending work.

## Tests

- `api/clan/_mentor-settlement.test.ts` covers scenarios 1–21 through the
  real handler, reconciler and save handler, with storage fault injection.
- `api/clan/_mentor-restart.test.ts` runs the acceptance scenario across real
  processes. It kills the claiming worker between the teacher and student
  credits. A fresh process then finishes the batch through the scheduler tick,
  and a third process confirms nothing changes.
- `api/_storage-save-authority.test.ts`, `api/save/_sanitize-clan-points.test.ts`,
  `api/save/_state-ownership-parity.test.ts` and
  `api/clan/_save-version-echo.test.ts` cover the cache bypass, the
  server-owned receipt field, and the single version bump.
