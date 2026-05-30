"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Require a logged-in player. Prevents anonymous DoS where any name
    // can be marked as "engaged" to block their PvP.
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    // Per-actor rate limit. Without this, an authed attacker could hammer
    // /api/player/attack against arbitrary `targetName` values, repeatedly
    // overwriting their presence row (and refreshing the 60s TTL — keeping
    // them perpetually "engaged" so their own PvP gets blocked). 6 per
    // 60s leaves plenty of headroom for legitimate fights but kills the
    // spam vector.
    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'player-attack', 6, 60_000, rlName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attacker } = body;
        if (!targetName)
            return res.status(400).json({ error: 'Missing targetName.' });
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
        const outcome = await (0, _lock_js_1.withKvLock)(key, async () => {
            const target = await _storage_js_1.kv.get(key);
            if (!target)
                return { status: 404, body: { error: 'Target not online.' } };
            const travelingUntil = Number(target.travelingUntil ?? 0);
            if (travelingUntil > Date.now()) {
                return { status: 409, body: { error: 'Target is traveling and cannot be attacked.' } };
            }
            if (target.pendingAttacker) {
                return { status: 409, body: { error: 'Target is already engaged in combat.' } };
            }
            if (target.inBattle) {
                return { status: 409, body: { error: 'Target is already in a battle.' } };
            }
            // Re-stamp only — and crucially DO NOT extend the original TTL
            // beyond the standard 60s. The presence row stays exactly as
            // long as the target's heartbeat owns it; we just splice in
            // pendingAttacker. Original TTL is preserved by passing ex: 60
            // (same as heartbeat), so it can't be perpetually refreshed.
            await _storage_js_1.kv.set(key, { ...target, pendingAttacker: attacker ?? null }, { ex: 60 });
            return { status: 200, body: { ok: true } };
        });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
