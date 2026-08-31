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

        // Two callers may clear a pending attacker, and nobody else:
        //   • the TARGET, clearing their own flag (the original rule); and
        //   • the ATTACKER who stamped it, releasing a claim whose fight never
        //     started — /api/player/attack succeeded but the session was then
        //     refused, so the target is left showing a phantom "X is attacking
        //     you!" and reading as "already engaged" to everyone else until
        //     their next heartbeat drains it.
        // The second case cannot be abused into griefing: it only ever clears an
        // engagement the caller themselves created, which is the same authority
        // they already had when they set it.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const targetSlug = safeName(name);
        if (!targetSlug) return res.status(400).json({ error: 'Invalid name.' });
        if (!identity.admin && identity.name !== targetSlug) {
            const pendingName = (onlineStore.get(name)?.pendingAttacker as { name?: unknown } | null)?.name;
            const engagedBy = pendingName ? safeName(String(pendingName)) : '';
            if (!engagedBy || engagedBy !== identity.name) {
                return res.status(403).json({ error: 'Cannot clear another player.' });
            }
        }

        onlineStore.clearPendingAttacker(name);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[clear-attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
