import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name } = body as { name?: string };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) {
            return res.status(403).json({ error: 'Cannot dequeue another player.' });
        }

        await kv.del(`guard:${safeName(name)}`);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[village-guard/dequeue]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
