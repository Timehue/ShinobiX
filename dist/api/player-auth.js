"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESERVED_USERNAMES = void 0;
exports.isReservedUsername = isReservedUsername;
exports.isReservedNameShape = isReservedNameShape;
exports.hashPw = hashPw;
exports.authKey = authKey;
exports.verifyPlayerPassword = verifyPlayerPassword;
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _auth_js_1 = require("./_auth.js");
const moderation_js_1 = require("./admin/moderation.js");
const crypto_1 = __importDefault(require("crypto"));
// Usernames reserved for the protected admin account. New `register` requests
// for these names are refused unless the caller passes the admin password via
// the `x-admin-password` header. The first-time owner registers themselves by
// supplying that header once; after that, the existing auth record blocks any
// further registration anyway. Server reset also preserves their save + auth.
// Keep in sync with PROTECTED_ADMIN_USERNAME in shinobij.client/src/App.tsx.
exports.RESERVED_USERNAMES = new Set(['rill']);
function isReservedUsername(name) {
    return exports.RESERVED_USERNAMES.has(name.trim().toLowerCase());
}
// Storage-layer name prefixes that must NOT be allowed as player usernames.
// `save:<name>` routes saves through different validators depending on the
// name prefix — `save:clan-*` goes through validateClanSaveWrite (designed for
// shared clan records) instead of sanitizeCharacterSave (designed for
// individual players), so a player who registered as `clan-cheat` would
// bypass every character-level cap. `system` / `admin` / `server` are
// reserved for internal use. Reject these at the registration gate so the
// situation never arises.
const RESERVED_NAME_PREFIXES = ['clan-', 'admin-', 'system-', 'server-'];
const RESERVED_NAME_LITERALS = new Set(['admin', 'admin1', 'admin2', 'system', 'server', 'kage', 'narrator', 'player']);
function isReservedNameShape(name) {
    const n = name.trim().toLowerCase();
    if (!n)
        return true;
    if (RESERVED_NAME_LITERALS.has(n))
        return true;
    return RESERVED_NAME_PREFIXES.some((p) => n.startsWith(p));
}
function newSalt() {
    return crypto_1.default.randomBytes(16).toString('hex');
}
// ─── Password hashing ─────────────────────────────────────────────────────────
// Old hashes: HMAC-SHA256 (fast, vulnerable to GPU brute force if leaked).
// New hashes: scrypt with N=16384 r=8 p=1 — Node built-in, no deps,
// ~100ms/hash on commodity hardware (vs ~10ns for HMAC).
//
// On successful verify of a legacy hash, we transparently re-hash with scrypt
// and write back the new format. Over time the legacy hashes disappear.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_PREFIX = 'scrypt:';
function hashScrypt(password, salt) {
    const derived = crypto_1.default.scryptSync(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return `${SCRYPT_PREFIX}${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${derived.toString('hex')}`;
}
function hashLegacy(password, salt) {
    return crypto_1.default.createHmac('sha256', salt).update(password).digest('hex');
}
// Public alias retained for backward compat with any other callers — always
// uses the modern algorithm now.
function hashPw(password, salt) {
    return hashScrypt(password, salt);
}
function safeStringEqual(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
        crypto_1.default.timingSafeEqual(ba, ba); // keep timing flat-ish
        return false;
    }
    return crypto_1.default.timingSafeEqual(ba, bb);
}
/**
 * Verify a password against a stored AuthRecord. Handles both legacy and
 * modern hash formats. Returns true if valid.
 */
