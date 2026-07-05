import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';

/*
 * /api/pet/battle-start - POST only
 *
 * Mints a short-lived single-use token for non-ranked Pet Coliseum rewards.
 * Casual pet combat is still client-resolved, but rewardful battle-result calls
 * must now prove a battle was intentionally started by the authenticated player
 * with the same reportKey they later redeem.
 */

const TOKEN_TTL_SECONDS = 15 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const opponentName = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        const opponentLevel = Math.max(1, Math.min(100, Math.floor(Number(body.opponentLevel ?? 1))));
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const mode = body.mode === '2v2' ? '2v2' : '1v1';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!reportKey) return res.status(400).json({ error: 'Missing or invalid reportKey.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own pet battles.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-battle-start', 30, 60_000, identity.name))) return;

        const token = randomUUID().replace(/-/g, '');
        await kv.set(`pet:battle-token:${playerName}:${token}`, {
            playerName,
            opponentName: opponentName || undefined,
            opponentLevel,
            reportKey,
            mode,
            createdAt: Date.now(),
        }, { ex: TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, token, reportKey });
    } catch (err) {
        console.error('[pet/battle-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
