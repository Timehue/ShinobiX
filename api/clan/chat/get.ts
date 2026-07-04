import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { clanChatKey, messagesSince, type ClanChatMessage } from './_storage.js';

/*
 * /api/clan/chat/get — GET only. Returns clan chat messages newer than `since`
 * (a client-held cursor) so idle polls transfer an empty list. Gated at clan
 * MEMBERSHIP: the caller (or admin) must belong to `clan`. Text-only, capped
 * buffer — cheap to poll while the Chat tab is open.
 *
 * Query: playerName, clan, since (ms, optional).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        const clan = String(req.query.clan ?? '').trim();
        const since = Math.max(0, Math.floor(Number(req.query.since ?? 0)) || 0);
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const slug = clanBareSlug(clan);
        if (!slug) return res.status(400).json({ error: 'Invalid clan name.' });

        // Membership: caller's character must belong to this clan (admin exempt).
        if (!identity.admin) {
            const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const char = (save?.character ?? null) as Record<string, unknown> | null;
            if (!char || clanBareSlug(String(char.clan ?? '')) !== slug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
        }

        const buf = (await kv.get<ClanChatMessage[]>(clanChatKey(slug))) ?? [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ messages: messagesSince(buf, since) });
    } catch (err) {
        console.error('[clan/chat/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
