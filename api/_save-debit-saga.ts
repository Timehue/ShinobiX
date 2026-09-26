import { randomUUID } from 'node:crypto';
import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';
import { completeEconomyTx, economyTxKey, failEconomyTx, markEconomyTx, type EconomyTxRecord } from './_economy-tx.js';
import { settlementFingerprint, settlementTransactionId } from './_durable-settlement.js';
import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    SERVER_SETTLEMENT_RECEIPT_LIMIT,
    SERVER_SETTLEMENT_RECEIPTS_FIELD,
} from './_settlement-receipts.js';
import { mutatePlayerSave, type PlayerCharacter, type PlayerSaveRecord } from './save/_mutate-player-save.js';
import { hollowGateRefundCurrencySource } from './hollow-gate/_external-credits.js';

/*
 * Retry-safe "player save -> shared record" economy settlement (issue #179).
 *
 * The mirror image of api/_cross-key-settlement.ts. There a shared record is
 * debited and a player save credited; here a player's save is DEBITED and one
 * shared record is CREDITED: a shrine ledger, the bounty board, a clan row, a
 * village row. The two writes cannot be one transaction, so each lands with its
 * own durable receipt in the SAME write as the value it moves:
 *
 *   1. The debit and an in-save `serverSettlementReceipts` entry are one save
 *      write (the api/bank/transfer.ts convention). The same request id can
 *      never debit twice.
 *   2. The credit and a `settlementReceipts` entry on the shared record are one
 *      write. The same request id can never credit twice.
 *   3. The economy-tx journal (`economy-tx:<id>`, listed as "stuck" by
 *      /api/admin/economy until it finishes) records progress and the result a
 *      replay returns, and outlives the capped in-save receipt list.
 *
 * Lock order is the shared record first, then the player save — the order
 * every one of these endpoints already used, so nothing can deadlock.
 *
 * Recovery:
 *   - A retry of a request that fully settled returns its stored result and
 *     moves nothing.
 *   - A retry of a request whose debit landed but whose credit did not (the
 *     process stopped between the writes, or the credit write failed and its
 *     compensation failed too) rolls the credit FORWARD, exactly once.
 *   - A definition may supply `refund`: when the credit write of a fresh
 *     request fails, the debit and its receipt are reversed in one save write,
 *     so the player is not left charged for something that never happened.
 *     Currency-only sinks (shrine, bounty placement) do; donations, whose
 *     debit also moves items, merit and daily counters, roll forward instead.
 *   - Admin reconciliation calls resumeSaveDebitSaga with the journal id, and
 *     it runs the same credit step.
 *
 * The one thing a receipt list cannot prove is a NEGATIVE once the list has
 * evicted entries (both lists are capped). A roll-forward therefore credits
 * only when the missing receipt is provably missing; otherwise the journal is
 * flagged `needs-reconcile` and nothing is credited twice.
 */

export const SHARED_RECEIPT_FIELD = 'settlementReceipts';
export const SHARED_RECEIPT_LIMIT = 100;

const REUSED_REQUEST_MESSAGE = 'That request id was already used for a different action.';
const INVALID_RECEIPTS_MESSAGE = 'Stored settlement receipts are invalid. Contact support.';

export type SharedSettlementReceipt = {
    transactionId: string;
    fingerprint: string;
    resource: string;
    amount: number;
    appliedAt: number;
};

/** A refusal the handler turns into `res.status(status).json({ ...details, error })`. */
export class SaveDebitRefusal extends Error {
    constructor(public readonly status: number, message: string, public readonly details: Record<string, unknown> = {}) {
        super(message);
        this.name = 'SaveDebitRefusal';
    }
}

/**
 * The credit cannot be applied or proven, and retrying will not change that.
 * The saga never credits twice to get past it; an administrator finishes it.
 */
export class SaveDebitNeedsReconcile extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SaveDebitNeedsReconcile';
    }
}

