import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import {
    AI_FIGHT_TOKEN_TTL_SECONDS,
    aiFightTokenKey,
    createAiFightTokenRecord,
} from './_ai-fight-token.js';

/*
 * /api/missions/ai-fight-start - POST only
 *
 * Mints a single-use token for one AI-fight reward report. The report endpoint
 * consumes this token and only accepts XP/ryo claims within the sealed ceilings,
 * so a direct client report can no longer mint arbitrary rewards.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own AI fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'ai-fight-start', 30, 60_000, identity.name))) return;

        const token = randomUUID().replace(/-/g, '');
        const record = createAiFightTokenRecord(playerName, token, Date.now(), {
            opponentId: body.opponentId,
            opponentLevel: body.opponentLevel,
        });
        await kv.set(aiFightTokenKey(playerName, token), record, { ex: AI_FIGHT_TOKEN_TTL_SECONDS });

        return res.status(200).json({
            ok: true,
            token,
            expiresInSeconds: AI_FIGHT_TOKEN_TTL_SECONDS,
            maxXp: record.maxXp,
            maxRyo: record.maxRyo,
        });
    } catch (err) {
        console.error('[missions/ai-fight-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
