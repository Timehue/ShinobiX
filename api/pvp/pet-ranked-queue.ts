import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

export const PET_RANKED_LIVE_QUEUE_RETIRED_MESSAGE =
    'Live Pet Ranked matchmaking is unavailable until one authoritative combat and rating lifecycle is selected.';

/**
 * Retired admission boundary for the former public live Pet Ranked queue.
 *
 * The queue paired players and then launched the ordinary memory-only cinematic
 * duel, which has no ranked proof or rating settlement. Keep the mounted route
 * fail-closed so stale clients receive an explicit answer, while already-minted
 * legacy ranked tokens may still settle through their compatibility endpoint.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        return res.status(410).json({
            available: false,
            inQueue: false,
            queueSize: 0,
            match: null,
            error: PET_RANKED_LIVE_QUEUE_RETIRED_MESSAGE,
        });
    }

    if (req.method === 'POST') {
        let body: Record<string, unknown>;
        try {
            body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
        } catch {
            return res.status(400).json({ error: 'Invalid request body.' });
        }
        const name = typeof body?.name === 'string' ? body.name : '';
        const action = body?.action;
        if (!name || !['join', 'leave', 'poll'].includes(String(action))) {
            return res.status(400).json({ error: 'Missing name or valid action.' });
        }

        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) {
            return res.status(403).json({ error: 'Cannot queue as another player.' });
        }

        return res.status(410).json({
            available: false,
            inQueue: false,
            queueSize: 0,
            match: null,
            error: PET_RANKED_LIVE_QUEUE_RETIRED_MESSAGE,
        });
    }

    return res.status(405).end();
}
