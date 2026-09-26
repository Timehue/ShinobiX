# Reward-Settlement Contract (P0-2)

Every endpoint that pays out currency, items, progression, or entitlements
must settle through one of the sanctioned idempotency mechanisms below, under
a `withKvLock(..., { failClosed: true })` critical section on the resource it
mutates. The inventory is enforced by `api/_settlement-contract.test.ts` —
adding a payout endpoint means adding it to that table with its mechanism.

Full per-path evidence: `docs/audits/reward-settlement-audit.md` (Phase 0).

Combat owner, mounted-route, and mismatch truth is maintained separately in
[`shared/runtime-mode-registry.ts`](../../shared/runtime-mode-registry.ts) and
its [generated projection](../generated/runtime-mode-registry.md). This document
defines payout/idempotency mechanisms; it does not authorize a client outcome or
collapse Showdown, Warfront, Gauntlet, cinematic, legacy, and client-local pet
engines into one runtime.

## Sanctioned mechanisms (strongest first)

1. **In-save receipt in the payout write** — the receipt
   (`serverSettlementReceipts`, a `redeemed*` list, a date stamp, or a latch)
   is a field of the SAME `kv.set` that pays. Atomic by construction; retries
   replay the recorded receipt. This is the default for new endpoints
   (`api/_settlement-receipts.ts`, or a `redeemed*` array classified into the
   `server-array-ledger-char` boundary of the state-ownership manifest so the
   save sanitizer protects it automatically).
2. **Server-minted single-use token** (`api/_single-use-token.ts`) — consume
   gated on the delete rowcount. Consumption before the payout write is a
   deliberate loss-only window (never a mint); pair with an in-save receipt
   when the loss would be expensive.
3. **Economy-tx journal** (`api/_economy-tx.ts`) — reserve → apply →
   complete/needs-reconcile, consumed by `api/admin/economy-reconcile.ts`.
   REQUIRED for any settlement spanning two or more saves/records (treasury
   transfers, player trade).
4. **Separate NX once-marker** — legacy pattern; every stranded-receipt loss
   window found in Phase 0 belongs to it. Do not use for new endpoints; when
   touching an existing one, either migrate to mechanism 1 or add rollback of
   the marker on write failure.
5. **State-machine gating** — the payout write itself transitions the gating
   state (training lease cleared, latch set, session settled).

## Failure-direction doctrine

When a partial-failure window is unavoidable, it must point toward **loss,
never mint**: consume/stamp first, pay second. A window that can DUPLICATE a
payout is a defect regardless of size. Windows that lose a payout must leave a
durable trail (economy-tx `needs-reconcile`, a logged receipt id) whenever the
loss is more than trivially recoverable by replaying gameplay.

## Changes landed in P0-2

- **Player trade** (`api/player/trade.ts`): two-save settlement now journals
  through economy-tx (reserve → debit-applied → complete / needs-reconcile)
  and writes the client nonce receipt as `pending` BEFORE the sender debit —
  a retry of a half-committed transfer returns `409 pending` instead of
  re-debiting, and an interrupted transfer leaves a reconcile record instead
  of silently burning the sender's funds.
- **Combat-mission win handoff** (`shinobij.client/src/lib/claim-outbox.ts`):
  the Arena→queue handoff now persists un-acked mission wins in a localStorage
  outbox and re-posts them until the server acks (the queue endpoint is
  idempotent), closing the offline-loss window where a 409-refetch discarded a
  never-persisted win.
- **Ranked-season podium** (`api/cron/_ranked-season.ts`): each player's
  rating reset, podium reward, and season receipt are one save write. A durable
  season plan preserves the original field and podium across partial failure;
  retry skips completed receipts and advances the season clock only after all
  planned players settle.
- **Card Clash AI settlement** (`api/card-clash/ai-move.ts`): the payout now
  writes a `redeemedCardClashAiSessions` receipt inside the same save write,
  so a crash between payout and session-mark can no longer double-pay on
  retry — the codebase's only duplicate-direction window is closed.

## Retry-safe player debits into shared records (issues #179, #180, #19; 2026-09-25)

Four endpoints take currency (or items) out of a player's save and put it into
a shared record: the shrine offering, bounty placement, and the clan and village
treasury donations. None of them accepted a request id, so a retry after a lost
response charged the player twice, and the shrine kept the charge when its
ledger write failed. They now all run one saga, `api/_save-debit-saga.ts`
(`runSaveDebitSaga`), with the credit side of each kind defined once in
`api/_save-debit-kinds.ts`.

**Authority.** The server decides the debit and the credit plan together,
under the shared-record lock and then the player-save lock (the order every one
of these endpoints already used). The client sends only the action and a
`requestId` (16–80 chars, the `parseSettlementRequestId` bound). Amounts are
never taken from anything but the validated request and the stored save.

**The contract.**

| Step | Written in ONE write | Proves |
| --- | --- | --- |
| Debit | the save change + a `serverSettlementReceipts` entry keyed by the settlement id | this id already debited |
| Credit | the shared-record change + a `settlementReceipts` entry keyed by the same id | this id already credited |
| Journal | `economy-tx:<id>` (reserved → debit-applied → complete / needs-reconcile / refunded) | progress, and the result a replay returns |

