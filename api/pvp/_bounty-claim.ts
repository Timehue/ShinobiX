/*
 * Two-phase bounty payout (issue #180), shared by the duel claim
 * (api/pvp/bounty.ts, action 'claim') and the sleeping-camp KO
 * (api/pvp/_bounty-settle.ts).
 *
 * Both paths used to CREDIT the winner and only then WRITE the board. When the
 * board write failed after the credit, the head stayed posted and a different
 * battle could collect the same pool again — up to BOUNTY_MAX_PER_TARGET,
 * 10,000,000 ryo. The order is now:
 *
 *   1. reserve — one board write takes the head out of `bounties` and records
 *      it under `pendingClaims`. From that write on, no other claim can reach
 *      the pool, whatever happens next.
 *   2. pay — the winner's save gains the pool and an in-save receipt keyed by
 *      the claim id, in one save write. Any later attempt finds the receipt
 *      and pays nothing.
 *   3. finish — the duel's per-battle record is written, then the pending
 *      entry leaves the board.
 *
 * A pending claim left behind by a crash or a failed write is resumed by the
 * next claim of the same battle, and every claim first sweeps older pending
 * entries, so an interrupted sleeping-camp payout finishes too. A claim whose
 * winner no longer has a save puts the pool back on the board.
 *
 * Lock order: BOUNTY_KEY, then `save:<winner>` (inside mutatePlayerSave) — the
 * order placement and the sleeping-camp KO already use.
 */
import { kv } from '../_storage.js';
import { settlementFingerprint, settlementTransactionId } from '../_durable-settlement.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    SERVER_SETTLEMENT_RECEIPT_LIMIT,
    SERVER_SETTLEMENT_RECEIPTS_FIELD,
} from '../_settlement-receipts.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    finishBountyClaim,
    restoreBountyClaim,
    type BountyBoard,
    type PendingBountyClaim,
} from './_bounty.js';

/** A pending claim younger than this is left to the request that reserved it. */
export const BOUNTY_CLAIM_SWEEP_AFTER_MS = 30_000;
/** Matches the PvP completion receipt, so a lost ACK can still show the paid amount. */
export const BOUNTY_CLAIM_RECORD_TTL_SECONDS = 48 * 60 * 60;

export function bountyClaimRecordKey(battleId: string): string {
    return `pvp:bounty-claimed:${battleId}`;
}

export function duelBountyClaimId(battleId: string): string {
    return `duel:${battleId}`;
}

/** The in-save receipt id that proves a claim was paid. */
export function bountyClaimReceiptId(claimId: string): string {
    return settlementTransactionId('pvp-bounty-claim', claimId);
}

function claimFingerprint(pending: PendingBountyClaim): string {
    return settlementFingerprint({
        claimId: pending.id,
        winner: pending.winner,
        target: pending.head.target,
        amount: pending.head.amount,
    });
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export type BountyPayResult =
    | { status: 'paid'; ryo: number; saveVersion: number; creditedNow: boolean }
    | { status: 'missing-save' }
    | { status: 'unprovable'; reason: string };

/**
 * Phase 2: credit a reserved claim to its winner, exactly once. The caller
 * holds BOUNTY_KEY. Throws on a storage failure; the claim then stays pending
 * and the next attempt or sweep resumes it.
 */
export async function payPendingBountyClaim(pending: PendingBountyClaim): Promise<BountyPayResult> {
    const receiptId = bountyClaimReceiptId(pending.id);
    const fingerprint = claimFingerprint(pending);
    const out = await mutatePlayerSave<{ creditedNow: boolean; ryo: number } | { unprovable: string }>(pending.winner, ({ character }) => {
        const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
        if (inspected.status === 'replay') {
            return { ok: true, character, value: { creditedNow: false, ryo: num(character.ryo) }, write: false };
        }
        if (inspected.status !== 'fresh') {
            return { ok: true, character, value: { unprovable: 'The winner save holds a conflicting or unreadable settlement receipt.' }, write: false };
        }
        // The capped receipt list may have evicted the proof of an earlier
        // payout. Credit only when its absence is provable.
        const list = Array.isArray(character[SERVER_SETTLEMENT_RECEIPTS_FIELD])
            ? character[SERVER_SETTLEMENT_RECEIPTS_FIELD] as unknown[]
            : [];
        if (!receiptAbsenceProvable(list, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', pending.at)) {
            return { ok: true, character, value: { unprovable: 'The payout receipt has aged out, so the payout cannot be proven either way.' }, write: false };
        }
        const ryo = num(character.ryo) + pending.head.amount;
        return {
            ok: true,
            character: appendSettlementReceipt({ ...character, ryo }, inspected.receipts, {
                requestId: receiptId,
                fingerprint,
                value: { kind: 'pvp-bounty-claim', claimId: pending.id, target: pending.head.target, amount: pending.head.amount, ryo },
                settledAt: Date.now(),
            }),
            value: { creditedNow: true, ryo },
        };
    });
    if (!out.ok) return out.status === 404 ? { status: 'missing-save' } : { status: 'unprovable', reason: out.error };
    if ('unprovable' in out.value) return { status: 'unprovable', reason: out.value.unprovable };
    return { status: 'paid', ryo: out.value.ryo, saveVersion: out._saveVersion, creditedNow: out.value.creditedNow };
}

export type DuelBountyRecord = {
    ts: number;
    amount: number;
    target?: string;
    balances?: { ryo: number };
    voided?: string;
};

/** The per-battle answer a retry and the result panel read. Written once per battle. */
export async function writeDuelBountyRecord(battleId: string, record: DuelBountyRecord): Promise<void> {
    await kv.set(bountyClaimRecordKey(battleId), record, { ex: BOUNTY_CLAIM_RECORD_TTL_SECONDS });
}

/**
 * Finish every pending claim reserved more than BOUNTY_CLAIM_SWEEP_AFTER_MS
 * ago, other than `exceptId`. The caller holds BOUNTY_KEY and writes the
 * returned board when it differs. A claim that cannot be finished safely is
 * left pending and logged, never paid twice.
 */
export async function sweepPendingBountyClaims(board: BountyBoard, now: number, exceptId?: string): Promise<BountyBoard> {
    let next = board;
    for (const pending of board.pendingClaims ?? []) {
        if (pending.id === exceptId || now - pending.at < BOUNTY_CLAIM_SWEEP_AFTER_MS) continue;
        try {
            const paid = await payPendingBountyClaim(pending);
            if (paid.status === 'paid') {
                if (pending.battleId) {
                    await writeDuelBountyRecord(pending.battleId, {
                        ts: now,
                        amount: pending.head.amount,
                        target: pending.head.target,
                        balances: { ryo: paid.ryo },
                    });
                }
                next = finishBountyClaim(next, pending.id);
            } else if (paid.status === 'missing-save') {
                next = restoreBountyClaim(next, pending.id);
            } else {
                console.error('[pvp/bounty] pending claim needs reconciliation', pending.id, paid.reason);
            }
        } catch (error) {
            console.error('[pvp/bounty] pending claim sweep failed', pending.id, error instanceof Error ? error.message : String(error));
        }
    }
    return next;
}
