import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors, safeName } from './_utils.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import {
    issuePlayerToken,
    readPlayerSessionEpoch,
    rotatePlayerSessionEpoch,
    isFullAdmin,
} from './_auth.js';
import { withKvLock } from './_lock.js';
import { getActiveBan, recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from './admin/moderation.js';
import { recordBetaMetric } from './_beta-metrics.js';
import { newRegistrationsDisabled } from './_launch-controls.js';
import { isCleanPlayerName, TEXT_LIMITS } from './_text-moderation.js';
import crypto from 'crypto';

// Usernames reserved for the protected admin account. New `register` requests
// for these names are refused unless the caller passes the admin password via
// the `x-admin-password` header. The first-time owner registers themselves by
// supplying that header once; after that, the existing auth record blocks any
// further registration anyway. Server reset also preserves their save + auth.
// Keep in sync with PROTECTED_ADMIN_USERNAME in shinobij.client/src/constants/game.ts.
export const RESERVED_USERNAMES = new Set<string>(['rill']);
export function isReservedUsername(name: string): boolean {
    return RESERVED_USERNAMES.has(safeName(name));
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
export function isReservedNameShape(name: string): boolean {
    // Check the safeName slug — that's the form the storage key actually uses,
    // so a display name like "clan - cheat" (slug "clan-cheat") is caught by
    // the `clan-` prefix guard exactly as a literal "clan-cheat" would be.
    const n = safeName(name);
    if (!n) return true;
    if (RESERVED_NAME_LITERALS.has(n)) return true;
    return RESERVED_NAME_PREFIXES.some((p) => n.startsWith(p));
}

// `hash` stores either the legacy HMAC-SHA256 hex (no version prefix) or the
// new scrypt format `scrypt:N:r:p:hex`. New writes always use scrypt.
type AuthRecord = { hash: string; salt: string; sessionEpoch?: number };

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Server-authoritative password policy. This mirrors account creation's client
 * validation and adds a hard maximum so hostile requests cannot send an
 * unbounded scrypt input.
 */
export function playerPasswordPolicyError(password: unknown): string | null {
    if (typeof password !== 'string') return 'Password must be text.';
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

function playerPasswordVerificationError(password: unknown): string | null {
    if (typeof password !== 'string' || !password) return 'Missing password.';
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    return null;
}

function newSalt(): string {
    return crypto.randomBytes(16).toString('hex');
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

function hashScrypt(password: string, salt: string): string {
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return `${SCRYPT_PREFIX}${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${derived.toString('hex')}`;
}

// Keep nonexistent-account verification on the same expensive password path
// as a real account. Without this dummy record, attackers can distinguish an
// unused name both from the response body and from the missing scrypt work.
const DUMMY_AUTH_RECORD: AuthRecord = {
    salt: 'player-auth-enumeration-guard-v1',
    hash: hashScrypt('DummyAccountPassword1', 'player-auth-enumeration-guard-v1'),
};

function hashLegacy(password: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

// Public alias retained for backward compat with any other callers — always
// uses the modern algorithm now.
export function hashPw(password: string, salt: string): string {
    return hashScrypt(password, salt);
}

function safeStringEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
        crypto.timingSafeEqual(ba, ba); // keep timing flat-ish
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a password against a stored AuthRecord. Handles both legacy and
 * modern hash formats. Returns true if valid.
 */
function verifyAgainst(record: AuthRecord, password: string): boolean {
    if (record.hash.startsWith(SCRYPT_PREFIX)) {
        return safeStringEqual(hashScrypt(password, record.salt), record.hash);
    }
    return safeStringEqual(hashLegacy(password, record.salt), record.hash);
}

export function authKey(name: string): string {
    return `auth:${safeName(name)}`;
}

async function issuePlayerTokenForRecord(name: string, record: AuthRecord): Promise<string | null> {
    try {
        const recordEpoch = record.sessionEpoch ?? 0;
        const token = issuePlayerToken(name, undefined, recordEpoch);
        if (!token) return null;
        const currentEpoch = await readPlayerSessionEpoch(name);
        // A prior credential mutation may have rotated successfully but failed
        // before its auth-row write. Never mint a token for that stale record;
        // password fallback remains available until the mutation is retried.
        if (recordEpoch !== currentEpoch) return null;
        return token;
    } catch {
        return null;
    }
}

export async function verifyPlayerPassword(name: string, password: string): Promise<boolean> {
    const key = authKey(name);
    const record = await kv.get<AuthRecord>(key);
    if (!record) return false;
    const ok = verifyAgainst(record, password);
    // Opportunistically migrate legacy hashes to scrypt on successful login.
    if (ok && !record.hash.startsWith(SCRYPT_PREFIX)) {
        try {
            // Serialize with credential mutations and re-check the observed
            // record. Otherwise a slow legacy migration can overwrite a newly
            // changed password with the old password's upgraded hash.
            await withKvLock(key, async () => {
                const current = await kv.get<AuthRecord>(key);
                if (!current || current.hash !== record.hash || current.salt !== record.salt) return;
                const salt = newSalt();
                await kv.set(key, { ...current, hash: hashScrypt(password, salt), salt });
            }, { failClosed: true });
        } catch {
            // Migration is best-effort — auth itself already succeeded.
        }
    }
    return ok;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Parse the body BEFORE rate-limiting so the limiter can bucket per action.
    // This is only JSON.parse — no storage, no hashing — so it cannot be abused for
    // load, and every expensive path (scrypt verification in particular) still sits
    // behind the limiter below.
    let body: unknown;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ ok: false, error: 'Invalid request body.' });
    }
    const { action, name, password, oldPassword, newPassword } = body as {
        action?: string;
        name?: string;
        password?: string;
        oldPassword?: string;
        newPassword?: string;
    };

    // Rate-limit auth by IP, KV-backed so an attacker can't hop instances to reset
    // the counter. Keyed on IP and NOT on the supplied name: the name is
    // unauthenticated at this point, so trusting it would let an attacker mint a
    // fresh budget per request and defeat the limit entirely.
    //
    // PER ACTION, because IP keying means one internet connection shares one budget.
    // A single 20-attempt budget spanning register + verify + change was small enough
    // that a group of friends signing up together from one household, dorm, or
    // carrier-NAT address exhausted it collectively — and each of them was then told
    // their password was wrong (the client reported 429 as a credential failure).
    // Splitting the buckets means a login is never blocked by someone else's
    // registration attempts, and the budgets are sized for real group behaviour:
    // logins retry on typos, registrations retry on taken names.
    const AUTH_BUDGETS: Record<string, number> = { verify: 40, register: 25, change: 15, delete: 10 };
    const authAction = typeof action === 'string' ? action : 'unknown';
    const authBudget = AUTH_BUDGETS[authAction] ?? 20;
    // `strict` so a storage outage degrades to the per-instance limiter instead of
    // failing OPEN — this is the one endpoint where fail-open means unlimited scrypt,
    // and scrypt is ~100ms of blocking CPU per attempt on a single-threaded server.
    if (!(await enforceRateLimitKv(
        req, res, `player-auth:${authAction}`, authBudget, 15 * 60_000, undefined, { strict: true },
    ))) return;

    if (typeof name !== 'string' || !name) {
        return res.status(400).json({ ok: false, error: 'Missing name.' });
    }
    if (!safeName(name)) {
        return res.status(400).json({ ok: false, error: 'Pick a name with at least one letter or number.' });
    }
    const key = authKey(name);

    if (action === 'register') {
        // Keep this check inside the handler as well as the Railway/Express
        // route boundary so a direct serverless invocation cannot bypass the
        // emergency registration switch.
        if (newRegistrationsDisabled()) {
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
        if (typeof password !== 'string') return res.status(400).json({ ok: false, error: 'Password must be text.' });
        const passwordPolicyError = playerPasswordPolicyError(password);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });

        // Empty-slug guard: the account identity is the safeName slug. A name
        // made entirely of characters safeName strips (all emoji / punctuation)
        // collapses to '' and would write the bare `auth:` / `save:` keys.
        if (!safeName(name)) {
            return res.status(400).json({ ok: false, error: 'Pick a name with at least one letter or number.' });
        }

        // Bound the DISPLAY name. Only the derived slug was capped (safeName), so a
        // registration could store an arbitrarily long `character.name` that then
        // rendered in OTHER players' leaderboards, nameplates, chat and clan rosters —
        // breaking their layout. Rejected with a message here; the save sanitizer
        // truncates as a backstop against a tampered client.
        if (name.trim().length > TEXT_LIMITS.playerName) {
            return res.status(400).json({
                ok: false,
                error: `Names are at most ${TEXT_LIMITS.playerName} characters.`,
            });
        }

        // Names are public identity, so reject blocked terms outright instead
        // of masking them. The check normalizes common leetspeak, punctuation,
        // spacing, and repeated letters before matching.
        if (!isCleanPlayerName(name)) {
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
            // Full-admin gate — accepts the admin session token (x-admin-token)
            // or the reusable password (x-admin-password), same as every other
            // full-admin endpoint.
            if (!isFullAdmin(req)) {
                return res.status(403).json({
                    ok: false,
                    error: 'This username is reserved. Ask an admin to register it.',
                });
            }
        }

        try {
            const registrationError = await withKvLock(key, async () => {
                const existing = await kv.get<AuthRecord>(key);
                if (existing) {
                    return { status: 409, body: { ok: false, error: 'Account already has a password.' } };
                }

                // A save without an auth row is a legacy account. Only the
                // authenticated admin-reset recovery path may claim it.
                const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
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

                const sessionEpoch = await readPlayerSessionEpoch(name);
                registeredSessionEpoch = sessionEpoch;
                const salt = newSalt();
                // NX remains a final concurrency gate if a non-cooperating
                // writer races this lock or a lock lease ever expires.
                const created = await kv.set(
                    key,
                    { hash: hashPw(password, salt), salt, sessionEpoch },
                    { nx: true },
                );
                if (!created) {
                    return { status: 409, body: { ok: false, error: 'Account already has a password.' } };
                }
                return null;
            }, { failClosed: true });
            if (registrationError) {
                return res.status(registrationError.status).json(registrationError.body);
            }
            await recordBetaMetric({ event: 'account.registered', playerName: safeName(name), source: 'auth' });
        } catch (err) {
            console.error('[player-auth register]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        // Issue a session token so the client can use the cheap token path
        // immediately instead of re-sending the password (and re-running
        // scrypt server-side) on every subsequent request. null when
        // SESSION_SECRET is unset — client then keeps using the password.
        return res.status(200).json({
            ok: true,
            token: issuePlayerToken(name, undefined, registeredSessionEpoch) ?? undefined,
        });
    }

    if (action === 'verify') {
        // Verify a password. Legacy saves without a credential are recovery
        // cases, never successful authentication.
        const verificationError = playerPasswordVerificationError(password);
        if (verificationError) return res.status(400).json({ ok: false, error: verificationError });
        const verifiedPassword = password as string;
        let record: AuthRecord | null;
        try {
            record = await kv.get<AuthRecord>(key);
        } catch (err) {
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
                const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
                if (saveBlob) {
                    return res.status(409).json({
                        ok: false,
                        error: 'This legacy account requires authenticated admin recovery.',
                        legacy: true,
                        legacyNeedsAdmin: true,
                    });
                }
                return res.status(200).json({ ok: false });
            } catch (err) {
                console.error('[player-auth verify legacy]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
        }
        const valid = verifyAgainst(record, verifiedPassword);
        // Opportunistically upgrade legacy HMAC hashes to scrypt on each
        // successful verify, so the legacy format dies off over time.
        if (valid && !record.hash.startsWith(SCRYPT_PREFIX)) {
            try {
                await withKvLock(key, async () => {
                    const current = await kv.get<AuthRecord>(key);
                    if (!current || current.hash !== record.hash || current.salt !== record.salt) return;
                    const salt = newSalt();
                    await kv.set(key, { ...current, hash: hashScrypt(verifiedPassword, salt), salt });
                }, { failClosed: true });
            } catch {
                // best-effort
            }
        }
        if (!valid) return res.status(200).json({ ok: false });

        // Refuse login for banned accounts. The client surfaces this so the
        // user sees a clear "you are banned until X — reason: Y" message.
        const ban = await getActiveBan(name);
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
        void recordClientIp(name, clientIpFrom(req));
        const fp = clientFpFrom(req);
        if (fp) void recordClientFingerprint(name, fp);

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
        if (oldPasswordError) return res.status(400).json({ ok: false, error: oldPasswordError });
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
        if (safeStringEqual(oldPassword, newPassword)) {
            return res.status(400).json({ ok: false, error: 'New password must differ from the current password.' });
        }
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                if (!record) {
                    const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
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
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                const salt = newSalt();
                await kv.set(key, { hash: hashPw(newPassword, salt), salt, sessionEpoch });
                return res.status(200).json({
                    ok: true,
                    token: issuePlayerToken(name, undefined, sessionEpoch) ?? undefined,
                });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth change]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'delete') {
        // Delete the auth record when a player deletes their character.
        // Must supply either valid player password or admin authority (token or
        // password).
        if (isFullAdmin(req)) {
            try {
                await withKvLock(key, async () => {
                    await rotatePlayerSessionEpoch(name);
                    await kv.del(key);
                }, { failClosed: true });
            } catch (err) {
                console.error('[player-auth delete]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
            return res.status(200).json({ ok: true });
        }
        if (typeof password !== 'string' || !password) {
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        }
        const verificationError = playerPasswordVerificationError(password);
        if (verificationError) return res.status(400).json({ ok: false, error: verificationError });
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                if (!record) {
                    return res.status(404).json({ ok: false, error: 'Account does not exist.' });
                }
                if (!verifyAgainst(record, password)) {
                    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
                }
                await rotatePlayerSessionEpoch(name);
                await kv.del(key);
                return res.status(200).json({ ok: true });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth delete]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'adminreset') {
        // Admin sets a player's password to a new value (e.g. for account recovery).
        // Full-admin gate — accepts the admin session token or the password.
        if (!isFullAdmin(req)) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        if (!newPassword) return res.status(400).json({ ok: false, error: 'Missing newPassword.' });
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
        try {
            await withKvLock(key, async () => {
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                const salt = newSalt();
                await kv.set(key, { hash: hashPw(newPassword, salt), salt, sessionEpoch });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth adminreset]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