function verifyAgainst(record, password) {
    if (record.hash.startsWith(SCRYPT_PREFIX)) {
        return safeStringEqual(hashScrypt(password, record.salt), record.hash);
    }
    return safeStringEqual(hashLegacy(password, record.salt), record.hash);
}
function authKey(name) {
    return `auth:${name.trim().toLowerCase()}`;
}
async function verifyPlayerPassword(name, password) {
    const record = await _storage_js_1.kv.get(authKey(name));
    if (!record)
        return false;
    const ok = verifyAgainst(record, password);
    // Opportunistically migrate legacy hashes to scrypt on successful login.
    if (ok && !record.hash.startsWith(SCRYPT_PREFIX)) {
        try {
            const salt = newSalt();
            await _storage_js_1.kv.set(authKey(name), { hash: hashScrypt(password, salt), salt });
        }
        catch {
            // Migration is best-effort — auth itself already succeeded.
        }
    }
    return ok;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Rate-limit auth actions by IP: 20 attempts per 15 minutes. KV-backed so
    // attackers can't hop serverless instances to reset the counter.
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'player-auth', 20, 15 * 60_000)))
        return;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, name, password, oldPassword, newPassword } = body;
    if (!name)
        return res.status(400).json({ ok: false, error: 'Missing name.' });
    const key = authKey(name);
    if (action === 'register') {
        // Register a new password. Fails if one already exists — use 'change' to update.
        if (!password)
            return res.status(400).json({ ok: false, error: 'Missing password.' });
        // Reserved-shape defense: storage-layer prefixes like `clan-` route
        // saves through the wrong validator (`validateClanSaveWrite` instead
        // of `sanitizeCharacterSave`), bypassing every character-level cap.
        // Names like `admin` / `system` / `server` are reserved for internal
        // use. Refuse these at the gate so the bad code path never runs.
        if (isReservedNameShape(name)) {
            return res.status(403).json({
                ok: false,
                error: 'That username is reserved. Pick a different name.',
            });
        }
        // Reserved-username defense: the protected admin account can only be
        // claimed once, and only by someone holding the admin password. This
        // prevents random players from grabbing the privileged username after
        // a fresh server-reset. The reservation is on the *first* registration
        // only — once the auth record exists, the `existing` check below
        // refuses any further registration anyway.
        if (isReservedUsername(name)) {
            const adminPassword = process.env.ADMIN_PASSWORD;
            const adminPw = req.headers['x-admin-password'];
            if (!adminPassword || !adminPw || !(0, _auth_js_1.safeEqual)(adminPw, adminPassword)) {
                return res.status(403).json({
                    ok: false,
                    error: 'This username is reserved. Ask an admin to register it.',
                });
            }
        }
        try {
            const existing = await _storage_js_1.kv.get(key);
            if (existing)
                return res.status(409).json({ ok: false, error: 'Account already has a password.' });
            // Legacy-account takeover defense: if a save:<name> blob already
            // exists but no auth:<name> record was ever created, refuse the
            // registration. Otherwise anyone who saw a player's name on the
            // leaderboard could call register and claim that account.
            // Legitimate legacy reclaim still works via the admin reset flow
            // (action='adminreset' with x-admin-password).
            const saveBlob = await _storage_js_1.kv.get(`save:${name.trim().toLowerCase()}`);
            if (saveBlob) {
                return res.status(409).json({
                    ok: false,
                    error: 'This account is a legacy account without a server password. Ask an admin to set it for you.',
                    legacyNeedsAdmin: true,
                });
            }
            const salt = newSalt();
            await _storage_js_1.kv.set(key, { hash: hashPw(password, salt), salt });
        }
        catch (err) {
            console.error('[player-auth register]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        // Issue a session token so the client can use the cheap token path
        // immediately instead of re-sending the password (and re-running
        // scrypt server-side) on every subsequent request. null when
        // SESSION_SECRET is unset — client then keeps using the password.
        return res.status(200).json({ ok: true, token: (0, _auth_js_1.issuePlayerToken)(name) ?? undefined });
    }
    if (action === 'verify') {
        // Verify a password. Returns { ok: true } on match, { ok: false } on mismatch,
        // or { ok: true, legacy: true } if no server password exists yet (legacy account).
        if (!password)
            return res.status(400).json({ ok: false, error: 'Missing password.' });
        let record;
        try {
            record = await _storage_js_1.kv.get(key);
        }
        catch (err) {
            // KV read failure (Supabase timeout, network hiccup, etc.).
            // Return 503 so the client can fall back to local auth rather than
            // showing "wrong password" when the server is just temporarily unavailable.
            console.error('[player-auth verify]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        if (!record) {
            // No server-side password stored yet (account predates this auth system).
            // Return legacy=true so the client can decide whether to register the password.
            return res.status(200).json({ ok: true, legacy: true });
        }
        const valid = verifyAgainst(record, password);
        // Opportunistically upgrade legacy HMAC hashes to scrypt on each
        // successful verify, so the legacy format dies off over time.
        if (valid && !record.hash.startsWith(SCRYPT_PREFIX)) {
            try {
                const salt = newSalt();
                await _storage_js_1.kv.set(key, { hash: hashScrypt(password, salt), salt });
            }
            catch {
                // best-effort
            }
        }
        if (!valid)
            return res.status(200).json({ ok: false });
        // Refuse login for banned accounts. The client surfaces this so the
        // user sees a clear "you are banned until X — reason: Y" message.
        const ban = await (0, moderation_js_1.getActiveBan)(name);
        if (ban) {
            return res.status(403).json({
                ok: false,
                error: 'Account is banned.',
                ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
            });
        }
        // Capture the login IP + browser fingerprint so the Moderation lookup
        // can link sock-puppets even before the player heartbeats — and even
        // if they're hiding behind a VPN.
        void (0, moderation_js_1.recordClientIp)(name, (0, moderation_js_1.clientIpFrom)(req));
        const fp = (0, moderation_js_1.clientFpFrom)(req);
        if (fp)
            void (0, moderation_js_1.recordClientFingerprint)(name, fp);
        // Mint a session token so subsequent requests use the cheap HMAC path
        // instead of re-running scrypt on every call. null → SESSION_SECRET
        // unset, client falls back to the password path transparently.
        return res.status(200).json({ ok: true, token: (0, _auth_js_1.issuePlayerToken)(name) ?? undefined });
    }
    if (action === 'change') {
        // Change password — requires old password.
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
        }
        try {
            const record = await _storage_js_1.kv.get(key);
            if (!record) {
                // Legacy account with no password yet — just set it.
                const salt = newSalt();
                await _storage_js_1.kv.set(key, { hash: hashPw(newPassword, salt), salt });
                return res.status(200).json({ ok: true, token: (0, _auth_js_1.issuePlayerToken)(name) ?? undefined });
            }
            if (!verifyAgainst(record, oldPassword)) {
                return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
            }
            const salt = newSalt();
            await _storage_js_1.kv.set(key, { hash: hashPw(newPassword, salt), salt });
            return res.status(200).json({ ok: true, token: (0, _auth_js_1.issuePlayerToken)(name) ?? undefined });
        }
        catch (err) {
            console.error('[player-auth change]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }
    if (action === 'delete') {
        // Delete the auth record when a player deletes their character.
        // Must supply either valid player password or admin password.
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'];
        if (adminPassword && adminPw && safeStringEqual(adminPw, adminPassword)) {
            try {
                await _storage_js_1.kv.del(key);
            }
            catch (err) {
                console.error('[player-auth delete]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
            return res.status(200).json({ ok: true });
        }
        if (!password)
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        try {
            const record = await _storage_js_1.kv.get(key);
            if (record && !verifyAgainst(record, password)) {
                return res.status(401).json({ ok: false, error: 'Incorrect password.' });
            }
            await _storage_js_1.kv.del(key);
        }
        catch (err) {
            console.error('[player-auth delete]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }
    if (action === 'adminreset') {
        // Admin sets a player's password to a new value (e.g. for account recovery).
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'];
        if (!adminPassword || !adminPw || !safeStringEqual(adminPw, adminPassword)) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        if (!newPassword)
            return res.status(400).json({ ok: false, error: 'Missing newPassword.' });
        try {
            const salt = newSalt();
            await _storage_js_1.kv.set(key, { hash: hashPw(newPassword, salt), salt });
        }
        catch (err) {
            console.error('[player-auth adminreset]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
