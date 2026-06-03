"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const presence_gating_js_1 = require("../_realtime/presence-gating.js");
const notify_js_1 = require("../_realtime/notify.js");
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
        // Presence is in process memory; get → check → set runs synchronously on
        // Node's single thread (no await gap for a concurrent heartbeat to
        // interleave), so no lock is needed. setPendingAttacker does NOT bump the
        // target's lastSeen — the same "can't be perpetually refreshed" property
        // the old `ex: 60` re-stamp guaranteed. attackBlock carries the offline
        // (404), Academy-protection (403 for sub-Genin), and traveling / engaged
        // / in-battle (409) gates.
        const block = (0, presence_gating_js_1.attackBlock)(online_store_js_1.onlineStore.get(targetName));
        if (block)
            return res.status(block.status).json({ error: block.error });
        online_store_js_1.onlineStore.setPendingAttacker(targetName, attacker ?? null);
        // Instant delivery: nudge the target to run an immediate heartbeat (which
        // is the authoritative path that reads + clears pendingAttacker). No-op if
        // the target has no socket / realtime is off — the poll still delivers it.
        (0, notify_js_1.kickPlayer)(targetName, 'attack');
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
