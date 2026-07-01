import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { onlineStore } from '../_realtime/online-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const { name } = parsed.body as { name?: string };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        // Can only clear your own pending attacker.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) {
            return res.status(403).json({ error: 'Cannot clear another player.' });
        }

        onlineStore.clearPendingAttacker(name);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[clear-attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
