"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESERVED_USERNAMES = void 0;
exports.isReservedUsername = isReservedUsername;
exports.isReservedNameShape = isReservedNameShape;
exports.playerPasswordPolicyError = playerPasswordPolicyError;
exports.hashPw = hashPw;
exports.authKey = authKey;
exports.verifyPlayerPassword = verifyPlayerPassword;
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _auth_js_1 = require("./_auth.js");
const _lock_js_1 = require("./_lock.js");
const moderation_js_1 = require("./admin/moderation.js");
const _beta_metrics_js_1 = require("./_beta-metrics.js");
const _launch_controls_js_1 = require("./_launch-controls.js");
const _text_moderation_js_1 = require("./_text-moderation.js");
const crypto_1 = __importDefault(require("crypto"));
// Usernames reserved for the protected admin account. New `register` requests
// for these names are refused unless the caller passes the admin password via
// the `x-admin-password` header. The first-time owner registers themselves by
// supplying that header once; after that, the existing auth record blocks any
// further registration anyway. Server reset also preserves their save + auth.
// Keep in sync with PROTECTED_ADMIN_USERNAME in shinobij.client/src/constants/game.ts.
exports.RESERVED_USERNAMES = new Set(['rill']);
function isReservedUsername(name) {
    return exports.RESERVED_USERNAMES.has((0, _utils_js_1.safeName)(name));
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
    // Check the safeName slug — that's the form the storage key actually uses,
    // so a display name like "clan - cheat" (slug "clan-cheat") is caught by
    // the `clan-` prefix guard exactly as a literal "clan-cheat" would be.
    const n = (0, _utils_js_1.safeName)(name);
    if (!n)
        return true;
    if (RESERVED_NAME_LITERALS.has(n))
        return true;
    return RESERVED_NAME_PREFIXES.some((p) => n.startsWith(p));
}
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
/**
 * Server-authoritative password policy. This mirrors account creation's client
 * validation and adds a hard maximum so hostile requests cannot send an
 * unbounded scrypt input.
 */
