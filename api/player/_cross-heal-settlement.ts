import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { mergePreservingImages } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    beginDurableSettlement,
    cancelDurableSettlement,
    completeDurableSettlement,
    settlementFingerprint,
    settlementTransactionId,
    updateDurableSettlement,
} from '../_durable-settlement.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { professionRankForXp } from '../missions/_progress.js';

export type CrossHealCore = {
    xpGained: number;
    raidAssist: boolean;
    chakraCost: number;
    targetHospitalized: boolean;
};

export type CrossHealResult = CrossHealCore & {
    professionXp: number;
    professionRank: number;
    _saveVersion: number;
};

export class CrossHealSettlementError extends Error {
    constructor(public readonly status: number, message: string, public readonly details: Record<string, unknown> = {}) {
        super(message);
        this.name = 'CrossHealSettlementError';
    }
}

export function crossHealTransaction(requestId: string, actorName: string, targetName: string) {
    return {
        transactionId: settlementTransactionId('healer-cross-heal', requestId),
        fingerprint: settlementFingerprint({ operation: 'healer-cross-heal', actorName, targetName }),
    };
}

/**
 * Receipt-backed two-save settlement. The healer debit/XP write is the source
 * side and the target restoration is the recipient side. A retry resumes from
 * whichever receipt exists, so neither a process stop nor a lost response can
 * double-charge chakra, double-award XP, or strand an already-paid heal.
 */
