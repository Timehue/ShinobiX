import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { readSoloPveSession } from './_store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const source = req.method === 'GET' ? (req.query ?? {}) : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = safeName(String(source.playerName ?? ''));
        const sessionId = String(source.sessionId ?? '').slice(0, 128);
        if (!playerName || !sessionId) return res.status(400).json({ error: 'Missing solo-PvE session identity.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only read your own encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'solo-pve-state', 180, 60_000, identity.name))) return;

        const session = await readSoloPveSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Solo-PvE session not found.' });
        if (!identity.admin && session.ownerSlug.toLowerCase() !== identity.name.toLowerCase()) {
            return res.status(403).json({ error: 'This solo-PvE session belongs to another player.' });
        }
        if (session.expiresAt <= Date.now()) return res.status(410).json({ error: 'Solo-PvE session expired.', session });
        return res.status(200).json({ ok: true, session });
    } catch (error) {
        console.error('[solo-pve/state]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
