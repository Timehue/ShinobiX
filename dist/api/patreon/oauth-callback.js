"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _patreon_js_1 = require("./_patreon.js");
/*
 * GET /api/patreon/oauth-callback?code=<code>&state=<signed-state>
 *
 * Patreon redirects the patron's BROWSER here after they approve. There are no
 * auth headers on a top-level redirect, so the trusted identity comes entirely
 * from the HMAC-signed `state` (minted by oauth-start). We exchange the code,
 * read the patron's current membership, bind Patreon-account ↔ game-account, and
 * write the subscriber flag — then bounce the browser back into the SPA.
 */
function appReturnUrl(statusParam) {
    const base = String(process.env.PATREON_APP_RETURN_URL ?? '/').trim() || '/';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}patreon=${encodeURIComponent(statusParam)}`;
}
function bounce(res, statusParam) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', appReturnUrl(statusParam));
    return res.status(302).end();
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _patreon_js_1.patreonConfigured)())
        return bounce(res, 'error');
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'patreon-oauth-callback', 30, 60_000))
        return;
    const code = String(req.query?.code ?? '');
    const state = String(req.query?.state ?? '');
    const playerName = (0, _patreon_js_1.verifyState)(state);
    // A Patreon "user denied" bounce arrives with ?error and no code.
    if (!code || !playerName)
        return bounce(res, 'error');
    try {
        const token = await (0, _patreon_js_1.exchangeCodeForToken)(code);
        if (!token)
            return bounce(res, 'error');
        const identity = await (0, _patreon_js_1.fetchIdentityMembership)(token.access_token);
        if (!identity)
            return bounce(res, 'error');
        await (0, _patreon_js_1.linkPlayer)(identity.userId, playerName);
        const ent = (0, _patreon_js_1.computeEntitlement)(identity.membership);
        await (0, _patreon_js_1.setMemberRecord)(identity.userId, ent, identity.membership?.patronStatus ?? '');
        await (0, _patreon_js_1.applyEntitlementToSave)(playerName, identity.userId, ent);
        return bounce(res, ent.active ? 'linked' : 'linked_inactive');
    }
    catch (err) {
        console.error('[patreon/oauth-callback]', err);
        return bounce(res, 'error');
    }
}