The settlement id is `settlementTransactionId(kind, "<player>:<requestId>")`, so
two players can never collide on one client id, and a request sent without an
id gets a one-shot id (it still settles exactly once; it just cannot be
recognized if it is sent again).

**Recovery.**

- *Identical retry after success*: the completed journal or the in-save receipt
  answers with the stored result; nothing moves (`replayed: true`).
- *Same id, different payload*: 409, nothing moves.
- *Concurrent duplicates*: serialized by the fail-closed locks; one settles, the
  rest replay or get a retryable 503.
- *Failure before the debit commits*: nothing moved; the retry settles fresh.
- *Credit write fails, currency-only kinds (shrine, bounty placement)*: the
  debit and its receipt are reversed in one save write in the same request
  (503 `refunded`). The refund is classified against the charge's Hollow Gate
  checkpoint, as the refunds it replaces were.
- *Credit write fails for a donation, or the process stops between the two
  writes*: the debit stands (a donation also moved items, merit and daily
  counters, so it is finished rather than unwound). The answer is 503
  `pending`; the retry with the same id rolls the credit FORWARD exactly once,
  and `POST /api/admin/economy-reconcile { txId }` does the same for a donor who
  never retries. The journal is listed under `economyTx.stuck` in
  `GET /api/admin/economy` until then.
- *A write that reported failure but landed*: detected by reading the row back;
  it is kept, not refunded.
- *Evicted receipts*: both receipt lists are capped. A roll-forward credits
  only when a missing receipt is provably missing (`receiptAbsenceProvable`);
  otherwise the journal is marked `needs-reconcile`, the player gets a 409
  `reconcile`, and nothing is credited twice.

The client keeps one id per logical action in `sessionStorage`
(`shinobij.client/src/lib/economy-request-intent.ts`) until the server gives a
final answer, and the screens do not refuse a retry of a pending action on a
local balance check (after a reload the save may already show the charge).

**Bounty payouts are two-phase (#180).** The duel claim and the sleeping-camp
KO used to credit the winner and then remove the head, so a failed board write
left the pool claimable by another battle. Now (`api/pvp/_bounty-claim.ts`):
one board write moves the head from `bounties` to `pendingClaims`; the winner
is credited with an in-save receipt; the duel's per-battle record
(`pvp:bounty-claimed:<battleId>`) is written; the pending entry is removed.
Every claim first finishes older pending entries, and
`POST /api/admin/economy-reconcile { bountyClaims: true }` finishes all of
them. A winner whose save is gone gets the pool put back on the board.

**Server-owned journals on shared rows.** A receipt on a shared row is only
proof if nothing but the server can write it. The clan save validator already
pinned its journals; the village-state validator did not, and two minting
paths followed from it, both proven with real handlers
(`api/village/treasury/transfer-receipt-forgery.test.ts`):
a Kage could plant a `settlementReceipts` entry through a village-state save
and then gift ryo the treasury did not hold (the transfer saga skipped the
balance check, the budget and the debit), and a villager could reset
`agendaClaimReceipts` and collect the daily agenda's treasury tithe again.
Both fields are now pinned for every blob writer, admin included.

## Current settlement notes and remaining trade-offs

- `claim-mission.ts` consumes the combat token before the payout write:
  moving the delete after the write would open a duplicate window on
  repeatable missions. Loss-only, self-healing by re-fight; kept.
- Ordinary Solo-PvE missions and Hollow Gate shinobi combat now settle from
  bound terminal `solo-pve` evidence; no rewarding client-attested win remains
  authorized for those rows.
- Hollow Gate pet settles only the exact versioned cinematic proof selected by
  its parent combat binding. Duplicate starts reuse that proof and seed; new
  Showdown admission and unbound legacy Showdown adoption fail closed. A legacy
  parent may recover only the unique exact active same-player/run cinematic
  child; that compatibility is not a second payout authority. The long-term
  replatform choice remains owner-controlled.
- New paid Pet Coliseum admission and progression belong to Showdown. Newly
  issued ordinary cinematic/social tokens are explicitly no-progression;
  already-issued pre-cutover Arena-AI tokens retain bounded server-replayed,
  capped settlement so a deployment does not strand earned results.
- The former public Pet Ranked queue launched the ordinary memory-only,
  no-reward realtime duel and never settled rating; it is now retired fail-closed.
  An older legacy ranked compatibility path and staged Showdown implementation
  remain unconsumed. The
  retained legacy path is also defective because its client cinematic playback
  and server legacy replay can disagree.
  These are explicit compatibility/integration gaps, not permission to treat any route
  as generic Pet authority.
- The Dungeon reward now requires an exact three-proof chain. The Warden stamps
  its Solo proof; terminal Dungeon Chronicle settlement stamps the deterministic
  Card match outcome; and `/pet/battle-result` server-replays the fixed Rare
  Beast encounter before atomically stamping the Pet outcome and consumable
  spend. A 24-hour Pet result receipt repairs lost responses before the short
  battle token is retired. `/dungeon/run` accepts only Warden, Card, and Pet wins
  on the same active token, then writes `redeemedDungeonRuns` with the parent
  reward. Generic client-local pet presentation remains a distinct boundary and
  is never sanctioned as reward proof.
- Tower/weekly-boss/HG NX receipts keep their rollback-in-catch shape; a hard
  process kill can still strand one (loss-only). Migration to mechanism 1 is
  future hardening, not P0-2.
