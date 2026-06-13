import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { safeName, cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { cancelEscort } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only cancel your own offer.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-escort-cancel', 15, 60_000, identity.name))) return;

        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (!char) return res.status(404).json({ error: 'Character not found.' });
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(400).json({ error: 'No clan to cancel from.' });

        await cancelEscort(clanName, playerName);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[clan/pet-escort/cancel]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
