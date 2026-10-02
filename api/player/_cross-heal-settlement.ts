import { kv } from '../_storage.js';
import { hospitalDischargeRestoresHpOnly } from '../_release-flags.js';
import { mutatePlayerSaves, PlayerSavesPartialCommitError, type PlayerSavesSide } from '../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../save/_projected-write.js';
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

    type Settled =
        | { replay: CrossHealResult }
        | { core: Omit<CrossHealResult, '_saveVersion'>; replayed: boolean };
    // Both saves are locked (one sorted order, fail-closed) and must exist
    // before either is written. The healer write commits first; each side's
    // receipt rides in its own write, so a retry resumes from whichever exists.
    let mutationObserved = false;
    let settled: Awaited<ReturnType<typeof mutatePlayerSaves<Settled>>>;
    try {
        settled = await retryOnSaveVersionConflict(() => mutatePlayerSaves<Settled>([options.actorName, options.targetName], async (sides) => {
            mutationObserved = false;
            const current = await beginDurableSettlement(input, { kv });
            if (current.status === 'conflict') throw new CrossHealSettlementError(409, 'That heal request ID is already bound to another action.');
            const healer = sides[options.actorName]!.character;
            const target = sides[options.targetName]!.character;
            const untouched = {
                [options.actorName]: { write: false, character: healer },
                [options.targetName]: { write: false, character: target },
            };
            if (current.record.state === 'completed' && current.record.result) {
                return { ok: true, value: { replay: current.record.result as CrossHealResult }, sides: untouched };
            }

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

            mutationObserved = healerReceipt.status === 'replay' || targetReceipt.status === 'replay';
            let coreResult: Omit<CrossHealResult, '_saveVersion'>;
            let healerSide: PlayerSavesSide = untouched[options.actorName]!;
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
                healerSide = {
                    character: appendSettlementReceipt({
                        ...healer,
                        chakra: have - options.core.chakraCost,
                        professionXp,
                        professionRank,
                    }, healerReceipt.receipts, {
                        requestId: transactionId,
                        fingerprint,
                        value: coreResult,
                        settledAt: Date.now(),
                    }),
                    afterCommit: async () => {
                        mutationObserved = true;
                        await updateDurableSettlement(transactionId, { state: 'debit-applied' }, { kv });
                    },
                };
            } else {
                coreResult = healerReceipt.receipt.value as Omit<CrossHealResult, '_saveVersion'>;
            }

            let targetSide: PlayerSavesSide = untouched[options.targetName]!;
            if (targetReceipt.status === 'fresh') {
                // A Healer mends INJURY, on someone else exactly as on themselves.
                // Restoring chakra and stamina here too would just move the free
                // full-refill loop one player sideways — "find a Healer" instead
                // of "die". (MMORPG behavior audit F1.)
                const restoresHpOnly = hospitalDischargeRestoresHpOnly();
                targetSide = {
                    character: appendSettlementReceipt({
                        ...target,
                        hp: target.maxHp,
                        ...(restoresHpOnly ? {} : {
                            chakra: target.maxChakra,
                            stamina: target.maxStamina,
                        }),
                        hospitalized: false,
                        hospitalizedUntil: 0,
                        hospitalizedAt: 0,
                        ...(coreResult.targetHospitalized ? { lastDischargeAt: Date.now() } : {}),
                    }, targetReceipt.receipts, {
                        requestId: transactionId,
                        fingerprint,
                        value: coreResult,
                        settledAt: Date.now(),
                    }),
                    afterCommit: async () => {
                        mutationObserved = true;
                        await updateDurableSettlement(transactionId, { state: 'credit-applied' }, { kv });
                    },
                };
            }

            return {
                ok: true,
                value: { core: coreResult, replayed: healerReceipt.status === 'replay' || targetReceipt.status === 'replay' },
                sides: { [options.actorName]: healerSide, [options.targetName]: targetSide },
                // Complete under both locks, with the healer's exact committed version.
                afterCommit: async (saves) => {
                    await completeDurableSettlement(transactionId, {
                        ...coreResult,
                        _saveVersion: saves[options.actorName]!._saveVersion,
                    } satisfies CrossHealResult, { kv });
                },
            };
        }));
    } catch (error) {
        if (mutationObserved || error instanceof PlayerSavesPartialCommitError) {
            await updateDurableSettlement(transactionId, {
                state: 'reconciliation-required',
                failureReason: error instanceof Error ? error.message : String(error),
            }, { kv }).catch(() => undefined);
        }
        throw error;
    }
    if (!settled.ok) {
        throw new CrossHealSettlementError(404, settled.playerName === options.targetName ? 'Target not found.' : 'Healer not found.');
    }
    if ('replay' in settled.value) return { result: await refreshResult(settled.value.replay), replayed: true };
    return {
        result: { ...settled.value.core, _saveVersion: settled.saves[options.actorName]!._saveVersion },
        replayed: settled.value.replayed,
    };
}
