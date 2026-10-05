import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { recordEconomyTxn } from '../_economy.js';
import { settlementFingerprint, settlementTransactionId } from '../_durable-settlement.js';
import { completeEconomyTx, ECONOMY_TX_TTL_SECONDS, economyTxKey, failEconomyTx, markEconomyTx, type EconomyTxRecord } from '../_economy-tx.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    SERVER_SETTLEMENT_RECEIPT_LIMIT,
    type SettlementReceiptInspection,
} from '../_settlement-receipts.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';
import { mutatePlayerSaves, type PlayerSavesDecision } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';

/*
 * Receipt-backed state for /api/player/trade (api/player/trade.ts), its admin
 * reconcile (api/admin/economy-reconcile.ts) and its recovery sweep
 * (api/cron/_scheduler.ts).
 *
 * A trade is two save writes: the sender's debit, then the recipient's credit.
 * Each write carries a receipt for the trade, in the same write as the money it
 * moves (`serverSettlementReceipts`, a server-owned field a client autosave
 * cannot touch). A trade interrupted between the two writes can then be
 * finished from what the saves say, exactly once on each side:
 *
 *   debit receipt   credit receipt   stage
 *   present         present          settled      nothing to write; finish the books
 *   present         provably absent  debited      roll the credit forward
 *   provably absent provably absent  not-debited  nothing moved; run it, or cancel it
 *   anything else                    unprovable   leave it for an admin
 *
 * The economy-tx journal adds positive evidence. A write's afterCommit stamps
 * `debitAppliedAt` / `creditAppliedAt` in the journal's meta, which survives a
 * later `failEconomyTx`. A stamp proves the write landed even after its
 * receipt aged out of the save.
 *
 * Three doors finish an interrupted trade, all from that table and all under
 * both save locks: the player's retry of the same nonce, the admin reconcile,
 * and the recovery sweep, which finds unfinished trades through their pending
 * pointers. Every key here is read from shared storage on every worker
 * (api/_storage.ts), because a worker-local snapshot of a marker or a journal
 * could make one of them finish a trade that another already finished.
 */

export const AUDIT_PREFIX = 'audit:player-trade:';
export const NONCE_TTL_SECONDS = 24 * 60 * 60;
export const TRADE_PENDING_PREFIX = 'trade:pending:';
/**
 * How long an unfinished trade sits untouched before the recovery sweep
 * finishes it. Every write of a live attempt touches the journal within
 * moments, and the player's own retry is welcome to finish it first.
 */
export const TRADE_RECOVERY_IDLE_MS = 2 * 60_000;
/**
 * Other flows stamp a receipt with the time their request started, which can
 * precede the moment the receipt was written by however long that request
 * waited on a lock. Absence is proven against a bound this much earlier than
 * the trade's journal, so such a receipt cannot pass for one written before
 * the trade.
 */
const RECEIPT_TIME_MARGIN_MS = 5 * 60_000;

export function tradeNonceKey(sender: string, nonce: string): string {
    return `trade:nonce:${sender}:${nonce}`;
}

/**
 * The recovery sweep's pointer to a trade that is not finished. It is written
 * before the trade's journal and removed once the trade completes or is
 * cancelled, so the sweep's work is proportional to unfinished trades: it never
 * scans journals or saves.
 */
export function tradePendingKey(txId: string): string {
    return `${TRADE_PENDING_PREFIX}${txId}`;
}

/** Publish a new trade's pending pointer. It throws when it cannot: no trade may start without one. */
export async function openTradePointer(txId: string, sender: string, recipient: string): Promise<void> {
    await kv.set(tradePendingKey(txId), { txId, sender, recipient, at: Date.now() }, { ex: ECONOMY_TX_TTL_SECONDS });
}

/** Best-effort: a pointer left behind is cleared by the sweep's next pass. */
async function closeTradePointer(txId: string): Promise<void> {
    await kv.del(tradePendingKey(txId)).catch(() => undefined);
}

/**
 * Free a trade's nonce so the player's retry runs as a new transfer, but only
 * while its marker still names THIS trade. A newer attempt of the same nonce
 * may own the marker by now (one whose own save lock outlived it, or a cancel
 * of an older journal), and deleting that marker would let a retry run the
 * newer attempt a second time. The compare-and-delete is atomic.
 */
