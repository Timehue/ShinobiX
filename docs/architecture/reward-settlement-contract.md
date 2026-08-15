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

## Current settlement notes and remaining trade-offs

- `claim-mission.ts` consumes the combat token before the payout write:
  moving the delete after the write would open a duplicate window on
  repeatable missions. Loss-only, self-healing by re-fight; kept.
- Ordinary Solo-PvE missions and Hollow Gate shinobi combat now settle from
  bound terminal `solo-pve` evidence; no rewarding client-attested win remains
  authorized for those rows.
- Hollow Gate pet currently settles a run-bound receipt from server-replayed
  cinematic PvE while a separate Showdown-capable branch remains unmounted.
  The former public Pet Ranked queue launched the ordinary memory-only,
  no-reward realtime duel and never settled rating; it is now retired fail-closed.
  An older legacy ranked compatibility path and staged Showdown implementation
  remain unconsumed. The
  retained legacy path is also defective because its client cinematic playback
  and server legacy replay can disagree.
  These are explicit owner/integration gaps, not permission to treat any route
  as generic Pet authority.
- Dungeon pet remains a client-local presentation whose rewarding parent
  settlement consumes no server-selected encounter or terminal pet proof. It is
  a recorded authority defect, not sanctioned bounded client trust.
- Tower/weekly-boss/HG NX receipts keep their rollback-in-catch shape; a hard
  process kill can still strand one (loss-only). Migration to mechanism 1 is
  future hardening, not P0-2.
