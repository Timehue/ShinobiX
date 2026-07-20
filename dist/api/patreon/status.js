"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _patreon_js_1 = require("./_patreon.js");
/*
 * GET /api/patreon/status?playerName=<name>
 *
 * Player-authenticated read of the caller's Patreon link + subscription state,
 * for the in-app "Link Patreon" button / subscriber badge. The AUTHORITATIVE
 * flag the perk gates read is character.patreon on the save; this endpoint
 * mirrors the reconciled member ledger for display and is kept in lockstep by
 * the webhook + OAuth callback.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'patreon-status', 60, 60_000))
        return;
    const playerName = (0, _utils_js_1.safeName)(String(req.query?.playerName ?? ''));
    if (!playerName)
        return res.status(400).json({ error: 'Missing playerName.' });
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'You can only read your own status.' });
    }
    const userId = await (0, _patreon_js_1.getLinkedPatreonUserId)(playerName);
    const rec = userId ? await (0, _patreon_js_1.getMemberRecord)(userId) : null;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        ok: true,
        configured: (0, _patreon_js_1.patreonConfigured)(),
        linked: !!userId,
        active: rec?.active ?? false,
        tier: rec?.tier ?? 'none',
        entitledCents: rec?.entitledCents ?? 0,
        minCents: (0, _patreon_js_1.subMinCents)(),
    });
}