function playerPasswordPolicyError(password) {
    if (typeof password !== 'string')
        return 'Password must be text.';
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return 'Password must include at least one letter and one number.';
    }
    return null;
}
function playerPasswordVerificationError(password) {
    if (typeof password !== 'string' || !password)
        return 'Missing password.';
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    return null;
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
// Keep nonexistent-account verification on the same expensive password path
// as a real account. Without this dummy record, attackers can distinguish an
// unused name both from the response body and from the missing scrypt work.
const DUMMY_AUTH_RECORD = {
    salt: 'player-auth-enumeration-guard-v1',
    hash: hashScrypt('DummyAccountPassword1', 'player-auth-enumeration-guard-v1'),
};
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
    return `auth:${(0, _utils_js_1.safeName)(name)}`;
}
async function issuePlayerTokenForRecord(name, record) {
    try {
        const recordEpoch = record.sessionEpoch ?? 0;
        const token = (0, _auth_js_1.issuePlayerToken)(name, undefined, recordEpoch);
        if (!token)
            return null;
        const currentEpoch = await (0, _auth_js_1.readPlayerSessionEpoch)(name);
        // A prior credential mutation may have rotated successfully but failed
        // before its auth-row write. Never mint a token for that stale record;
        // password fallback remains available until the mutation is retried.
        if (recordEpoch !== currentEpoch)
            return null;
        return token;
    }
    catch {
        return null;
    }
}
async function verifyPlayerPassword(name, password) {
    const key = authKey(name);
    const record = await _storage_js_1.kv.get(key);
    if (!record)
        return false;
    const ok = verifyAgainst(record, password);
    // Opportunistically migrate legacy hashes to scrypt on successful login.
    if (ok && !record.hash.startsWith(SCRYPT_PREFIX)) {
        try {
            // Serialize with credential mutations and re-check the observed
            // record. Otherwise a slow legacy migration can overwrite a newly
            // changed password with the old password's upgraded hash.
            await (0, _lock_js_1.withKvLock)(key, async () => {
                const current = await _storage_js_1.kv.get(key);
                if (!current || current.hash !== record.hash || current.salt !== record.salt)
                    return;
                const salt = newSalt();
                await _storage_js_1.kv.set(key, { ...current, hash: hashScrypt(password, salt), salt });
            }, { failClosed: true });
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
    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ ok: false, error: 'Invalid request body.' });
    }
    const { action, name, password, oldPassword, newPassword } = body;
    if (typeof name !== 'string' || !name) {
        return res.status(400).json({ ok: false, error: 'Missing name.' });
    }
    if (!(0, _utils_js_1.safeName)(name)) {
        return res.status(400).json({ ok: false, error: 'Pick a name with at least one letter or number.' });
    }
    const key = authKey(name);
    if (action === 'register') {
        // Keep this check inside the handler as well as the Railway/Express
        // route boundary so a direct serverless invocation cannot bypass the
        // emergency registration switch.
        if ((0, _launch_controls_js_1.newRegistrationsDisabled)()) {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Retry-After', '300');
            return res.status(503).json({
                ok: false,
                error: 'New registrations are temporarily disabled.',
                code: 'registrations_disabled',
            });
        }
        let registeredSessionEpoch = 0;
        // Register a new password. Fails if one already exists — use 'change' to update.
        if (typeof password !== 'string')
            return res.status(400).json({ ok: false, error: 'Password must be text.' });
        const passwordPolicyError = playerPasswordPolicyError(password);
        if (passwordPolicyError)
            return res.status(400).json({ ok: false, error: passwordPolicyError });
        // Empty-slug guard: the account identity is the safeName slug. A name
        // made entirely of characters safeName strips (all emoji / punctuation)
        // collapses to '' and would write the bare `auth:` / `save:` keys.
        if (!(0, _utils_js_1.safeName)(name)) {
            return res.status(400).json({ ok: false, error: 'Pick a name with at least one letter or number.' });
        }
        // Names are public identity, so reject blocked terms outright instead
        // of masking them. The check normalizes common leetspeak, punctuation,
        // spacing, and repeated letters before matching.
        if (!(0, _text_moderation_js_1.isCleanPlayerName)(name)) {
            return res.status(400).json({
                ok: false,
                error: 'That username is not allowed. Pick a different name.',
            });
        }
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
            const registrationError = await (0, _lock_js_1.withKvLock)(key, async () => {
                const existing = await _storage_js_1.kv.get(key);
                if (existing) {
                    return { status: 409, body: { ok: false, error: 'Account already has a password.' } };
                }
                // A save without an auth row is a legacy account. Only the
                // authenticated admin-reset recovery path may claim it.
                const saveBlob = await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(name)}`);
                if (saveBlob) {
                    return {
                        status: 409,
                        body: {
                            ok: false,
                            error: 'This account is a legacy account without a server password. Ask an admin to set it for you.',
                            legacyNeedsAdmin: true,
                        },
                    };
                }
                const sessionEpoch = await (0, _auth_js_1.readPlayerSessionEpoch)(name);
                registeredSessionEpoch = sessionEpoch;
                const salt = newSalt();
                // NX remains a final concurrency gate if a non-cooperating
                // writer races this lock or a lock lease ever expires.
                const created = await _storage_js_1.kv.set(key, { hash: hashPw(password, salt), salt, sessionEpoch }, { nx: true });
                if (!created) {
                    return { status: 409, body: { ok: false, error: 'Account already has a password.' } };
                }
                return null;
            }, { failClosed: true });
            if (registrationError) {
                return res.status(registrationError.status).json(registrationError.body);
            }
            await (0, _beta_metrics_js_1.recordBetaMetric)({ event: 'account.registered', playerName: (0, _utils_js_1.safeName)(name), source: 'auth' });
        }
        catch (err) {
            console.error('[player-auth register]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        // Issue a session token so the client can use the cheap token path
        // immediately instead of re-sending the password (and re-running
        // scrypt server-side) on every subsequent request. null when
        // SESSION_SECRET is unset — client then keeps using the password.
        return res.status(200).json({
            ok: true,
            token: (0, _auth_js_1.issuePlayerToken)(name, undefined, registeredSessionEpoch) ?? undefined,
        });
    }
    if (action === 'verify') {
        // Verify a password. Legacy saves without a credential are recovery
        // cases, never successful authentication.
        const verificationError = playerPasswordVerificationError(password);
        if (verificationError)
            return res.status(400).json({ ok: false, error: verificationError });
        const verifiedPassword = password;
        let record;
        try {
            record = await _storage_js_1.kv.get(key);
        }
        catch (err) {
            // KV read failure (Supabase timeout, network hiccup, etc.).
            // Return 503 rather than misreporting a storage outage as a wrong
            // password. The client keeps the account locked and offers retry.
            console.error('[player-auth verify]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        if (!record) {
            // Burn the same scrypt work as an existing-account failure before
            // consulting legacy-save recovery state. The result is deliberately
            // ignored: this record can never authenticate a caller.
            verifyAgainst(DUMMY_AUTH_RECORD, verifiedPassword);
            // Only a real save qualifies as legacy. The client may surface the
            // recovery state, but only authenticated adminreset can claim it.
            try {
                const saveBlob = await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(name)}`);
                if (saveBlob) {
                    return res.status(409).json({
                        ok: false,
                        error: 'This legacy account requires authenticated admin recovery.',
                        legacy: true,
                        legacyNeedsAdmin: true,
                    });
                }
                return res.status(200).json({ ok: false });
            }
            catch (err) {
                console.error('[player-auth verify legacy]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
        }
        const valid = verifyAgainst(record, verifiedPassword);
        // Opportunistically upgrade legacy HMAC hashes to scrypt on each
        // successful verify, so the legacy format dies off over time.
        if (valid && !record.hash.startsWith(SCRYPT_PREFIX)) {
            try {
                await (0, _lock_js_1.withKvLock)(key, async () => {
                    const current = await _storage_js_1.kv.get(key);
                    if (!current || current.hash !== record.hash || current.salt !== record.salt)
                        return;
                    const salt = newSalt();
                    await _storage_js_1.kv.set(key, { ...current, hash: hashScrypt(verifiedPassword, salt), salt });
                }, { failClosed: true });
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
        return res.status(200).json({
            ok: true,
            token: (await issuePlayerTokenForRecord(name, record)) ?? undefined,
        });
    }
    if (action === 'change') {
        // Change password — requires the current password and serializes all
        // credential mutations for this account.
        if (typeof oldPassword !== 'string' || !oldPassword || typeof newPassword !== 'string' || !newPassword) {
            return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
        }
        const oldPasswordError = playerPasswordVerificationError(oldPassword);
        if (oldPasswordError)
            return res.status(400).json({ ok: false, error: oldPasswordError });
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError)
            return res.status(400).json({ ok: false, error: passwordPolicyError });
        if (safeStringEqual(oldPassword, newPassword)) {
            return res.status(400).json({ ok: false, error: 'New password must differ from the current password.' });
        }
        try {
            return await (0, _lock_js_1.withKvLock)(key, async () => {
                const record = await _storage_js_1.kv.get(key);
                if (!record) {
                    const saveBlob = await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(name)}`);
                    if (saveBlob) {
                        return res.status(409).json({
                            ok: false,
                            error: 'This legacy account requires authenticated admin recovery.',
                            legacyNeedsAdmin: true,
                        });
                    }
                    return res.status(404).json({ ok: false, error: 'Account does not exist.' });
                }
                if (!verifyAgainst(record, oldPassword)) {
                    return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
                }
                // Rotate first: if the following hash write fails, old tokens
                // are still revoked (safe failure) and the caller can retry.
                const sessionEpoch = await (0, _auth_js_1.rotatePlayerSessionEpoch)(name);
                const salt = newSalt();
                await _storage_js_1.kv.set(key, { hash: hashPw(newPassword, salt), salt, sessionEpoch });
                return res.status(200).json({
                    ok: true,
                    token: (0, _auth_js_1.issuePlayerToken)(name, undefined, sessionEpoch) ?? undefined,
                });
            }, { failClosed: true });
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
                await (0, _lock_js_1.withKvLock)(key, async () => {
                    await (0, _auth_js_1.rotatePlayerSessionEpoch)(name);
                    await _storage_js_1.kv.del(key);
                }, { failClosed: true });
            }
            catch (err) {
                console.error('[player-auth delete]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
            return res.status(200).json({ ok: true });
        }
        if (typeof password !== 'string' || !password) {
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        }
        const verificationError = playerPasswordVerificationError(password);
        if (verificationError)
            return res.status(400).json({ ok: false, error: verificationError });
        try {
            return await (0, _lock_js_1.withKvLock)(key, async () => {
                const record = await _storage_js_1.kv.get(key);
                if (!record) {
                    return res.status(404).json({ ok: false, error: 'Account does not exist.' });
                }
                if (!verifyAgainst(record, password)) {
                    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
                }
                await (0, _auth_js_1.rotatePlayerSessionEpoch)(name);
                await _storage_js_1.kv.del(key);
                return res.status(200).json({ ok: true });
            }, { failClosed: true });
        }
        catch (err) {
            console.error('[player-auth delete]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
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
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError)
            return res.status(400).json({ ok: false, error: passwordPolicyError });
        try {
            await (0, _lock_js_1.withKvLock)(key, async () => {
                const sessionEpoch = await (0, _auth_js_1.rotatePlayerSessionEpoch)(name);
                const salt = newSalt();
                await _storage_js_1.kv.set(key, { hash: hashPw(newPassword, salt), salt, sessionEpoch });
            }, { failClosed: true });
        }
        catch (err) {
            console.error('[player-auth adminreset]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
