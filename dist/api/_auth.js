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
exports.issuePlayerToken = issuePlayerToken;
exports.verifyPlayerToken = verifyPlayerToken;
exports.isFullAdmin = isFullAdmin;
exports.isAdmin = isAdmin;
exports.authedPlayer = authedPlayer;
exports.authedPlayerOrAdmin = authedPlayerOrAdmin;
exports.bodyNameMatchesAuth = bodyNameMatchesAuth;
const crypto_1 = require("crypto");
const player_auth_js_1 = require("./player-auth.js");
const _utils_js_1 = require("./_utils.js");
const moderation_js_1 = require("./admin/moderation.js");
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
// ─── Stateless player session tokens ──────────────────────────────────────────
//
// The per-request scrypt password verify (~100ms of blocking CPU, see
// player-auth.ts) is the dominant cost on the single-core cPanel host: every
// authenticated heartbeat / move / save re-derives the scrypt hash. To remove
// it from the hot path we mint a short-lived HMAC token at login and verify
// THAT on subsequent requests (~microseconds, no KV read, no scrypt).
//
// Token format (all base64url, dot-separated):  v1.<name>.<expEpochMs>.<sig>
//   sig = HMAC-SHA256(SESSION_SECRET, "<name>.<expEpochMs>")
// Stateless by design — no server-side session store. Revocation relies on:
//   • the short TTL below, and
//   • the per-request getActiveBan() check in authedPlayer (unchanged), which
//     freezes a banned/kicked account immediately regardless of token validity.
//
// SESSION_SECRET is a master key: anyone holding it can forge a token for any
// player. It MUST be a high-entropy env var set on BOTH cPanel (.env) and
// Vercel, and never committed. If unset, token issuing/verifying is disabled
// and the system transparently falls back to the password path (no outage,
// just no speedup until the secret is configured).
const TOKEN_VERSION = 'v1';
// 24h. Survives any single PvP fight (≤15min sessions) with margin; the client
// silently re-mints from the stored password on the rare expiry-mid-session.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
function sessionSecret() {
    const s = process.env.SESSION_SECRET;
    return s && s.length > 0 ? s : null;
}
function b64url(s) {
    return Buffer.from(s, 'utf8').toString('base64url');
}
function unb64url(s) {
    return Buffer.from(s, 'base64url').toString('utf8');
}
function signToken(canonicalName, expMs, secret) {
    return (0, crypto_1.createHmac)('sha256', secret)
        .update(`${canonicalName}.${expMs}`)
        .digest('base64url');
}
/**
 * Mint a session token for an already-authenticated player. The caller is
 * responsible for having verified the password (player-auth.ts does this once
 * at login/register/change). Returns null when SESSION_SECRET is unset so
 * callers can simply omit the token and let clients keep using the password.
 *
 * `name` is canonicalized (lowercased/trimmed) so the token always encodes the
 * same identity string that authedPlayer would otherwise return.
 */
function issuePlayerToken(name, ttlMs = TOKEN_TTL_MS) {
    const secret = sessionSecret();
    if (!secret)
        return null;
    const canonical = (0, _utils_js_1.safeName)(name);
    const expMs = Date.now() + ttlMs;
    const sig = signToken(canonical, expMs, secret);
    return `${TOKEN_VERSION}.${b64url(canonical)}.${expMs}.${sig}`;
}
/**
 * Verify a session token. Returns the canonical player name on success, or
 * null if the token is missing/malformed/expired/forged or SESSION_SECRET is
 * unset. Pure CPU + constant-time compare; no KV, no scrypt.
 *
 * Does NOT check bans — authedPlayer applies the existing getActiveBan() gate
 * after this returns, so a token alone can never bypass a ban.
 */
function verifyPlayerToken(token) {
    const secret = sessionSecret();
    if (!secret)
        return null;
    if (!token)
        return null;
    const parts = token.split('.');
    if (parts.length !== 4)
        return null;
    const [version, nameB64, expStr, sig] = parts;
    if (version !== TOKEN_VERSION)
        return null;
    let canonical;
    try {
        canonical = unb64url(nameB64);
    }
    catch {
        return null;
    }
    if (!canonical)
        return null;
    const expMs = Number(expStr);
    if (!Number.isFinite(expMs) || expMs <= Date.now())
        return null;
    // Recompute the signature and constant-time compare. safeEqual handles
    // length mismatch without leaking via timing.
    const expected = signToken(canonical, expMs, secret);
    if (!safeEqual(sig, expected))
        return null;
    return canonical;
}
/**
 * Verify the request carries the FULL admin password (Admin 1 only).
 * Accepts header `x-admin-password`. Constant-time compare.
 *
 * Use this for the destructive / sensitive endpoints that Admin 2 must
 * NOT have access to: player management, moderation, server reset, KV
 * migration. Every other admin endpoint uses `isAdmin()` which accepts
 * either password.
 */
