import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { DEFAULT_RANKED_RATING } from '../_ranked-rating.js';

/*
 * /api/pet/ranked-start — POST only
 *
 * Mints a single-use pet-ranked MATCH TOKEN (audit #9). The token seals BOTH
 * fighters' pre-match petRankedRating (read from their saves, authoritative) at
 * the moment the ranked pet battle begins. pet/battle-result REQUIRES this
 * token for a ranked credit and settles BOTH accounts from the sealed ratings
 * exactly once — so the pet ranked ladder can no longer be moved by a client
 * that just asserts `ranked: true` with an arbitrary opponent / rating.
 *
 * Client wiring: the accept/resolve half (pet/battle-result ranked branch) is
 * complete; the SEND half is a "Ranked Pet Duel" button in the Arena player list,
 * gated behind the `petRankedChallenge.v1` flag (default OFF) until the direct-
 * challenge mode is two-client tested. POST { opponentName } → { matchToken }.
 *
 * Body: { opponentName }
 */

const TOKEN_TTL_SECONDS = 15 * 60; // a full pet battle + report fits comfortably

function petRatingOf(save: Record<string, unknown> | null): number {
    const c = (save?.character ?? null) as Record<string, unknown> | null;
    const r = Number(c?.petRankedRating);
    return Number.isFinite(r) ? r : DEFAULT_RANKED_RATING;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) {
        // Admin has no single player identity to seal a ranked match for.
        return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    }

    const rlName = identity.name;
    if (!(await enforceRateLimitKv(req, res, 'pet-ranked-start', 12, 60_000, rlName))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const me = identity.name;
        const opponent = safeName(typeof body.opponentName === 'string' ? body.opponentName : '');
        if (!opponent) return res.status(400).json({ error: 'Missing opponentName.' });
        if (opponent === me) return res.status(400).json({ error: 'You cannot start a ranked match against yourself.' });

        // Both fighters must have a save (no AI/roster ranked credit).
        const [meSave, oppSave] = await Promise.all([
            kv.get<Record<string, unknown>>(`save:${me}`),
            kv.get<Record<string, unknown>>(`save:${opponent}`),
        ]);
        if (!meSave?.character) return res.status(400).json({ error: 'Your character save was not found.' });
        if (!oppSave?.character) return res.status(404).json({ error: 'Opponent save not found.' });

        const token = randomUUID();
        await kv.set(`pet:ranked-token:${token}`, {
            a: me,
            b: opponent,
            aRating: petRatingOf(meSave),
            bRating: petRatingOf(oppSave),
            createdAt: Date.now(),
        }, { ex: TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, matchToken: token, opponentName: opponent });
    } catch (err) {
        console.error('[pet/ranked-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