export type SaveDebitDefinition<Shared extends Record<string, unknown>, Plan> = {
    /** Journal kind and receipt namespace. Stable: stored in journals. */
    kind: string;
    load(sharedKey: string): Promise<Shared | null>;
    save(sharedKey: string, next: Shared): Promise<void>;
    /**
     * Pure: apply a recorded credit plan to the CURRENT shared record. It runs
     * again on a roll-forward, possibly long after the debit, so it must not
     * re-check anything the debit already decided. Throw
     * SaveDebitNeedsReconcile if the credit genuinely cannot land.
     */
    applyCredit(shared: Shared, plan: Plan, now: number): Shared;
    /** Optional pure compensation, applied to the CURRENT character. */
    refund?(character: PlayerCharacter, plan: Plan): PlayerCharacter;
};

export type SaveDebitDecision<Plan, Result> =
    | { ok: false; status: number; error: string; details?: Record<string, unknown> }
    | { ok: true; character: PlayerCharacter; plan: Plan; result: Result };

export type SaveDebitSagaOptions<Shared extends Record<string, unknown>, Plan, Result> = {
    definition: SaveDebitDefinition<Shared, Plan>;
    /** Already passed through safeName. */
    playerName: string;
    /** Parsed client request id, or null for a client that sends none. */
    requestId: string | null;
    /** The logical action's identity; the same id with other values is a 409. */
    identity: Record<string, unknown>;
    sharedKey: string;
    /** Journal labels. */
    resource: string;
    amount: number;
    meta?: Record<string, unknown>;
    /**
     * FRESH requests only, under both locks and before any write: authorize,
     * validate, and decide the debit and the credit plan together.
     */
    decide(ctx: {
        character: PlayerCharacter;
        record: PlayerSaveRecord;
        shared: Shared | null;
        txId: string;
    }): Promise<SaveDebitDecision<Plan, Result>> | SaveDebitDecision<Plan, Result>;
    /** Player-facing text for the refund and the pending-credit 503s. */
    messages?: { refunded?: string; pending?: string; reconcile?: string };
};

export type SaveDebitSagaOutcome<Shared, Plan, Result> = {
    txId: string;
    /** Nothing moved in this call: an earlier identical request already settled. */
    replayed: boolean;
    /** This call finished the credit of an earlier request whose debit had landed. */
    resumed: boolean;
    plan: Plan;
    result: Result;
    /** The shared record after the credit (the current one on a replay). */
    shared: Shared;
    /** The authoritative character (the current one on a replay). */
    character: PlayerCharacter;
    _saveVersion: number;
};

type DebitState<Plan, Result> = {
    replayed: boolean;
    /** The journal already says complete; its shared receipt may have aged out. */
    journalComplete: boolean;
    plan: Plan;
    result: Result;
    /** When the debit committed: the lower bound on when its credit could land. */
    debitAt: number;
    /** The character the debit produced (the Hollow Gate refund basis). */
    charged: PlayerCharacter;
};

/**
 * Deterministic for a client request id, so a retry finds the same receipts.
 * A request with no id gets a one-shot id: it still settles safely, it just
 * cannot be recognized if it is sent again. Always within
 * parseSettlementRequestId's 16-80 char [A-Za-z0-9_-] bound.
 */
export function saveDebitTransactionId(kind: string, playerName: string, requestId: string | null): string {
    return settlementTransactionId(kind, requestId ? `${playerName}:${requestId}` : `${playerName}:once:${randomUUID()}`);
}

export function saveDebitFingerprint(kind: string, playerName: string, identity: Record<string, unknown>): string {
    return settlementFingerprint({ ...identity, kind, playerName });
}

function sharedReceiptList(container: Record<string, unknown>): unknown[] | null {
    const raw = container[SHARED_RECEIPT_FIELD];
    if (raw === undefined || raw === null) return [];
    return Array.isArray(raw) ? raw : null;
}

export function inspectSharedCredit(
    container: Record<string, unknown>,
    transactionId: string,
    fingerprint: string,
): 'fresh' | 'applied' | 'conflict' | 'invalid' {
    const list = sharedReceiptList(container);
    if (!list) return 'invalid';
    const found = list.find((entry) => !!entry && typeof entry === 'object'
        && (entry as SharedSettlementReceipt).transactionId === transactionId) as SharedSettlementReceipt | undefined;
    if (!found) return 'fresh';
    return found.fingerprint === fingerprint ? 'applied' : 'conflict';
}

