"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _tower_store_js_1 = require("./_tower-store.js");
/*
 * GET /api/towers/my-run?playerName=... — the active Battle Tower run this player has been
 * invited into (co-op), so an ally can DISCOVER + JOIN the host's run. Returns
 * { runId, session } when there's a live run they're a squad member of, else { runId: null }.
 * Membership is re-verified against the session; stale/finished invites are cleared.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const playerName = (0, _utils_js_1.safeName)(String(req.query.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing player.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'towers-myrun', 120, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const slug = identity.admin ? playerName : identity.name;
        res.setHeader('Cache-Control', 'no-store');
        const runId = await (0, _tower_store_js_1.getTowerInvite)(slug);
        if (!runId)
            return res.status(200).json({ runId: null });
        const session = await (0, _tower_store_js_1.readSession)(runId);
        const isMember = !!session && session.status === 'active'
            && session.actors.some(a => a.side === 'squad' && a.ownerSlug === slug && a.hp > 0);
        if (!isMember) {
            await (0, _tower_store_js_1.clearTowerInvite)(slug).catch(() => undefined); // finished / wiped / expired → drop it
            return res.status(200).json({ runId: null });
        }
        return res.status(200).json({ runId, session });
    }
    catch (err) {
        console.error('[towers/my-run]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
