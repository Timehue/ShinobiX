import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

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
        const key = `presence:${targetName}`;
        const outcome = await withKvLock(key, async () => {
            const target = await kv.get<Record<string, unknown>>(key);
            if (!target) return { status: 404 as const, body: { error: 'Target not online.' } };

            // Academy-Student PvP protection: shinobi below Genin (level 15)
            // cannot be attacked, so brand-new players aren't farmed before they
            // learn the game. The presence row keeps `character.level` (see
            // heartbeat slimPresenceCharacter). Skip the guard if level is
            // unknown (0) so a missing field can't break legitimate fights.
            const targetChar = target.character as Record<string, unknown> | null;
            const targetLevel = Number(targetChar?.level ?? 0);
            if (targetLevel > 0 && targetLevel < 15) {
                return { status: 403 as const, body: { error: 'This shinobi is under Academy protection (cannot be attacked until they reach Genin, level 15).' } };
            }

            const travelingUntil = Number(target.travelingUntil ?? 0);
            if (travelingUntil > Date.now()) {
                return { status: 409 as const, body: { error: 'Target is traveling and cannot be attacked.' } };
            }
            if (target.pendingAttacker) {
                return { status: 409 as const, body: { error: 'Target is already engaged in combat.' } };
            }
            if (target.inBattle) {
                return { status: 409 as const, body: { error: 'Target is already in a battle.' } };
            }

            // Re-stamp only — and crucially DO NOT extend the original TTL
            // beyond the standard 60s. The presence row stays exactly as
            // long as the target's heartbeat owns it; we just splice in
            // pendingAttacker. Original TTL is preserved by passing ex: 60
            // (same as heartbeat), so it can't be perpetually refreshed.
            await kv.set(key, { ...target, pendingAttacker: attacker ?? null }, { ex: 60 });
            return { status: 200 as const, body: { ok: true } };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
