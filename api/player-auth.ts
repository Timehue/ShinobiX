import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import crypto from 'crypto';

// `hash` stores either the legacy HMAC-SHA256 hex (no version prefix) or the
// new scrypt format `scrypt:N:r:p:hex`. New writes always use scrypt.
type AuthRecord = { hash: string; salt: string };

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
    return `auth:${name.trim().toLowerCase()}`;
}

export async function verifyPlayerPassword(name: string, password: string): Promise<boolean> {
    const record = await kv.get<AuthRecord>(authKey(name));
    if (!record) return false;
    const ok = verifyAgainst(record, password);
    // Opportunistically migrate legacy hashes to scrypt on successful login.
    if (ok && !record.hash.startsWith(SCRYPT_PREFIX)) {
        try {
            const salt = newSalt();
            await kv.set(authKey(name), { hash: hashScrypt(password, salt), salt });
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

    // Rate-limit auth actions by IP: 20 attempts per 15 minutes. KV-backed so
    // attackers can't hop serverless instances to reset the counter.
    if (!(await enforceRateLimitKv(req, res, 'player-auth', 20, 15 * 60_000))) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, name, password, oldPassword, newPassword } = body as {
        action?: string;
        name?: string;
        password?: string;
        oldPassword?: string;
        newPassword?: string;
    };

    if (!name) return res.status(400).json({ ok: false, error: 'Missing name.' });
    const key = authKey(name);

    if (action === 'register') {
        // Register a new password. Fails if one already exists — use 'change' to update.
        if (!password) return res.status(400).json({ ok: false, error: 'Missing password.' });
        try {
            const existing = await kv.get<AuthRecord>(key);
            if (existing) return res.status(409).json({ ok: false, error: 'Account already has a password.' });

            // Legacy-account takeover defense: if a save:<name> blob already
            // exists but no auth:<name> record was ever created, refuse the
            // registration. Otherwise anyone who saw a player's name on the
            // leaderboard could call register and claim that account.
            // Legitimate legacy reclaim still works via the admin reset flow
            // (action='adminreset' with x-admin-password).
            const saveBlob = await kv.get<Record<string, unknown>>(`save:${name.trim().toLowerCase()}`);
            if (saveBlob) {
                return res.status(409).json({
                    ok: false,
                    error: 'This account is a legacy account without a server password. Ask an admin to set it for you.',
                    legacyNeedsAdmin: true,
                });
            }

            const salt = newSalt();
            await kv.set(key, { hash: hashPw(password, salt), salt });
        } catch (err) {
            console.error('[player-auth register]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }

    if (action === 'verify') {
        // Verify a password. Returns { ok: true } on match, { ok: false } on mismatch,
        // or { ok: true, legacy: true } if no server password exists yet (legacy account).
        if (!password) return res.status(400).json({ ok: false, error: 'Missing password.' });
        let record: AuthRecord | null;
        try {
            record = await kv.get<AuthRecord>(key);
        } catch (err) {
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
                await kv.set(key, { hash: hashScrypt(password, salt), salt });
            } catch {
                // best-effort
            }
        }
        if (!valid) return res.status(200).json({ ok: false });
        return res.status(200).json({ ok: true });
    }

    if (action === 'change') {
        // Change password — requires old password.
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
        }
        try {
            const record = await kv.get<AuthRecord>(key);
            if (!record) {
                // Legacy account with no password yet — just set it.
                const salt = newSalt();
                await kv.set(key, { hash: hashPw(newPassword, salt), salt });
                return res.status(200).json({ ok: true });
            }
            if (!verifyAgainst(record, oldPassword)) {
                return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
            }
            const salt = newSalt();
            await kv.set(key, { hash: hashPw(newPassword, salt), salt });
            return res.status(200).json({ ok: true });
        } catch (err) {
            console.error('[player-auth change]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'delete') {
        // Delete the auth record when a player deletes their character.
        // Must supply either valid player password or admin password.
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'] as string | undefined;
        if (adminPassword && adminPw && safeStringEqual(adminPw, adminPassword)) {
            try {
                await kv.del(key);
            } catch (err) {
                console.error('[player-auth delete]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
            return res.status(200).json({ ok: true });
        }
        if (!password) return res.status(401).json({ ok: false, error: 'Authentication required.' });
        try {
            const record = await kv.get<AuthRecord>(key);
            if (record && !verifyAgainst(record, password)) {
                return res.status(401).json({ ok: false, error: 'Incorrect password.' });
            }
            await kv.del(key);
        } catch (err) {
            console.error('[player-auth delete]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }

    if (action === 'adminreset') {
        // Admin sets a player's password to a new value (e.g. for account recovery).
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'] as string | undefined;
        if (!adminPassword || !adminPw || !safeStringEqual(adminPw, adminPassword)) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        if (!newPassword) return res.status(400).json({ ok: false, error: 'Missing newPassword.' });
        try {
            const salt = newSalt();
            await kv.set(key, { hash: hashPw(newPassword, salt), salt });
        } catch (err) {
            console.error('[player-auth adminreset]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