export async function releaseTradeNonce(nonceKey: string, txId: string): Promise<void> {
    if (!nonceKey) return;
    const marker = await kv.get<{ txId?: unknown }>(nonceKey);
    if (marker?.txId === txId) await kv.delIfEqual(nonceKey, marker);
}

/**
 * What one nonce is allowed to mean. A retried request that carries the same
 * nonce with a DIFFERENT recipient/currency/amount is not a retry — it is a
 * second transfer wearing the first one's receipt, and is refused.
 */
export function tradeNonceFingerprint(toSlug: string, currency: string, amount: number): string {
    return createHash('sha256').update(JSON.stringify({ to: toSlug, currency, amount })).digest('hex').slice(0, 32);
}

/** What one trade moves, fixed when it was first journalled. */
export type TradeTerms = {
    /** The economy-tx journal id (`player-trade:<hex>`). */
    txId: string;
    sender: string;
    recipient: string;
    currency: string;
    debit: number;
    credit: number;
    burned: number;
};

export type TradeStage =
    | { stage: 'settled' }
    | { stage: 'debited' }
    | { stage: 'not-debited' }
    | { stage: 'unprovable'; reason: string };

/** The receipt id a trade's writes carry. A journal id has a ':', which receipt ids may not. */
export function tradeReceiptId(txId: string): string {
    return settlementTransactionId('player-trade', txId);
}

export function tradeReceiptFingerprint(terms: TradeTerms): string {
    return settlementFingerprint({
        operation: 'player-trade',
        txId: terms.txId,
        sender: terms.sender,
        recipient: terms.recipient,
        currency: terms.currency,
        debit: terms.debit,
        credit: terms.credit,
    });
}

