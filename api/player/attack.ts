import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { attackBlock } from '../_realtime/presence-gating.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Require a logged-in player. Prevents anonymous DoS where any name
    // can be marked as "engaged" to block their PvP.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // Per-actor rate limit. Without this, an authed attacker could hammer
    // /api/player/attack against arbitrary `targetName` values, repeatedly
    // overwriting their presence row (and refreshing the 60s TTL — keeping
    // them perpetually "engaged" so their own PvP gets blocked). 6 per
    // 60s leaves plenty of headroom for legitimate fights but kills the
    // spam vector.
    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !enforceRateLimit(req, res, 'player-attack', 6, 60_000, rlName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attacker } = body as { targetName?: string; attacker?: { name?: string } | null };
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });

        // Attacker's reported name (if any) must match the authed identity —
        // a player can't initiate an attack masquerading as someone else.
        if (!identity.admin && attacker && attacker.name) {
            const claimedName = String(attacker.name).trim().toLowerCase();
            if (claimedName !== identity.name) {
                return res.status(403).json({ error: 'Attacker name does not match authenticated user.' });
            }
        }

        // Lock the target's presence row around the check-and-write so a
        // concurrent heartbeat from the target doesn't get clobbered by our
        // pendingAttacker stamp (and vice versa). The previous code spread
        // a stale `target` snapshot into the write, which could revert a
        // freshly-changed sector or battle flag.
        // Presence is in process memory; get → check → set runs synchronously on
        // Node's single thread (no await gap for a concurrent heartbeat to
        // interleave), so no lock is needed. setPendingAttacker does NOT bump the
        // target's lastSeen — the same "can't be perpetually refreshed" property
        // the old `ex: 60` re-stamp guaranteed.
        const block = attackBlock(onlineStore.get(targetName));
        if (block) return res.status(block.status).json({ error: block.error });
        onlineStore.setPendingAttacker(targetName, attacker ?? null);
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