function isFullAdmin(req) {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected)
        return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided)
        return false;
    return safeEqual(provided, expected);
}
/**
 * Verify the request carries A valid admin password — either ADMIN_PASSWORD
 * (Admin 1, full access) or ADMIN_CONTENT_PASSWORD (Admin 2, content-only
 * access). Use this for endpoints that BOTH admin roles should be able to
 * call (content curation: bloodline-review, item-review, save:admin* writes,
 * villageLeadershipImages, etc.).
 *
 * For the restricted set (player management, moderation, etc.) use
 * `isFullAdmin()` instead.
 */
function isAdmin(req) {
    if (isFullAdmin(req))
        return true;
    const expectedContent = process.env.ADMIN_CONTENT_PASSWORD;
    if (!expectedContent)
        return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided)
        return false;
    return safeEqual(provided, expectedContent);
}
/**
 * Verify the request carries valid player credentials.
 * Returns the canonical lowercased name on success, null on failure.
 *
 * Accepts (in priority order):
 *   - x-player-token (preferred)        — stateless HMAC session token, no
 *     scrypt, no KV read for the password. Minted at login (see
 *     issuePlayerToken). This is the fast path that keeps the single-core
 *     cPanel host from spending ~100ms of scrypt on every authed request.
 *   - x-player-name + x-player-password — the original password path. Still
 *     fully supported: used at first login (before a token exists), by older
 *     cached clients, and as the silent-refresh fallback when a token expires.
 *   - x-player-password only when the route already implies a name
 *     (caller passes `nameFromRoute`).
 *
 * The active-ban gate is applied identically to BOTH paths, so a token can
 * never let a banned account act — exactly matching the password behavior.
 */
async function authedPlayer(req, nameFromRoute) {
    try {
        // ── Fast path: stateless session token (no scrypt, no KV) ──────────
        const token = headerString(req, 'x-player-token');
        if (token) {
            const rawTokenName = verifyPlayerToken(token);
            if (rawTokenName) {
                // Normalize to the safeName slug so the returned identity always
                // equals the storage-key form (covers any legacy token minted
                // before the canonicalization was unified).
                const tokenName = (0, _utils_js_1.safeName)(rawTokenName);
                // If the route/header names an explicit player, the token must
                // match it — a valid token for player A cannot act as player B.
                // Canonicalize via safeName so a display name with spaces /
                // stripped chars compares equal to the slug encoded in the token.
                const claimed = (0, _utils_js_1.safeName)(headerString(req, 'x-player-name') || nameFromRoute || '');
                if (claimed && claimed !== tokenName)
                    return null;
                // Same ban gate as the password path — bans bite immediately.
                const ban = await (0, moderation_js_1.getActiveBan)(tokenName);
                if (ban)
                    return null;
                return tokenName;
            }
            // Token present but invalid/expired: fall through to the password
            // path so a stale token alone doesn't block a request that also
            // carries a valid password (and the client can re-mint).
        }
        // ── Slow path: scrypt password verify ──────────────────────────────
        const headerName = headerString(req, 'x-player-name');
        const pw = headerString(req, 'x-player-password');
        if (!pw)
            return null;
        const name = headerName || nameFromRoute || '';
        if (!name)
            return null;
        const canonical = (0, _utils_js_1.safeName)(name);
        if (!(await (0, player_auth_js_1.verifyPlayerPassword)(canonical, pw)))
            return null;
        // Banned players authenticate but lose access. authedPlayer is the
        // single chokepoint for every player-only endpoint, so this one check
        // freezes the account out of every game action until the ban lifts.
        const ban = await (0, moderation_js_1.getActiveBan)(canonical);
        if (ban)
            return null;
        return canonical;
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
    // identity.name is the safeName slug (see authedPlayer), so compare the
    // body name through the same canonicalizer.
    return identity.name === (0, _utils_js_1.safeName)(bodyName);
}
