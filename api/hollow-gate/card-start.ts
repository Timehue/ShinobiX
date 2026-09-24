import { createHash, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { resolveChronicleDeckWithSave } from '../card-clash/_deck.js';
import { chronicleUnlocked } from '../card-clash/_starter-cards.js';
import { createAiMatch, type AiMatchSession } from '../card-clash/_ai-engine.js';
import {
    CHRONICLE_FIXED_FALLBACK_DECK,
    CHRONICLE_RULES_VERSION,
    countChronicleCards,
    validateDeckIds,
} from '../../shared/chronicle-duel.js';
import { CARD_CLASH_AI_TOKEN_TTL_SECONDS, cardClashAiTokenKey } from '../card-clash/_ai-reward.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { hollowGateSavedTokenMismatch, recoverHollowGatePendingOperation } from './_pending-operation.js';

const cardIds = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];

/**
 * The deck a rift card ambush is fought with.
 *
 * A rift is entered at its quest level (12 for the first one), well before the
 * Chronicle Scribe opens the Card Hall at 17, so the ambush cannot demand a deck
 * the player had no way to build.
 * - Chronicle opened, or an admin: the player's own deck, resolved exactly as
 *   every other Chronicle start resolves it.
 * - Chronicle still sealed: the player's own saved deck when it is legal against
 *   the cards they actually own. It is only read; nothing is written.
 * - Anyone else, or a resolution that fails: the server's fixed starter deck,
 *   LENT for this one match, like the wild-binding Guild Fox. It never enters
 *   the save, so no card is granted early and the Scribe's codex keeps its reveal.
 */
export async function riftAmbushDeck(
    playerName: string,
    character: Record<string, unknown>,
    admin: boolean,
): Promise<{ deck: string[]; loaner: boolean }> {
    if (admin || chronicleUnlocked(character)) {
        const resolved = await resolveChronicleDeckWithSave(playerName, [], admin);
        if (resolved) return { deck: resolved.deck, loaner: false };
    } else {
        const saved = cardIds(character.cardClashDeck);
        if (validateDeckIds(saved, countChronicleCards(cardIds(character.tileCards))).valid) {
            return { deck: saved, loaner: false };
        }
    }
    return { deck: [...CHRONICLE_FIXED_FALLBACK_DECK], loaner: true };
}

/** Bind one Chronicle AI match to the pending rift ambush. Repeated starts resume it. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const nodeId = String(body.nodeId ?? '').slice(0, 96);
        if (!playerName || !token || !/^floor:\d{1,2}:ambush:threat-v\d{1,10}$/.test(nodeId)) {
            return res.status(400).json({ error: 'Invalid rift card ambush.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-card-start', 20, 60_000, identity.name))) return;
        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await recoverHollowGatePendingOperation(kv, runKey, await kv.get<HollowGateRunToken>(runKey), playerName, token);
            if (!run || run.playerName !== playerName || !run.variantId?.startsWith('rift-')
                || run.pendingAmbush?.kind !== 'card' || run.pendingAmbush.nodeId !== nodeId || run.activeEncounter) {
                return { status: 409, body: { error: 'This rift card ambush is no longer sealed.' } };
            }
            const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
            const savedRun = save?.character?.hollowGateRun as Record<string, unknown> | undefined;
            if (!save?.character || savedRun?.runToken !== token || hollowGateSavedTokenMismatch(save.character, token)) {
                return { status: 409, body: { error: 'The saved rift does not match this run.' } };
            }
            const digest = createHash('sha256').update(token).digest('hex');
            const previousId = run.cardAmbushMatchId;
            const previous = previousId ? await kv.get<AiMatchSession>(cardClashAiTokenKey(previousId)) : null;
            if (previous && previous.playerName === playerName && previous.matchId === previousId
                && previous.settlementMode === 'external' && previous.hollowGateCard?.tokenDigest === digest
                && previous.hollowGateCard.nodeId === nodeId
                && previous.rulesVersion === CHRONICLE_RULES_VERSION
                && previous.state?.rulesVersion === CHRONICLE_RULES_VERSION) {
                return { status: 200, body: {
                    ok: true, matchId: previousId, resumed: true,
                    ...(previous.hollowGateCard.loanerDeck ? { loanerDeck: true } : {}),
                } };
            }
            const deck = await riftAmbushDeck(playerName, save.character, identity.admin);
            const matchId = randomUUID();
            const difficulty = Math.max(1, Number(run.currentFloor) || 1) >= 3 ? 'medium' : 'easy';
            const session = createAiMatch(matchId, playerName, deck.deck, difficulty, Date.now(), Math.random, 'external');
            session.hollowGateCard = { tokenDigest: digest, nodeId, ...(deck.loaner ? { loanerDeck: true } : {}) };
            await kv.set(cardClashAiTokenKey(matchId), session, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
            await kv.set(runKey, { ...run, cardAmbushMatchId: matchId });
            return { status: 200, body: { ok: true, matchId, ...(deck.loaner ? { loanerDeck: true } : {}) } };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/card-start]', error);
        return res.status(500).json({ error: 'The rift card ambush could not start.' });
    }
}
