import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { blockedPlayersFor, blockListKey, updateBlockList } from './_blocks.js';

/** Player-owned, reversible ignore list used by mail and social feeds. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) return res.status(403).json({ error: 'A player account is required.' });
    const me = identity.name;

    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ blocked: await blockedPlayersFor(me) });
    }

    if (req.method !== 'POST') return res.status(405).end();
    if (!(await enforceRateLimitKv(req, res, 'player-blocks', 20, 60_000, me))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const target = safeName(String(body.target ?? ''));
        const blocked = body.blocked === true;
        if (!target) return res.status(400).json({ error: 'Invalid player name.' });
        if (target === me) return res.status(400).json({ error: 'You cannot block yourself.' });
        if (blocked && !await kv.get<Record<string, unknown>>(`save:${target}`)) {
            return res.status(404).json({ error: 'No such player.' });
        }

        const key = blockListKey(me);
        const next = await withKvLock(key, async () => {
            const list = updateBlockList(await kv.get<unknown>(key), target, blocked);
            await kv.set(key, list);
            return list;
        }, { failClosed: true });
        return res.status(200).json({ ok: true, blocked: next });
    } catch (err) {
        console.error('[player/blocks]', err);
        return res.status(500).json({ error: 'Could not update the block list.' });
    }
}