export function appendSharedCredit<T extends Record<string, unknown>>(container: T, receipt: SharedSettlementReceipt): T {
    const list = sharedReceiptList(container) ?? [];
    return {
        ...container,
        [SHARED_RECEIPT_FIELD]: [
            receipt,
            ...list.filter((entry) => !(entry && typeof entry === 'object'
                && (entry as SharedSettlementReceipt).transactionId === receipt.transactionId)),
        ].slice(0, SHARED_RECEIPT_LIMIT),
    };
}

/**
 * Does a MISSING receipt prove the write it records never happened?
 *
 * Both receipt lists are prepended and capped, so an evicted receipt was
 * written before every retained one. The write being looked for can only have
 * happened at or after `lowerBound` (the debit time, or the time a claim was
 * reserved). If nothing was ever evicted, or the oldest retained receipt is
 * older than `lowerBound`, every receipt written since is still in the list
 * and absence is proof. Otherwise it is unknowable, and the caller must not
 * write again.
 */
export function receiptAbsenceProvable(
    list: readonly unknown[],
    limit: number,
    timeField: 'appliedAt' | 'settledAt',
    lowerBound: number,
): boolean {
    if (list.length < limit) return true;
    let oldest = Number.POSITIVE_INFINITY;
    for (const entry of list) {
        const at = Number((entry as Record<string, unknown> | null)?.[timeField]);
        if (!Number.isFinite(at)) return false;
        if (at < oldest) oldest = at;
    }
    return oldest < lowerBound;
}

function logJournal(txId: string) {
    return (error: unknown) => console.error('[save-debit-saga] journal write failed', txId, error instanceof Error ? error.message : String(error));
}

/**
 * Write the credit. A write that throws may still have committed (a timeout
 * after the row landed); the readback tells the two apart, the way
 * writeVersionedPlayerSaveWithStore does for saves.
 */
async function writeSharedCredit<Shared extends Record<string, unknown>>(
    definition: SaveDebitDefinition<Shared, unknown>,
    sharedKey: string,
    next: Shared,
    transactionId: string,
    fingerprint: string,
): Promise<Shared> {
    try {
        await definition.save(sharedKey, next);
        return next;
    } catch (error) {
        const readback = await definition.load(sharedKey).catch(() => null);
        if (readback && inspectSharedCredit(readback, transactionId, fingerprint) === 'applied') return readback;
        throw error;
    }
}

type CreditStepInput<Shared extends Record<string, unknown>, Plan> = {
    definition: SaveDebitDefinition<Shared, Plan>;
    sharedKey: string;
    transactionId: string;
    fingerprint: string;
    resource: string;
    amount: number;
    plan: Plan;
    /** True when the debit was committed by an EARLIER request. */
    resuming: boolean;
    debitAt: number;
};

/** Apply the credit exactly once. Caller holds the shared-record lock. */
async function applyCreditOnce<Shared extends Record<string, unknown>, Plan>(
    input: CreditStepInput<Shared, Plan>,
): Promise<{ shared: Shared; applied: boolean }> {
    const shared = await input.definition.load(input.sharedKey);
    if (!shared) throw new SaveDebitNeedsReconcile('The settlement target no longer exists.');
    const state = inspectSharedCredit(shared, input.transactionId, input.fingerprint);
    if (state === 'conflict' || state === 'invalid') {
        throw new SaveDebitNeedsReconcile('The settlement target holds a conflicting or unreadable receipt.');
    }
    if (state === 'applied') return { shared, applied: false };
    if (input.resuming) {
        const list = sharedReceiptList(shared) ?? [];
        if (!receiptAbsenceProvable(list, SHARED_RECEIPT_LIMIT, 'appliedAt', input.debitAt)) {
            throw new SaveDebitNeedsReconcile('The earlier credit can no longer be proven either way.');
        }
    }
    const appliedAt = Date.now();
    const next = appendSharedCredit(input.definition.applyCredit(shared, input.plan, appliedAt), {
        transactionId: input.transactionId,
        fingerprint: input.fingerprint,
        resource: input.resource,
        amount: input.amount,
        appliedAt,
    });
    const written = await writeSharedCredit(input.definition as SaveDebitDefinition<Shared, unknown>, input.sharedKey, next, input.transactionId, input.fingerprint);
    return { shared: written, applied: true };
}

