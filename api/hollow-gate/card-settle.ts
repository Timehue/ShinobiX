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
import { hollowGateLossHp } from '../../shared/hollow-gate-loss.js';
import { hollowGateCombatReward } from './_combat-session.js';
import { hollowGateRunRyoScale } from './_gate-scale.js';
import { creditHollowGateLedger } from './_ledger.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';
import { hollowGateEndedRunCharacter, hollowGatePendingOperationOf, hollowGateSavedTokenMismatch, makeHollowGatePendingOperation, recoverHollowGatePendingOperation } from './_pending-operation.js';

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
            const record = await kv.get<{ character?: Record<string, unknown>; _saveVersion?: number }>(`save:${playerName}`);
            const character = record?.character;
            if (character && hollowGateSavedTokenMismatch(character, token)) {
                return { status: 409, body: { error: 'The saved rift changed before settlement.' } };
            }
            const matchReceipt = `card:${matchId}`;
            const proof = hollowGatePendingOperationOf(character, token);
            const applied = Array.isArray(character?.settledHollowGateEventIds) ? character.settledHollowGateEventIds : [];
            // A committed terminal proof survives deleting the live run and the
            // short-lived Chronicle match. Replay its result, never its effects.
            if (proof?.kind === 'event' && proof.id === matchReceipt && applied.includes(matchReceipt)) {
                return { status: 200, body: { ...proof.response, ok: true, alreadyReported: true,
                    character, _saveVersion: record?._saveVersion } };
            }
            const session = await kv.get<AiMatchSession>(cardClashAiTokenKey(matchId));
            const digest = createHash('sha256').update(token).digest('hex');
            if ((run && (run.playerName !== playerName || !run.variantId?.startsWith('rift-'))) || !session
                || session.playerName !== playerName || session.matchId !== matchId
                || session.hollowGateCard?.tokenDigest !== digest || session.settlementMode !== 'external'
                || session.status !== 'done' || !session.settledAt || !session.winner) {
                return { status: 409, body: { error: 'No completed rift card showdown matches this run.' } };
            }
            if (character && (Number(character.hp) <= 0 || (character.hollowGateRun === null && applied.includes(matchReceipt)))) {
                const ended = await mutatePlayerSave(playerName, ({ character: current }) => {
                    const projection = hollowGateEndedRunCharacter(current, token);
                    if (!projection) {
                        return { ok: false as const, status: 409, error: 'The saved rift changed before settlement.' };
                    }
                    const receipts = Array.isArray(current.settledHollowGateEventIds) ? current.settledHollowGateEventIds : [];
                    const response = { ok: true, won: session.winner === 'player', ended: true, reward: { ryo: 0, auraDust: 0 } };
                    return { ok: true as const, character: { ...projection,
                        settledHollowGateEventIds: [...receipts.filter(id => id !== matchReceipt).slice(-511), matchReceipt],
                        hollowGatePendingOperation: makeHollowGatePendingOperation({ token, kind: 'event', id: matchReceipt,
                            before: run, after: null, response }),
                    }, value: response };
                });
                if (!ended.ok) return { status: ended.status, body: { error: ended.error } };
                await recoverHollowGatePendingOperation(kv, runKey, run, playerName, token);
                return { status: 200, body: { ...ended.value, character: ended.character, _saveVersion: ended._saveVersion } };
            }
            if (!run) return { status: 409, body: { error: 'No completed rift card showdown matches this run.' } };
            const nodeId = session.hollowGateCard.nodeId;
            const floor = Number(nodeId.match(/^floor:(\d+):/)?.[1]);
            const encounterKey = `${floor}:card:${nodeId}`;
            const resolved = run.resolvedEncounterIds ?? [];
            const alreadyResolved = resolved.includes(encounterKey);
            if (!alreadyResolved
                && (run.cardAmbushMatchId !== matchId || run.pendingAmbush?.kind !== 'card'
                    || run.pendingAmbush.nodeId !== nodeId || run.currentFloor !== floor)) {
                return { status: 409, body: { error: 'The card result does not match the pending rift ambush.' } };
            }
            const won = session.winner === 'player';
            // A Rift meets at most one card ambush (step.ts), so only the ryo
            // scale applies here, not the per-run ambush cap.
            const baseReward = hollowGateCombatReward(floor, 'ambush', undefined, { ryoScale: hollowGateRunRyoScale(run) });
            const multiplier = rewardMultiplierForToken(run);
            const reward = won ? {
                ryo: Math.floor(baseReward.ryo * multiplier),
                auraDust: Math.floor(baseReward.auraDust * multiplier),
            } : { ryo: 0, auraDust: 0 };
            const credited = won
                ? creditHollowGateLedger(run, `card:${encounterKey}`, { currencies: reward })
                : null;
            const nextRun: HollowGateRunToken = alreadyResolved ? run : {
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
            // The win is credited to the run ledger above, so it is run loot
            // and the save write says so ('run'), like every other run-reward
            // writer (combat-settle, event, use-consumable, settle). The default
            // recorded it as an 'external' credit in the protected baseline,
            // which the death clawback never reaches.
            const saved = await mutatePlayerSave(playerName, ({ character }) => {
                const savedRun = character.hollowGateRun as Record<string, unknown> | undefined;
                if (savedRun?.runToken !== token || hollowGateSavedTokenMismatch(character, token)) {
                    return { ok: false as const, status: 409, error: 'The saved rift changed before settlement.' };
                }
                // Use the existing protected Hollow Gate event receipt journal;
                // generic saves cannot erase or forge an applied HP penalty.
                //
                // One settlement per ambush ENCOUNTER. A Chronicle rules bump
                // makes card-start mint a fresh match for the same encounter and
                // leave the old one, possibly already won, behind. A receipt
                // keyed only on the match let that old match settle the same
                // ambush a second time. The match receipt is still written and
                // honored, so a lost response replays idempotently and saves
                // settled before this change keep resolving; the run's resolved
                // list covers encounters that only carry a legacy match receipt.
                const encounterReceipt = `card:${digest}:${encounterKey}`;
                const receipts = Array.isArray(character.settledHollowGateEventIds) ? character.settledHollowGateEventIds as string[] : [];
                const alreadyPaid = receipts.includes(matchReceipt);
                if (alreadyPaid && alreadyResolved) return { ok: true as const, character, value: { alreadyReported: true }, write: false };
                if (!alreadyPaid && (alreadyResolved || receipts.includes(encounterReceipt))) {
                    return { ok: false as const, status: 409, error: 'This rift card ambush was already settled.' };
                }
                // Legacy unscoped encounter receipts belong to an unknown dive;
                // only this run's resolved list or a scoped receipt can block it.
                // An exact paid match with a stale run needs projection repair,
                // not another HP charge or wallet credit.
                return { ok: true as const, character: {
                    ...character,
                    ...(!alreadyPaid && !won ? { hp: hollowGateLossHp(character.hp, character.maxHp) } : {}),
                    ...(!alreadyPaid && won ? {
                        ryo: Math.max(0, Math.floor(Number(character.ryo) || 0)) + reward.ryo,
                        auraDust: Math.max(0, Math.floor(Number(character.auraDust) || 0)) + reward.auraDust,
                    } : {}),
                    hollowGateRun: { ...savedRun, threat: 0 },
                    settledHollowGateEventIds: [...receipts.slice(-510), encounterReceipt, matchReceipt],
                    hollowGatePendingOperation: makeHollowGatePendingOperation({
                        token, kind: 'event', id: matchReceipt, before: run, after: nextRun,
                        response: { ok: true, won, reward },
                    }),
                }, value: { alreadyReported: alreadyPaid } };
            }, { hollowGateCurrencySource: 'run' });
            if (!saved.ok) return { status: saved.status, body: { error: saved.error } };
            if (!alreadyResolved) await recoverHollowGatePendingOperation(kv, runKey, run, playerName, token);
            return { status: 200, body: { ok: true, won, reward, alreadyReported: saved.value.alreadyReported,
                character: saved.character, _saveVersion: saved._saveVersion } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/card-settle]', error);
        return res.status(500).json({ error: 'The rift card result could not be settled.' });
    }
}
