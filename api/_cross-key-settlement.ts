import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';
import { beginDurableSettlement, cancelDurableSettlement, completeDurableSettlement, inspectSettlementReceipt as inspectSourceReceipt, settlementTransactionId, updateDurableSettlement, type DurableSettlementRecord } from './_durable-settlement.js';
import { appendSettlementReceipt as appendPlayerReceipt, inspectSettlementReceipt as inspectPlayerReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT, type ServerSettlementReceipt } from './_settlement-receipts.js';
import { receiptAbsenceProvable } from './_save-debit-saga.js';

export class SettlementValidationError extends Error {
    /**
     * `details` are extra response fields a caller wants beside `error` — the
     * transfer budget's `reason`/`remaining`/`limit`, so a refusal raised from
     * inside the saga answers with the same body it had when it was raised
     * before the saga.
     */
    constructor(public readonly status: number, message: string, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = 'SettlementValidationError';
    }
}

export type CrossKeySettlementResult = {
    result: Record<string, unknown>;
    transaction: DurableSettlementRecord;
    /**
     * True when this call moved NOTHING and simply returned the stored result of
     * an earlier, identical settlement.
     *
     * Callers must consult this before charging any side effect that lives
     * OUTSIDE the saga — a rolling transfer budget, a daily counter, telemetry.
     * The idempotency key defaults to a content fingerprint (village/clan +
     * recipient + item/currency + amount) whenever the client sends no
     * requestId, and neither treasury client sends one, so two genuinely
     * separate gifts of the same amount to the same player inside the journal's
     * 90-day TTL are indistinguishable from a retry and resolve here.
     */
    replayed: boolean;
};

export type CrossKeySettlementOptions<S extends Record<string, unknown>> = {
    operationType: string;
    idempotencyKey: string;
    fingerprint: string;
    actorIds: string[];
    resource: string;
    amount: number;
    meta?: Record<string, unknown>;
    /** The shared record (clan or village row). Locked FIRST — see below. */
    sourceKey: string;
    /** The player save being credited. Locked second. */
    recipientKey: string;
    loadSource: () => Promise<S | null>;
    validateSource: (source: S) => void | Promise<void>;
    debitSource: (source: S, receipt: { transactionId: string; fingerprint: string; resource: string; amount: number; appliedAt: number }) => S;
    saveSource: (source: S) => Promise<void>;
    loadRecipient: () => Promise<{ record: Record<string, unknown>; character: Record<string, unknown> } | null>;
    validateRecipient: (recipient: { record: Record<string, unknown>; character: Record<string, unknown> }) => void | Promise<void>;
    creditRecipient: (character: Record<string, unknown>) => { character: Record<string, unknown>; result: Record<string, unknown> };
    saveRecipient: (record: Record<string, unknown>, character: Record<string, unknown>) => Promise<Record<string, unknown>>;
    sourceReceiptField?: string;
    /** The cap debitSource applies to the source's receipt list. Every caller keeps 100. */
    sourceReceiptLimit?: number;
};

/**
 * Reserve-first, receipt-backed settlement for one shared record and one
 * player save. The shared record is locked first, then the player save. A
 * process interruption leaves the journal and the applied-side receipt behind,
 * so the next request resumes instead of applying either side twice.
 *
 * Lock order is shared record → player save, NOT a lexical sort. It must match
 * every other path that nests the same two rows, or two requests each take one
 * row and wait on the other until both fail closed. Clan exchange, treasury
 * donate, kick, leave and dissolve all take the clan row first. A clan row
 * (`save:clan-<slug>`) shares the `save:` namespace with player saves, so a
 * sort put members named before `clan-` (`save:aoi`) ahead of it and inverted
 * the order for them. The village row (`game:village-state:*`) sorts first
 * either way, so village transfers lock exactly as before.
 */