/** Reverse a fresh debit and drop its receipt, in one save write. */
async function refundDebit<Plan>(
    playerName: string,
    transactionId: string,
    fingerprint: string,
    plan: Plan,
    refund: (character: PlayerCharacter, plan: Plan) => PlayerCharacter,
    charged: PlayerCharacter,
): Promise<{ refunded: boolean; character: PlayerCharacter; _saveVersion: number }> {
    const out = await mutatePlayerSave<boolean>(playerName, ({ character }) => {
        const inspected = inspectSettlementReceipt(character, transactionId, fingerprint);
        // Already reversed (or never debited): nothing to give back.
        if (inspected.status !== 'replay') return { ok: true, character, value: false, write: false };
        return {
            ok: true,
            character: {
                ...refund(character, plan),
                [SERVER_SETTLEMENT_RECEIPTS_FIELD]: inspected.receipts.filter((receipt) => receipt.requestId !== transactionId),
            },
            value: true,
            // A refund restores spending; it is not new income. Classify it
            // against the checkpoint the charge was made under, exactly like
            // the bounty and Kage refunds this replaces (hollow-gate/_external-credits.ts).
            hollowGateCurrencySource: hollowGateRefundCurrencySource(charged, character),
        };
    });
    if (!out.ok) throw new Error(`refund failed: ${out.error}`);
    return { refunded: out.value, character: out.character, _saveVersion: out._saveVersion };
}

/**
 * Debit a player's save and credit one shared record, exactly once per
 * request id. Throws SaveDebitRefusal for every answer other than success.
 * A LockContendedError from either lock propagates (nothing moved yet when
 * the shared lock is contended; the save lock is only ever taken under it).
 */
