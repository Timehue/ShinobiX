"use strict";
/**
 * Shared authentication helpers.
 *
 * Two trust levels:
 *   - player:  x-player-name + x-player-password headers must verify
 *   - admin:   x-admin-password header must equal process.env.ADMIN_PASSWORD
 *
 * Most game-mutating endpoints accept either (admin can do anything a player can).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqual = safeEqual;
exports.isAdmin = isAdmin;
exports.authedPlayer = authedPlayer;
exports.authedPlayerOrAdmin = authedPlayerOrAdmin;
exports.bodyNameMatchesAuth = bodyNameMatchesAuth;
const crypto_1 = require("crypto");
const player_auth_js_1 = require("./player-auth.js");
const _utils_js_1 = require("./_utils.js");
function headerString(req, key) {
    const v = req.headers[key.toLowerCase()];
    if (Array.isArray(v))
        return v[0] ?? '';
    return v ?? '';
}
/**
 * Constant-time comparison of two strings. Returns false on length mismatch
 * without leaking the correct length via timing.
 */
function safeEqual(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
        // Still do a compare to keep timing flat-ish.
        (0, crypto_1.timingSafeEqual)(ba, ba);
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(ba, bb);
}
/**
 * Verify the request carries a valid admin password.
 * Accepts header `x-admin-password`. Constant-time compare.
 */
function isAdmin(req) {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected)
        return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided)
        return false;
    return safeEqual(provided, expected);
}
/**
 * Verify the request carries a valid player password.
 * Returns the canonical lowercased name on success, null on failure.
 *
 * Accepts:
 *   - x-player-name + x-player-password (preferred)
 *   - x-player-password only when the route already implies a name
 *     (caller passes `nameFromRoute`)
 */
async function authedPlayer(req, nameFromRoute) {
    const headerName = headerString(req, 'x-player-name');
    const pw = headerString(req, 'x-player-password');
    if (!pw)
        return null;
    const name = headerName || nameFromRoute || '';
    if (!name)
        return null;
    const canonical = name.trim().toLowerCase();
    try {
        return (await (0, player_auth_js_1.verifyPlayerPassword)(canonical, pw)) ? canonical : null;
    }
    catch {
        return null;
    }
}
/**
 * Convenience: require *either* a valid player auth or admin auth.
 * Returns { admin: true } or { admin: false, name } on success, null on failure.
 */
async function authedPlayerOrAdmin(req, nameFromRoute) {
    if (isAdmin(req))
        return { admin: true };
    const name = await authedPlayer(req, nameFromRoute);
    if (name)
        return { admin: false, name };
    return null;
}
/**
 * Match a body-supplied name against the authed identity. Used to prevent
 * a player from acting as someone else even when they have a valid login.
 *
 * Returns true if:
 *   - identity is admin (admins can act as anyone), OR
 *   - the authed player name (canonicalized) matches `bodyName` (canonicalized)
 */
function bodyNameMatchesAuth(identity, bodyName) {
    if (identity.admin)
        return true;
    if (!bodyName)
        return false;
    const a = identity.name;
    const b = (0, _utils_js_1.safeName)(bodyName) || bodyName.trim().toLowerCase();
    return a === b || a === bodyName.trim().toLowerCase();
}