export async function settleCrossKeyTransfer<S extends Record<string, unknown>>(
    options: CrossKeySettlementOptions<S>,
): Promise<CrossKeySettlementResult> {
    const transactionId = settlementTransactionId(options.operationType, options.idempotencyKey);
    const started = await beginDurableSettlement({
        transactionId,
        idempotencyKey: options.idempotencyKey,
        operationType: options.operationType,
        fingerprint: options.fingerprint,
        actorIds: options.actorIds,
        resource: options.resource,
        amount: options.amount,
        meta: { sourceKey: options.sourceKey, recipientKey: options.recipientKey, ...(options.meta ?? {}) },
    }, { kv });
    if (started.status === 'conflict') throw new SettlementValidationError(409, 'That settlement ID is already bound to a different operation.');
    if (started.record.state === 'completed' && started.record.result) {
        return { result: started.record.result, transaction: started.record, replayed: true };
    }

    return withKvLock(options.sourceKey, () => withKvLock(options.recipientKey, async () => {
        let tx = await beginDurableSettlement({
            transactionId,
            idempotencyKey: options.idempotencyKey,
            operationType: options.operationType,
            fingerprint: options.fingerprint,
            actorIds: options.actorIds,
            resource: options.resource,
            amount: options.amount,
            meta: { sourceKey: options.sourceKey, recipientKey: options.recipientKey, ...(options.meta ?? {}) },
        }, { kv });
        if (tx.status === 'conflict') throw new SettlementValidationError(409, 'That settlement ID is already bound to a different operation.');
        if (tx.record.state === 'completed' && tx.record.result) return { result: tx.record.result, transaction: tx.record, replayed: true };
        // Both sides were written and only the completion was lost. The
        // journal holds the result, so finish from it: the receipts that
        // prove the two writes may have been pushed out of their capped lists
        // by now, and nothing needs writing again.
        if (tx.record.state === 'credit-applied' && tx.record.result) {
            const completed = await completeDurableSettlement(transactionId, tx.record.result, { kv });
            return { result: tx.record.result, transaction: completed, replayed: false };
        }
        // An earlier attempt reserved this transfer, so one of its writes may
        // have landed. Its receipt tells, unless newer receipts have pushed it
        // off the end of its capped list since; runSaveDebitSaga guards the
        // same way. A cancelled attempt wrote nothing, and a pending one never
        // reached the write.
        const resumed = tx.record.state !== 'pending' && tx.record.state !== 'cancelled';

        let mutationObserved = false;
        try {
            const source = await options.loadSource();
            if (!source) throw new SettlementValidationError(404, 'Source record not found.');
            const sourceField = options.sourceReceiptField ?? 'settlementReceipts';
            const sourceState = inspectSourceReceipt(source, transactionId, options.fingerprint, sourceField);
            if (sourceState === 'conflict' || sourceState === 'invalid') {
                throw new SettlementValidationError(409, 'The source record has a conflicting settlement receipt.');
            }
            // From here a refusal must never cancel a transfer whose debit
            // already landed: a cancelled journal is final and invisible to the
            // stale sweep, and the debited value would be stranded unseen.
            mutationObserved = sourceState === 'replay';

            const recipient = await options.loadRecipient();
            if (!recipient) throw new SettlementValidationError(404, 'Recipient save not found.');
            const receiptState = inspectPlayerReceipt(recipient.character, transactionId, options.fingerprint);
            if (receiptState.status === 'conflict' || receiptState.status === 'invalid') {
                throw new SettlementValidationError(409, 'The recipient save has a conflicting settlement receipt.');
            }
            mutationObserved = sourceState === 'replay' || receiptState.status === 'replay';

            if (resumed) {
                const sourceList = Array.isArray(source[sourceField]) ? source[sourceField] as unknown[] : [];
                const debitUnknown = sourceState === 'fresh'
                    && !receiptAbsenceProvable(sourceList, options.sourceReceiptLimit ?? 100, 'appliedAt', tx.record.createdAt);
                const creditUnknown = sourceState === 'replay' && receiptState.status === 'fresh'
                    && !receiptAbsenceProvable(receiptState.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', tx.record.createdAt);
                if (debitUnknown || creditUnknown) {
                    // Writing now could apply a side a second time. Leave the
                    // journal for an operator instead of cancelling it.
                    mutationObserved = true;
                    throw new SettlementValidationError(409, 'This transfer can no longer be proven either way, so nothing was moved. An administrator must reconcile it.', { reconcile: true });
                }
            }

            if (sourceState === 'fresh') {
                if (receiptState.status === 'replay') {
                    throw new SettlementValidationError(409, 'Recipient credit exists without its reserve-first source debit.');
                }
                // Both records are already locked. Validate both sides before
                // the first write so a stale membership/authorization check can
                // never strand a source debit.
                await options.validateSource(source);
                await options.validateRecipient(recipient);
                tx = { status: 'existing', record: await updateDurableSettlement(transactionId, { state: 'reserved', failureReason: undefined }, { kv }) };
                const debited = options.debitSource(source, {
                    transactionId,
                    fingerprint: options.fingerprint,
                    resource: options.resource,
                    amount: options.amount,
                    appliedAt: Date.now(),
                });
                await options.saveSource(debited);
                mutationObserved = true;
                tx = { status: 'existing', record: await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv }) };
            }

            let result: Record<string, unknown>;
            if (receiptState.status === 'replay') {
                result = {
                    ...receiptState.receipt.value,
                    ...(recipient.record._saveVersion !== undefined ? { _saveVersion: recipient.record._saveVersion } : {}),
                };
            } else {
                // A source receipt proves the mutable authorization checks ran
                // before the debit. On recovery, finish that already-authorized
                // intent even if membership changed after the process boundary.
                const credited = options.creditRecipient(recipient.character);
                const existingReceipts = Array.isArray(recipient.character.serverSettlementReceipts)
                    ? recipient.character.serverSettlementReceipts as ServerSettlementReceipt[]
                    : [];
                const withReceipt = appendPlayerReceipt(credited.character, existingReceipts, {
                    requestId: transactionId,
                    fingerprint: options.fingerprint,
                    value: credited.result,
                    settledAt: Date.now(),
                });
                const written = await options.saveRecipient(recipient.record, withReceipt);
                mutationObserved = true;
                result = { ...credited.result, ...(written._saveVersion !== undefined ? { _saveVersion: written._saveVersion } : {}) };
                tx = { status: 'existing', record: await updateDurableSettlement(transactionId, { state: 'credit-applied', result }, { kv }) };
            }

            const completed = await completeDurableSettlement(transactionId, result, { kv });
            return { result, transaction: completed, replayed: false };
        } catch (error) {
            if (mutationObserved) {
                await updateDurableSettlement(transactionId, {
                    state: 'reconciliation-required',
                    failureReason: error instanceof Error ? error.message : String(error),
                }, { kv }).catch(() => undefined);
            } else if (error instanceof SettlementValidationError) {
                await cancelDurableSettlement(transactionId, {
                    status: error.status,
                    error: error.message,
                }, { kv }).catch(() => undefined);
            }
            throw error;
        }
    }, { failClosed: true }), { failClosed: true });
}
