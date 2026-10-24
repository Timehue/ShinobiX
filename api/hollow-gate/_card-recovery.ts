import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import type { AiMatchSession } from '../card-clash/_ai-engine.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { hollowGateRunRyoScale } from './_gate-scale.js';
import { creditHollowGateLedger } from './_ledger.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';
import { hollowGateEndedRunCharacter, hollowGateSavedTokenMismatch, makeHollowGatePendingOperation, recoverHollowGatePendingOperation } from './_pending-operation.js';

/** Caller holds the run lock. An exact paid match may be repaired after its AI session expires. */
export async function recoverPaidHollowGateCard(params: {
    playerName: string; token: string; run: HollowGateRunToken; matchId: string;
    character: Record<string, unknown>; session: AiMatchSession | null;
}) {
    const { playerName, token, run, matchId, session } = params;
    const matchReceipt = `card:${matchId}`;
    if (!Array.isArray(params.character.settledHollowGateEventIds)
        || !params.character.settledHollowGateEventIds.includes(matchReceipt)) return null;
    const nodeId = run.pendingAmbush?.kind === 'card' ? run.pendingAmbush.nodeId : '';
    if (!nodeId || run.cardAmbushMatchId !== matchId) return null;
    const digest = createHash('sha256').update(token).digest('hex');
    const known = session?.playerName === playerName && session.matchId === matchId && session.status === 'done'
        && session.settlementMode === 'external' && Boolean(session.settledAt)
        && session.hollowGateCard?.tokenDigest === digest && session.hollowGateCard.nodeId === nodeId;
    const won = Boolean(known && session?.winner === 'player');
    const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
    const key = `${floor}:card:${nodeId}`;
    // The same sealed entry-level scale card-settle.ts paid with, so the rebuilt
    // ledger (the death-retention basis) matches the wallet.
    const base = hollowGateCombatReward(floor, 'ambush', undefined, { ryoScale: hollowGateRunRyoScale(run) });
    const reward = won ? { ryo: Math.floor(base.ryo * rewardMultiplierForToken(run)), auraDust: Math.floor(base.auraDust * rewardMultiplierForToken(run)) }
        : { ryo: 0, auraDust: 0 };
    const ledger = won ? creditHollowGateLedger(run, `card:${key}`, { currencies: reward }).ledger : run.rewardLedger;
    const after: HollowGateRunToken = { ...run, pendingAmbush: null, cardAmbushMatchId: null, threat: 0,
        resolvedEncounterIds: [...(run.resolvedEncounterIds ?? []).filter(id => id !== key).slice(-127), key],
        ...(ledger ? { rewardLedger: ledger, serverCreditedCurrencies: ledger.currencies } : {}),
    };
    const saved = await mutatePlayerSave(playerName, ({ character }) => {
        const receipts = Array.isArray(character.settledHollowGateEventIds) ? character.settledHollowGateEventIds as string[] : [];
        const marker = character.lastHollowGateStart as { token?: string } | undefined;
        if (hollowGateSavedTokenMismatch(character, token) || (marker?.token && marker.token !== token) || !receipts.includes(matchReceipt)) {
            return { ok: false as const, status: 409, error: 'The saved rift changed before recovery.' };
        }
        const ended = hollowGateEndedRunCharacter(character, token);
        const projection = character.hollowGateRun as Record<string, unknown> | undefined;
        if (!ended && projection?.runToken !== token) return { ok: false as const, status: 409, error: 'The saved rift changed before recovery.' };
        const response = { ok: true, resolved: true, alreadyReported: true, won, reward,
            ...(ended ? { ended: true } : {}), ...(!known ? { outcomeUnknown: true } : {}) };
        return { ok: true as const, character: { ...(ended ?? character),
            ...(!ended ? { hollowGateRun: { ...projection, threat: 0 } } : {}),
            hollowGatePendingOperation: makeHollowGatePendingOperation({ token, kind: 'event', id: matchReceipt,
                before: run, after: ended ? null : after, response }),
        }, value: response };
    });
    if (!saved.ok) return { status: saved.status, body: { error: saved.error } };
    await recoverHollowGatePendingOperation(kv, hollowGateRunKey(playerName, token), run, playerName, token);
    return { status: 200, body: { ...saved.value, character: saved.character, _saveVersion: saved._saveVersion } };
}
