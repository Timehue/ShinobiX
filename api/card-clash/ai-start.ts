import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import {
    CARD_CLASH_AI_TOKEN_TTL_SECONDS,
    cardClashAiTokenKey,
    type CardClashAiToken,
} from './_ai-reward.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only start your own AI card match.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'card-clash-ai-start', 30, 60_000, identity.name))) return;

        const matchId = randomUUID();
        const token: CardClashAiToken = { matchId, playerName, createdAt: Date.now() };
        await kv.set(cardClashAiTokenKey(matchId), token, { ex: CARD_CLASH_AI_TOKEN_TTL_SECONDS });
        return res.status(200).json({ ok: true, matchId, createdAt: token.createdAt });
    } catch (err) {
        console.error('[card-clash/ai-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