export async function runSaveDebitSaga<Shared extends Record<string, unknown>, Plan, Result>(
    options: SaveDebitSagaOptions<Shared, Plan, Result>,
): Promise<SaveDebitSagaOutcome<Shared, Plan, Result>> {
    const { definition, playerName, sharedKey } = options;
    const kind = definition.kind;
    const transactionId = saveDebitTransactionId(kind, playerName, options.requestId);
    const fingerprint = saveDebitFingerprint(kind, playerName, options.identity);
    const saveKey = `save:${playerName}`;

    return withKvLock(sharedKey, async () => {
        const journal = await kv.get<EconomyTxRecord>(economyTxKey(transactionId));
        const journalFingerprint = typeof journal?.meta?.fingerprint === 'string' ? journal.meta.fingerprint : null;
        if (journal && journalFingerprint !== null && journalFingerprint !== fingerprint) {
            throw new SaveDebitRefusal(409, REUSED_REQUEST_MESSAGE);
        }

        // ── Debit (with its receipt, in one save write) ─────────────────────
        const held: { debit?: DebitState<Plan, Result>; refusal?: Record<string, unknown> } = {};
        const saved = await mutatePlayerSave<null>(playerName, async ({ character, record }) => {
            const inspected = inspectSettlementReceipt(character, transactionId, fingerprint);
            if (inspected.status === 'conflict') return { ok: false, status: 409, error: REUSED_REQUEST_MESSAGE };
            if (inspected.status === 'invalid') return { ok: false, status: 409, error: INVALID_RECEIPTS_MESSAGE };
            if (inspected.status === 'replay') {
                const value = inspected.receipt.value as { plan?: Plan; result?: Result };
                held.debit = {
                    replayed: true,
                    journalComplete: journal?.state === 'complete',
                    plan: value.plan as Plan,
                    result: value.result as Result,
                    debitAt: inspected.receipt.settledAt,
                    charged: character,
                };
                return { ok: true, character, value: null, write: false };
            }
            if (journal?.state === 'complete' && journalFingerprint !== null) {
                // Settled in full; the in-save receipt has since aged out of its
                // capped list. The journal is the longer-lived record of it.
                held.debit = {
                    replayed: true,
                    journalComplete: true,
                    plan: journal.meta?.plan as Plan,
                    result: journal.meta?.result as Result,
                    debitAt: journal.createdAt,
                    charged: character,
                };
                return { ok: true, character, value: null, write: false };
            }
            const shared = await definition.load(sharedKey);
            const decision = await options.decide({ character, record, shared, txId: transactionId });
            if (!decision.ok) {
                held.refusal = decision.details;
                return { ok: false, status: decision.status, error: decision.error };
            }
            const debitAt = Date.now();
            // The journal exists before the debit can commit, so a debit is
            // never invisible to /api/admin/economy.
            await markEconomyTx(transactionId, 'reserved', {
                kind,
                debitKey: saveKey,
                creditKey: sharedKey,
                resource: options.resource,
                amount: options.amount,
                meta: {
                    ...(options.meta ?? {}),
                    playerName,
                    requestId: options.requestId,
                    fingerprint,
                    plan: decision.plan,
                    result: decision.result,
                },
            });
            held.debit = { replayed: false, journalComplete: false, plan: decision.plan, result: decision.result, debitAt, charged: decision.character };
            return {
                ok: true,
                character: appendSettlementReceipt(decision.character, inspected.receipts, {
                    requestId: transactionId,
                    fingerprint,
                    value: { kind, plan: decision.plan, result: decision.result } as Record<string, unknown>,
                    settledAt: debitAt,
                }),
                value: null,
            };
        });
        if (!saved.ok) throw new SaveDebitRefusal(saved.status, saved.error, held.refusal ?? {});
        const debit = held.debit!;

        if (debit.journalComplete) {
            // Fully settled earlier. Report the current shared record.
            const shared = await definition.load(sharedKey);
            return {
                txId: transactionId,
                replayed: true,
                resumed: false,
                plan: debit.plan,
                result: debit.result,
                shared: (shared ?? {}) as Shared,
                character: saved.character,
                _saveVersion: saved._saveVersion,
            };
        }
        if (!debit.replayed) {
            debit.charged = saved.character;
            await markEconomyTx(transactionId, 'debit-applied').catch(logJournal(transactionId));
        }

        // ── Credit (with its receipt, in one shared-record write) ───────────
        let credit: { shared: Shared; applied: boolean };
        try {
            credit = await applyCreditOnce({
                definition,
                sharedKey,
                transactionId,
                fingerprint,
                resource: options.resource,
                amount: options.amount,
                plan: debit.plan,
                resuming: debit.replayed,
                debitAt: debit.debitAt,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!debit.replayed && definition.refund) {
                let refunded: Awaited<ReturnType<typeof refundDebit>> | null = null;
                try {
                    refunded = await refundDebit(playerName, transactionId, fingerprint, debit.plan, definition.refund, debit.charged);
                } catch (refundError) {
                    console.error('[save-debit-saga] refund after a failed credit also failed', transactionId, refundError instanceof Error ? refundError.message : String(refundError));
                }
                if (refunded) {
                    await markEconomyTx(transactionId, 'refunded', { error: message }).catch(logJournal(transactionId));
                    throw new SaveDebitRefusal(503, options.messages?.refunded ?? 'That could not be completed, so nothing was charged. Please try again.', {
                        retryable: true,
                        refunded: true,
                        ...(refunded.refunded ? { _saveVersion: refunded._saveVersion } : {}),
                    });
                }
            }
            await failEconomyTx(transactionId, error).catch(logJournal(transactionId));
            if (error instanceof SaveDebitNeedsReconcile) {
                throw new SaveDebitRefusal(409, options.messages?.reconcile ?? 'This needs an administrator to finish it. You will not be charged again.', {
                    reconcile: true,
                    transactionId,
                });
            }
            throw new SaveDebitRefusal(503, options.messages?.pending ?? 'Your payment went through but was not finished. Retry the same action to finish it; you will not be charged again.', {
                retryable: true,
                pending: true,
            });
        }

        await completeEconomyTx(transactionId).catch(logJournal(transactionId));
        return {
            txId: transactionId,
            replayed: debit.replayed && !credit.applied,
            resumed: debit.replayed && credit.applied,
            plan: debit.plan,
            result: debit.result,
            shared: credit.shared,
            character: saved.character,
            _saveVersion: saved._saveVersion,
        };
    }, { failClosed: true });
}

export type SaveDebitResumeResult =
    | { status: 'already-complete' | 'completed' | 'credit-already-applied'; transactionId: string; shared: Record<string, unknown> }
    | { status: 'no-debit'; transactionId: string }
    | { status: 'unprovable'; transactionId: string; reason: string };

/**
 * Finish a journalled settlement whose request will not be retried (admin
 * reconciliation). Runs the same credit step as a retry would. A debit with no
 * surviving receipt is resolved only when its absence is provable; a journal
 * written before this saga existed carries no plan and is refused.
 */
export async function resumeSaveDebitSaga(
    transactionId: string,
    definitions: Readonly<Record<string, SaveDebitDefinition<Record<string, unknown>, unknown>>>,
): Promise<SaveDebitResumeResult> {
    const journal = await kv.get<EconomyTxRecord>(economyTxKey(transactionId));
    if (!journal) throw new SaveDebitRefusal(404, 'Economy transaction not found.');
    const definition = definitions[journal.kind];
    const meta = journal.meta ?? {};
    const playerName = typeof meta.playerName === 'string' ? meta.playerName : '';
    const fingerprint = typeof meta.fingerprint === 'string' ? meta.fingerprint : '';
    if (!definition || !playerName || !fingerprint || meta.plan === undefined) {
        throw new SaveDebitRefusal(400, 'This transaction predates retry-safe settlement and cannot be resumed automatically.');
    }
    const sharedKey = journal.creditKey;
    return withKvLock(sharedKey, async (): Promise<SaveDebitResumeResult> => {
        const current = await kv.get<EconomyTxRecord>(economyTxKey(transactionId));
        if (!current) throw new SaveDebitRefusal(404, 'Economy transaction not found.');
        if (current.state === 'complete') {
            return { status: 'already-complete', transactionId, shared: (await definition.load(sharedKey)) ?? {} };
        }
        if (current.state === 'refunded') return { status: 'no-debit', transactionId };

        const read = await mutatePlayerSave<{ debitAt: number } | { absent: boolean }>(playerName, ({ character }) => {
            const inspected = inspectSettlementReceipt(character, transactionId, fingerprint);
            if (inspected.status === 'replay') return { ok: true, character, value: { debitAt: inspected.receipt.settledAt }, write: false };
            if (inspected.status !== 'fresh') return { ok: false, status: 409, error: INVALID_RECEIPTS_MESSAGE };
            const list = Array.isArray(character[SERVER_SETTLEMENT_RECEIPTS_FIELD]) ? character[SERVER_SETTLEMENT_RECEIPTS_FIELD] as unknown[] : [];
            return {
                ok: true,
                character,
                value: { absent: receiptAbsenceProvable(list, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', current.createdAt) },
                write: false,
            };
        });
        if (!read.ok) throw new SaveDebitRefusal(read.status, read.error);
        if ('absent' in read.value) {
            if (!read.value.absent) {
                return { status: 'unprovable', transactionId, reason: 'The debit receipt has aged out of the save; check the ledger by hand.' };
            }
            // The debit never committed (or was reversed): nothing moved.
            await markEconomyTx(transactionId, 'refunded', { note: 'Resolved by admin: no committed debit exists; nothing moved.' });
            return { status: 'no-debit', transactionId };
        }
        try {
            const credit = await applyCreditOnce({
                definition,
                sharedKey,
                transactionId,
                fingerprint,
                resource: current.resource,
                amount: current.amount,
                plan: meta.plan,
                resuming: true,
                debitAt: read.value.debitAt,
            });
            await completeEconomyTx(transactionId, {
                note: credit.applied ? 'Admin reconciliation applied the pending credit.' : 'Admin reconciliation found the credit already applied.',
                meta: { ...current.meta, reconciledAt: Date.now(), reconciledBy: 'admin' },
            });
            return { status: credit.applied ? 'completed' : 'credit-already-applied', transactionId, shared: credit.shared };
        } catch (error) {
            if (error instanceof SaveDebitNeedsReconcile) return { status: 'unprovable', transactionId, reason: error.message };
            throw error;
        }
    }, { failClosed: true });
}