export async function settleCrossPlayerHeal(options: {
    requestId: string;
    actorName: string;
    targetName: string;
    core?: CrossHealCore;
}): Promise<{ result: CrossHealResult; replayed: boolean }> {
    const { transactionId, fingerprint } = crossHealTransaction(options.requestId, options.actorName, options.targetName);
    const healerKey = `save:${options.actorName}`;
    const targetKey = `save:${options.targetName}`;
    const refreshResult = async (result: CrossHealResult): Promise<CrossHealResult> => {
        const latest = await kv.get<Record<string, unknown>>(healerKey);
        const latestChar = latest?.character as Record<string, unknown> | undefined;
        return {
            ...result,
            professionXp: Number(latestChar?.professionXp ?? result.professionXp),
            professionRank: Number(latestChar?.professionRank ?? result.professionRank),
            _saveVersion: Number(latest?._saveVersion ?? result._saveVersion),
        };
    };
    const amount = Math.max(0, Math.floor(Number(options.core?.chakraCost ?? 0)));
    const input = {
        transactionId,
        idempotencyKey: options.requestId,
        operationType: 'healer-cross-heal',
        fingerprint,
        actorIds: [options.actorName, options.targetName],
        resource: 'chakra',
        amount,
        meta: { actorName: options.actorName, targetName: options.targetName },
    };
    const started = await beginDurableSettlement(input, { kv });
    if (started.status === 'conflict') throw new CrossHealSettlementError(409, 'That heal request ID is already bound to another action.');
    if (started.record.state === 'completed' && started.record.result) {
        return { result: await refreshResult(started.record.result as CrossHealResult), replayed: true };
    }

    const [firstKey, secondKey] = [healerKey, targetKey].sort();
    return withKvLock(firstKey, () => withKvLock(secondKey, async () => {
        const current = await beginDurableSettlement(input, { kv });
        if (current.status === 'conflict') throw new CrossHealSettlementError(409, 'That heal request ID is already bound to another action.');
        if (current.record.state === 'completed' && current.record.result) {
            return { result: await refreshResult(current.record.result as CrossHealResult), replayed: true };
        }

        const healerRecord = await kv.get<Record<string, unknown>>(healerKey);
        const targetRecord = await kv.get<Record<string, unknown>>(targetKey);
        const healer = healerRecord?.character as Record<string, unknown> | undefined;
        const target = targetRecord?.character as Record<string, unknown> | undefined;
        if (!healerRecord || !healer) throw new CrossHealSettlementError(404, 'Healer not found.');
        if (!targetRecord || !target) throw new CrossHealSettlementError(404, 'Target not found.');

        const healerReceipt = inspectSettlementReceipt(healer, transactionId, fingerprint);
        const targetReceipt = inspectSettlementReceipt(target, transactionId, fingerprint);
        if (healerReceipt.status === 'conflict' || healerReceipt.status === 'invalid'
            || targetReceipt.status === 'conflict' || targetReceipt.status === 'invalid') {
            await updateDurableSettlement(transactionId, {
                state: 'reconciliation-required',
                failureReason: 'Conflicting cross-heal receipt.',
            }, { kv }).catch(() => undefined);
            throw new CrossHealSettlementError(409, 'This heal has a conflicting settlement receipt.');
        }
        if (healerReceipt.status === 'fresh' && targetReceipt.status === 'replay') {
            await updateDurableSettlement(transactionId, {
                state: 'reconciliation-required',
                failureReason: 'Target heal exists without healer debit.',
            }, { kv }).catch(() => undefined);
            throw new CrossHealSettlementError(409, 'This heal requires settlement reconciliation.');
        }

        let mutationObserved = healerReceipt.status === 'replay' || targetReceipt.status === 'replay';
        try {
            let coreResult: Omit<CrossHealResult, '_saveVersion'>;
            if (healerReceipt.status === 'fresh') {
                if (!options.core) {
                    throw new CrossHealSettlementError(409, 'This heal has no recoverable source receipt.');
                }
                if (healer.profession !== 'healer') {
                    await cancelDurableSettlement(transactionId, { status: 403, error: 'Only Healers can heal other players.' }, { kv }).catch(() => undefined);
                    throw new CrossHealSettlementError(403, 'Only Healers can heal other players.');
                }
                if (healer.village !== target.village) {
                    await cancelDurableSettlement(transactionId, { status: 403, error: 'Healer and target must be in the same village.' }, { kv }).catch(() => undefined);
                    throw new CrossHealSettlementError(403, 'Healer and target must be in the same village.');
                }
                const targetStillEligible = options.core.targetHospitalized
                    ? target.hospitalized === true
                    : Number(target.hp ?? 0) < Number(target.maxHp ?? 0);
                if (!targetStillEligible) {
                    await cancelDurableSettlement(transactionId, { status: 409, error: 'Target state changed before the heal settled.' }, { kv }).catch(() => undefined);
                    throw new CrossHealSettlementError(409, 'Target state changed before the heal settled.');
                }
                const have = Number(healer.chakra ?? 0);
                if (have < options.core.chakraCost) {
                    await cancelDurableSettlement(transactionId, {
                        status: 400,
                        error: 'Not enough chakra.',
                        chakraCost: options.core.chakraCost,
                    }, { kv }).catch(() => undefined);
                    throw new CrossHealSettlementError(400, `Not enough chakra — healing costs ${options.core.chakraCost} chakra.`, {
                        chakraCost: options.core.chakraCost,
                    });
                }
                const professionXp = Number(healer.professionXp ?? 0) + options.core.xpGained;
                const professionRank = professionRankForXp('healer', professionXp);
                coreResult = { ...options.core, professionXp, professionRank };
                await updateDurableSettlement(transactionId, { state: 'reserved' }, { kv });
                const nextHealer = appendSettlementReceipt({
                    ...healer,
                    chakra: have - options.core.chakraCost,
                    professionXp,
                    professionRank,
                }, healerReceipt.receipts, {
                    requestId: transactionId,
                    fingerprint,
                    value: coreResult,
                    settledAt: Date.now(),
                });
                await kv.set(healerKey, mergePreservingImages(bumpSaveVersion({ ...healerRecord, character: nextHealer }), healerRecord));
                mutationObserved = true;
                await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv });
            } else {
                coreResult = healerReceipt.receipt.value as Omit<CrossHealResult, '_saveVersion'>;
            }

            if (targetReceipt.status === 'fresh') {
                const nextTarget = appendSettlementReceipt({
                    ...target,
                    hp: target.maxHp,
                    chakra: target.maxChakra,
                    stamina: target.maxStamina,
                    hospitalized: false,
                    hospitalizedUntil: 0,
                    hospitalizedAt: 0,
                    ...(coreResult.targetHospitalized ? { lastDischargeAt: Date.now() } : {}),
                }, targetReceipt.receipts, {
                    requestId: transactionId,
                    fingerprint,
                    value: coreResult,
                    settledAt: Date.now(),
                });
                await kv.set(targetKey, mergePreservingImages(bumpSaveVersion({ ...targetRecord, character: nextTarget }), targetRecord));
                mutationObserved = true;
                await updateDurableSettlement(transactionId, { state: 'credit-applied' }, { kv });
            }

            const finalHealer = await kv.get<Record<string, unknown>>(healerKey);
            const result: CrossHealResult = { ...coreResult, _saveVersion: Number(finalHealer?._saveVersion ?? 0) };
            await completeDurableSettlement(transactionId, result, { kv });
            return { result, replayed: healerReceipt.status === 'replay' || targetReceipt.status === 'replay' };
        } catch (error) {
            if (mutationObserved) {
                await updateDurableSettlement(transactionId, {
                    state: 'reconciliation-required',
                    failureReason: error instanceof Error ? error.message : String(error),
                }, { kv }).catch(() => undefined);
            }
            throw error;
        }
    }, { failClosed: true }), { failClosed: true });
}
