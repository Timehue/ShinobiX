import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { readSession } from './_tower-store.js';

/*
 * GET /api/towers/state?runId=...&playerName=... — reconnect / poll the live session.
 *
 * Unlike the PvP spectator stream, tower state is gated to RUN MEMBERS (it carries live
 * co-op state) — a non-member / unauth caller gets 403. Never cached.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const runId = String(req.query.runId ?? '');
        const playerName = safeName(String(req.query.playerName ?? ''));
        if (!runId || !playerName) return res.status(400).json({ error: 'Missing run or player.' });
        if (!enforceRateLimit(req, res, 'towers-state', 240, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const session = await readSession(runId);
        if (!session) return res.status(404).json({ error: 'Run not found.' });

        const callerSlug = identity.admin ? null : identity.name;
        const isMember = identity.admin || session.actors.some(a => a.side === 'squad' && a.ownerSlug === callerSlug);
        if (!isMember) return res.status(403).json({ error: 'Not a member of this run.' });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ session });
    } catch (err) {
        console.error('[towers/state]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
