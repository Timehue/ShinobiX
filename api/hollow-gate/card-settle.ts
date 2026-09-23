import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { type AiMatchSession } from '../card-clash/_ai-engine.js';
import { cardClashAiTokenKey } from '../card-clash/_ai-reward.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { creditHollowGateLedger } from './_ledger.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';
import { hollowGateSavedTokenMismatch, makeHollowGatePendingOperation, recoverHollowGatePendingOperation } from './_pending-operation.js';

/** Redeem only the terminal server-owned Chronicle match bound to this run. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const matchId = String(body.matchId ?? '').slice(0, 80);
        if (!playerName || !token || !/^[0-9a-fA-F-]{36}$/.test(matchId)) {
            return res.status(400).json({ error: 'Invalid rift card result.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-card-settle', 30, 60_000, identity.name))) return;
        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await recoverHollowGatePendingOperation(kv, runKey, await kv.get<HollowGateRunToken>(runKey), playerName, token);
            const session = await kv.get<AiMatchSession>(cardClashAiTokenKey(matchId));
            const digest = createHash('sha256').update(token).digest('hex');
            if (!run || run.playerName !== playerName || !run.variantId?.startsWith('rift-') || !session
                || session.playerName !== playerName || session.matchId !== matchId
                || session.hollowGateCard?.tokenDigest !== digest || session.settlementMode !== 'external'
                || session.status !== 'done' || !session.settledAt || !session.winner) {
                return { status: 409, body: { error: 'No completed rift card showdown matches this run.' } };
            }
            const nodeId = session.hollowGateCard.nodeId;
            const floor = Number(nodeId.match(/^floor:(\d+):/)?.[1]);
            const encounterKey = `${floor}:card:${nodeId}`;
            const resolved = run.resolvedEncounterIds ?? [];
            if (!resolved.includes(encounterKey)
                && (run.cardAmbushMatchId !== matchId || run.pendingAmbush?.kind !== 'card'
                    || run.pendingAmbush.nodeId !== nodeId || run.currentFloor !== floor)) {
                return { status: 409, body: { error: 'The card result does not match the pending rift ambush.' } };
            }
            const won = session.winner === 'player';
            const baseReward = hollowGateCombatReward(floor, 'ambush');
            const multiplier = rewardMultiplierForToken(run);
            const reward = won ? {
                ryo: Math.floor(baseReward.ryo * multiplier),
                auraDust: Math.floor(baseReward.auraDust * multiplier),
            } : { ryo: 0, auraDust: 0 };
            const credited = won
                ? creditHollowGateLedger(run, `card:${encounterKey}`, { currencies: reward })
                : null;
            const nextRun: HollowGateRunToken = resolved.includes(encounterKey) ? run : {
                ...run,
                pendingAmbush: null,
                cardAmbushMatchId: null,
                threat: 0,
                resolvedEncounterIds: [...resolved.slice(-127), encounterKey],
                ...(credited ? {
                    rewardLedger: credited.ledger,
                    serverCreditedCurrencies: credited.ledger.currencies,
                } : {}),
            };
            const saved = await mutatePlayerSave(playerName, ({ character }) => {
                const savedRun = character.hollowGateRun as Record<string, unknown> | undefined;
                if (savedRun?.runToken !== token || hollowGateSavedTokenMismatch(character, token)) {
                    return { ok: false as const, status: 409, error: 'The saved rift changed before settlement.' };
                }
                // Use the existing protected Hollow Gate event receipt journal;
                // generic saves cannot erase or forge an applied HP penalty.
                const receiptId = `card:${matchId}`;
                const receipts = Array.isArray(character.settledHollowGateEventIds) ? character.settledHollowGateEventIds as string[] : [];
                if (receipts.includes(receiptId)) return { ok: true as const, character, value: null, write: false };
                const maxHp = Math.max(1, Math.floor(Number(character.maxHp) || 1));
                const hp = Math.max(1, Math.floor(Number(character.hp) || maxHp));
                return { ok: true as const, character: {
                    ...character,
                    ...(!won ? { hp: Math.max(1, hp - Math.ceil(maxHp * 0.2)) } : {}),
                    ...(won ? {
                        ryo: Math.max(0, Math.floor(Number(character.ryo) || 0)) + reward.ryo,
                        auraDust: Math.max(0, Math.floor(Number(character.auraDust) || 0)) + reward.auraDust,
                    } : {}),
                    hollowGateRun: { ...savedRun, threat: 0 },
                    settledHollowGateEventIds: [...receipts.slice(-511), receiptId],
                    hollowGatePendingOperation: makeHollowGatePendingOperation({
                        token, kind: 'event', id: receiptId, before: run, after: nextRun,
                        response: { ok: true, won, reward },
                    }),
                }, value: null };
            });
            if (!saved.ok) return { status: saved.status, body: { error: saved.error } };
            if (!resolved.includes(encounterKey)) await recoverHollowGatePendingOperation(kv, runKey, run, playerName, token);
            return { status: 200, body: { ok: true, won, reward, character: saved.character, _saveVersion: saved._saveVersion } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/card-settle]', error);
        return res.status(500).json({ error: 'The rift card result could not be settled.' });
    }
}
