"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _patreon_js_1 = require("./_patreon.js");
/*
 * GET /api/patreon/oauth-start?playerName=<name>
 *
 * Player-authenticated (token or password, via authFetch headers). Returns the
 * Patreon authorize URL with a server-signed `state` carrying the player name,
 * and the CLIENT performs the top-level navigation. We return JSON rather than a
 * 302 so the request can carry auth headers (a browser redirect could not), and
 * so the callback can trust WHICH account to link from the signed state alone.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _patreon_js_1.patreonConfigured)()) {
        return res.status(503).json({ error: 'Patreon linking is not configured.' });
    }
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'patreon-oauth-start', 20, 60_000))
        return;
    const playerName = (0, _utils_js_1.safeName)(String(req.query?.playerName ?? ''));
    if (!playerName)
        return res.status(400).json({ error: 'Missing playerName.' });
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'You can only link your own account.' });
    }
    // Sign the validated target name into the state (for a non-admin this equals
    // identity.name; an admin may link on a player's behalf). The callback trusts
    // only this signed name.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, url: (0, _patreon_js_1.buildAuthorizeUrl)((0, _patreon_js_1.signState)(playerName)) });
}