export function inspectTradeReceipt(character: Record<string, unknown>, terms: TradeTerms): SettlementReceiptInspection {
    return inspectSettlementReceipt(character, tradeReceiptId(terms.txId), tradeReceiptFingerprint(terms));
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Whether this save provably holds no receipt for the trade. A missing receipt
 * proves nothing on its own: the list keeps the newest
 * SERVER_SETTLEMENT_RECEIPT_LIMIT entries, so the trade's receipt may have aged
 * out. The trade was journalled before either write, so its journal's
 * `createdAt`, less the margin above, is the lower bound receiptAbsenceProvable
 * needs.
 */
function provablyAbsent(inspection: SettlementReceiptInspection, tradeCreatedAt: number): boolean {
    return inspection.status === 'fresh'
        && receiptAbsenceProvable(inspection.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', tradeCreatedAt - RECEIPT_TIME_MARGIN_MS);
}

/** Where a journalled trade stands, read from both saves and the journal. */
export function tradeStage(
    sender: Record<string, unknown>,
    recipient: Record<string, unknown>,
    terms: TradeTerms,
    journal: EconomyTxRecord | null,
): TradeStage {
    const senderReceipt = inspectTradeReceipt(sender, terms);
    const recipientReceipt = inspectTradeReceipt(recipient, terms);
    if (senderReceipt.status === 'invalid' || recipientReceipt.status === 'invalid') {
        return { stage: 'unprovable', reason: 'A settlement receipt list could not be read.' };
    }
    if (senderReceipt.status === 'conflict' || recipientReceipt.status === 'conflict') {
        return { stage: 'unprovable', reason: 'A receipt for this trade records different terms.' };
    }
    const meta = journal?.meta ?? {};
    const createdAt = num(journal?.createdAt);
    const debited = senderReceipt.status === 'replay' || num(meta.debitAppliedAt) > 0;
    const credited = recipientReceipt.status === 'replay' || num(meta.creditAppliedAt) > 0;
    if (debited && credited) return { stage: 'settled' };
    if (debited && provablyAbsent(recipientReceipt, createdAt)) return { stage: 'debited' };
    if (!debited && !credited && provablyAbsent(senderReceipt, createdAt) && provablyAbsent(recipientReceipt, createdAt)) {
        return { stage: 'not-debited' };
    }
    if (credited && !debited) return { stage: 'unprovable', reason: 'The recipient was credited without a recorded debit.' };
    return { stage: 'unprovable', reason: 'A receipt this trade needs may have aged out of a full receipt list.' };
}

/** The sender's character after the debit, carrying the trade's receipt. */
export function debitWithReceipt(sender: Record<string, unknown>, terms: TradeTerms, settledAt: number): Record<string, unknown> {
    const inspection = inspectTradeReceipt(sender, terms);
    return appendSettlementReceipt({ ...sender, [terms.currency]: num(sender[terms.currency]) - terms.debit }, inspection.receipts, {
        requestId: tradeReceiptId(terms.txId),
        fingerprint: tradeReceiptFingerprint(terms),
        value: { side: 'debit', ...terms },
        settledAt,
    });
}

/** The recipient's character after the credit, carrying the trade's receipt. */
export function creditWithReceipt(recipient: Record<string, unknown>, terms: TradeTerms, settledAt: number): Record<string, unknown> {
    const inspection = inspectTradeReceipt(recipient, terms);
    return appendSettlementReceipt({ ...recipient, [terms.currency]: num(recipient[terms.currency]) + terms.credit }, inspection.receipts, {
        requestId: tradeReceiptId(terms.txId),
        fingerprint: tradeReceiptFingerprint(terms),
        value: { side: 'credit', ...terms },
        settledAt,
    });
}

/** A journal's trade terms, or null when the record is not a usable player trade. */
export function tradeTermsFromJournal(journal: EconomyTxRecord | null): TradeTerms | null {
    if (!journal || journal.kind !== 'player-trade') return null;
    const sender = String(journal.debitKey ?? '');
    const recipient = String(journal.creditKey ?? '');
    if (!sender.startsWith('save:') || !recipient.startsWith('save:')) return null;
    const debit = Math.floor(num(journal.amount));
    const credit = Math.floor(num(journal.meta?.credit));
    const burned = Math.floor(num(journal.meta?.burned));
    if (debit <= 0 || credit < 0 || burned < 0 || credit + burned !== debit) return null;
    return {
        txId: journal.id,
        sender: sender.slice('save:'.length),
        recipient: recipient.slice('save:'.length),
        currency: String(journal.resource ?? ''),
        debit,
        credit,
        burned,
    };
}

/**
 * Close a trade's books, under both save locks: complete the journal, upgrade
 * the nonce to the final receipt that a retry replays, and drop the trade's
 * pending pointer. Returns whether THIS call completed the trade. False means
 * an earlier call already had, so the caller must not record the trade a
 * second time.
 */
export async function closeTradeBooks(
    terms: TradeTerms,
    replay: { nonceKey: string; fingerprint: string; body: Record<string, unknown> },
): Promise<boolean> {
    const journal = await kv.get<EconomyTxRecord>(economyTxKey(terms.txId)).catch(() => null);
    const completedNow = journal?.state !== 'complete';
    if (completedNow) await completeEconomyTx(terms.txId).catch(() => undefined);
    if (replay.nonceKey) {
        await kv.set(replay.nonceKey, { ts: Date.now(), receipt: replay.body, fp: replay.fingerprint }, { ex: NONCE_TTL_SECONDS }).catch(() => undefined);
    }
    await closeTradePointer(terms.txId);
    return completedNow;
}

/** The audit row and the burn telemetry of a trade, recorded once: when closeTradeBooks returned true. */
export async function recordTradeCompletion(terms: TradeTerms, now = Date.now()): Promise<void> {
    await kv.set(`${AUDIT_PREFIX}${now}`, {
        ts: now, from: terms.sender, to: terms.recipient, currency: terms.currency,
        debit: terms.debit, credit: terms.credit, burned: terms.burned,
    }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
    // Economy telemetry — the 10% trade burn is a real "currency destroyed"
    // signal (sink), logged as a negative delta.
    if (terms.burned > 0) {
        await recordEconomyTxn({ txnId: `trade-burn:${now}`, player: terms.sender, currency: terms.currency, delta: -terms.burned, source: 'trade.burn' });
    }
}

/** How a reconcile left a trade. The admin economy view shows it beside the journal. */
export type TradeReconcileStatus = 'already-complete' | 'completed' | 'credited' | 'no-debit';

type ReconcileOutcome =
    | { status: 'completed' | 'credited'; completedNow: boolean }
    | { status: 'already-complete' | 'no-debit' }
    | { status: 'unprovable'; reason: string };

/**
 * Reconcile a `player-trade` journal: the admin's (api/admin/economy-reconcile.ts)
 * and the recovery sweep's. It finishes the trade the way a retry of the
 * player's own nonce would:
 *   settled      → close the books                                 'completed'
 *   debited      → roll the credit forward, then close the books   'credited'
 *   not-debited  → nothing moved: cancel the journal and free the   'no-debit'
 *                  nonce, so the player's own retry runs as a new transfer
 *   unprovable   → refuse with 409; a human has to look
 * It never touches the send budget: a debit that landed was charged when it
 * committed.
 */
export async function reconcilePlayerTrade(
    txId: string,
    opts: { by?: 'admin' | 'sweep' } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
    const by = opts.by ?? 'admin';
    const journal = await kv.get<EconomyTxRecord>(economyTxKey(txId));
    if (!journal) return { status: 404, body: { error: 'Economy transaction not found.' } };
    const terms = tradeTermsFromJournal(journal);
    if (!terms) return { status: 400, body: { error: 'This journal is not a usable player trade.' } };
    const done = async (status: TradeReconcileStatus, extra: Record<string, unknown> = {}) => ({
        status: 200,
        body: { ok: true, status, transactionId: txId, ...extra, tx: await kv.get<EconomyTxRecord>(economyTxKey(txId)).catch(() => null) },
    });
    if (journal.state === 'complete' || journal.state === 'refunded') {
        await closeTradePointer(txId);
        return done(journal.state === 'complete' ? 'already-complete' : 'no-debit');
    }
    if (journal.meta?.receiptBacked !== true) {
        return { status: 409, body: { error: 'This trade predates trade receipts, so its saves cannot prove what moved. Settle it by hand.' } };
    }
    const nonce = typeof journal.meta?.nonce === 'string' ? journal.meta.nonce : '';
    const nonceKey = nonce ? tradeNonceKey(terms.sender, nonce) : '';
    const fingerprint = tradeNonceFingerprint(terms.recipient, terms.currency, terms.debit);

    let outcome: ReconcileOutcome | null = null;
    const out = await retryOnSaveVersionConflict(() => mutatePlayerSaves<null>([terms.sender, terms.recipient], async (sides): Promise<PlayerSavesDecision<null>> => {
        outcome = null;
        const sender = sides[terms.sender]!.character;
        const recipient = sides[terms.recipient]!.character;
        const untouched = {
            [terms.sender]: { character: sender, write: false },
            [terms.recipient]: { character: recipient, write: false },
        };
        // Re-read under the locks: the player's own retry, or the other door,
        // may have finished it.
        const current = (await kv.get<EconomyTxRecord>(economyTxKey(txId))) ?? journal;
        if (current.state === 'complete' || current.state === 'refunded') {
            outcome = { status: current.state === 'complete' ? 'already-complete' : 'no-debit' };
            return { ok: true, value: null, sides: untouched, afterCommit: () => closeTradePointer(txId) };
        }
        const stage = tradeStage(sender, recipient, terms, current);
        if (stage.stage === 'unprovable') {
            outcome = { status: 'unprovable', reason: stage.reason };
            return { ok: true, value: null, sides: untouched };
        }
        if (stage.stage === 'not-debited') {
            return {
                ok: true, value: null, sides: untouched,
                afterCommit: async () => {
                    await releaseTradeNonce(nonceKey, txId);
                    await markEconomyTx(txId, 'refunded', { note: `Reconciled (${by}): the debit never landed, so nothing moved. Cancelled.` });
                    await closeTradePointer(txId);
                    outcome = { status: 'no-debit' };
                },
            };
        }
        const status = stage.stage === 'debited' ? 'credited' : 'completed';
        const close = async (saves: Record<string, { character: Record<string, unknown>; _saveVersion: number }>) => {
            const senderSave = saves[terms.sender]!;
            const completedNow = await closeTradeBooks(terms, {
                nonceKey,
                fingerprint,
                body: {
                    ok: true, currency: terms.currency, debit: terms.debit, credit: terms.credit, burned: terms.burned,
                    toPlayer: String(recipient.name ?? terms.recipient),
                    senderBalance: num(senderSave.character[terms.currency]),
                    _saveVersion: senderSave._saveVersion,
                },
            });
            outcome = { status, completedNow };
        };
        if (stage.stage === 'settled') return { ok: true, value: null, sides: untouched, afterCommit: close };
        // The debit landed and the credit provably did not: roll it forward.
        let meta = { ...(current.meta ?? {}) };
        return {
            ok: true,
            value: null,
            sides: {
                [terms.sender]: { character: sender, write: false },
                [terms.recipient]: {
                    character: creditWithReceipt(recipient, terms, Date.now()),
                    afterCommit: async () => {
                        meta = { ...meta, creditAppliedAt: Date.now() };
                        await markEconomyTx(txId, 'credit-applied', { meta }).catch(() => undefined);
                    },
                },
            },
            afterCommit: close,
        };
    }));
    if (!out.ok) {
        return { status: out.status, body: { error: out.status === 404 ? `The save of ${out.playerName ?? 'a party'} was not found.` : out.error } };
    }
    const result = outcome as ReconcileOutcome | null;
    if (!result) throw new Error(`reconcilePlayerTrade(${txId}) decided nothing.`);
    if (result.status === 'unprovable') {
        await failEconomyTx(txId, new Error('trade-unprovable'), { note: result.reason }).catch(() => undefined);
        return { status: 409, body: { error: result.reason } };
    }
    if ('completedNow' in result && result.completedNow) await recordTradeCompletion(terms);
    return done(result.status, result.status === 'credited' ? { credited: terms.credit } : {});
}

export type PlayerTradeRecoverySummary = {
    /** Trades this pass reconciled. */
    reconciled: number;
    finished: Array<{ txId: string; status: string }>;
    /** Trades the receipts cannot settle. Each is left to a human, and the sweep stops retrying it. */
    heldForReview: Array<{ txId: string; reason: string }>;
    /** Storage errors; these are retried on the next pass. */
    failures: Array<{ txId: string; error: string }>;
    /** Trades touched too recently to be anything but live. */
    waiting: number;
    truncated: boolean;
};

/**
 * Bounded recovery pass for the in-process scheduler. It finds unfinished
 * trades through their pending pointers and finishes each one that has sat
 * untouched for `idleMs`, exactly as the admin reconcile would: the credit of
 * a debited trade rolls forward, and a trade that moved nothing is cancelled.
 * So a trade that died between its two writes reaches the recipient whether or
 * not the sender ever retries it.
 */
export async function recoverPendingPlayerTrades(opts: {
    now?: number;
    idleMs?: number;
    limit?: number;
    budgetMs?: number;
} = {}): Promise<PlayerTradeRecoverySummary> {
    const started = Date.now();
    const now = opts.now ?? started;
    const idleMs = Math.max(0, Math.floor(opts.idleMs ?? TRADE_RECOVERY_IDLE_MS));
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 25)));
    const budgetMs = Math.max(1_000, Math.floor(opts.budgetMs ?? 30_000));
    const summary: PlayerTradeRecoverySummary = { reconciled: 0, finished: [], heldForReview: [], failures: [], waiting: 0, truncated: false };

    const txIds = (await kv.keys(`${TRADE_PENDING_PREFIX}*`))
        .filter((key) => key.startsWith(TRADE_PENDING_PREFIX))
        .map((key) => key.slice(TRADE_PENDING_PREFIX.length))
        .sort();
    for (const txId of txIds) {
        if (summary.reconciled >= limit || Date.now() - started > budgetMs) { summary.truncated = true; break; }
        try {
            const journal = await kv.get<EconomyTxRecord>(economyTxKey(txId));
            if (!journal) {
                // The pointer is written just before its journal. Give a live
                // attempt time to reserve it; after that, the attempt died
                // before it could move anything.
                const pointer = await kv.get<{ at?: unknown }>(tradePendingKey(txId));
                if (now - num(pointer?.at) < idleMs) summary.waiting += 1;
                else await kv.del(tradePendingKey(txId));
                continue;
            }
            const terminal = journal.state === 'complete' || journal.state === 'refunded';
            if (!terminal && now - num(journal.updatedAt) < idleMs) { summary.waiting += 1; continue; }
            summary.reconciled += 1;
            const outcome = await reconcilePlayerTrade(txId, { by: 'sweep' });
            if (outcome.status === 200) {
                summary.finished.push({ txId, status: String(outcome.body.status) });
                continue;
            }
            // The receipts cannot settle it (or a save is gone). Its journal
            // says why, for the admin economy view; clearing the pointer stops
            // the sweep from retrying what only a human can decide.
            summary.heldForReview.push({ txId, reason: String(outcome.body.error ?? `HTTP ${outcome.status}`) });
            await kv.del(tradePendingKey(txId));
        } catch (error) {
            summary.failures.push({ txId, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return summary;
}
