import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';
import { beginDurableSettlement, cancelDurableSettlement, completeDurableSettlement, inspectSettlementReceipt as inspectSourceReceipt, settlementTransactionId, updateDurableSettlement, type DurableSettlementRecord } from './_durable-settlement.js';
import { appendSettlementReceipt as appendPlayerReceipt, inspectSettlementReceipt as inspectPlayerReceipt, type ServerSettlementReceipt } from './_settlement-receipts.js';

export class SettlementValidationError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'SettlementValidationError';
    }
}

export type CrossKeySettlementResult = {
    result: Record<string, unknown>;
    transaction: DurableSettlementRecord;
};

export type CrossKeySettlementOptions<S extends Record<string, unknown>> = {
    operationType: string;
    idempotencyKey: string;
    fingerprint: string;
    actorIds: string[];
    resource: string;
    amount: number;
    meta?: Record<string, unknown>;
    sourceKey: string;
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
};

/**
 * Reserve-first, receipt-backed settlement for one shared record and one
 * player save. Both rows are locked in lexical order. A process interruption
 * leaves the journal and the applied-side receipt behind, so the next request
 * resumes instead of applying either side twice.
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
        return { result: started.record.result, transaction: started.record };
    }

    const [firstKey, secondKey] = [options.sourceKey, options.recipientKey].sort();
    return withKvLock(firstKey, () => withKvLock(secondKey, async () => {
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
        if (tx.record.state === 'completed' && tx.record.result) return { result: tx.record.result, transaction: tx.record };

        let mutationObserved = false;
        try {
            const source = await options.loadSource();
            if (!source) throw new SettlementValidationError(404, 'Source record not found.');
            const sourceField = options.sourceReceiptField ?? 'settlementReceipts';
            const sourceState = inspectSourceReceipt(source, transactionId, options.fingerprint, sourceField);
            if (sourceState === 'conflict' || sourceState === 'invalid') {
                throw new SettlementValidationError(409, 'The source record has a conflicting settlement receipt.');
            }

            const recipient = await options.loadRecipient();
            if (!recipient) throw new SettlementValidationError(404, 'Recipient save not found.');
            const receiptState = inspectPlayerReceipt(recipient.character, transactionId, options.fingerprint);
            if (receiptState.status === 'conflict' || receiptState.status === 'invalid') {
                throw new SettlementValidationError(409, 'The recipient save has a conflicting settlement receipt.');
            }
            mutationObserved = sourceState === 'replay' || receiptState.status === 'replay';

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
            return { result, transaction: completed };
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
