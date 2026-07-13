/**
 * Shared authentication helpers.
 *
 * Two trust levels:
 *   - player:  x-player-token, or x-player-name + x-player-password, must verify
 *   - admin:   x-admin-password header must equal process.env.ADMIN_PASSWORD
 *
 * Most game-mutating endpoints accept either. Personal-economy endpoints may
 * intentionally require the player's own credential instead of an admin shortcut.
 */

import { timingSafeEqual, createHmac } from 'crypto';
import { verifyPlayerPassword } from './player-auth.js';
import { safeName } from './_utils.js';
import { getActiveBan } from './admin/moderation.js';
import { kv } from './_storage.js';

type ReqLike = { headers: Record<string, string | string[] | undefined> };

function headerString(req: ReqLike, key: string): string {
    const v = req.headers[key.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? '';
    return v ?? '';
}

/**
 * Constant-time comparison of two strings. Returns false on length mismatch
 * without leaking the correct length via timing.
 */
export function safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
        // Still do a compare to keep timing flat-ish.
        timingSafeEqual(ba, ba);
        return false;
    }
    return timingSafeEqual(ba, bb);
}

// ─── Revocable player session tokens ──────────────────────────────────────────
//
// The per-request scrypt password verify (~100ms of blocking CPU, see
// player-auth.ts) is too expensive for every heartbeat / move / save. A token
// replaces that work with an HMAC check plus one lightweight shared-epoch read.
//
// New token format: v2.<name>.<expEpochMs>.<sessionEpoch>.<sig>
//   sig = HMAC-SHA256(SESSION_SECRET, "<name>.<expEpochMs>.<sessionEpoch>")
// Legacy v1 tokens remain valid only while the account epoch is still zero.
// The epoch is shared revocation state; passwords are never stored in it.
// The existing per-request ban check remains an independent immediate gate.
//
// SESSION_SECRET is a master key: anyone holding it can forge a token for any
// player. It MUST be a high-entropy env var set on BOTH cPanel (.env) and
// Vercel, and never committed. If unset, token issuing/verifying is disabled
// and the system transparently falls back to the password path (no outage,
// just no speedup until the secret is configured).

const TOKEN_VERSION = 'v2';
const LEGACY_TOKEN_VERSION = 'v1';
// 24h. Survives any single PvP fight (≤15min sessions) with margin; the client
// silently re-mints from the stored password on the rare expiry-mid-session.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function sessionSecret(): string | null {
    const s = process.env.SESSION_SECRET;
    return s && s.length > 0 ? s : null;
}

function b64url(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64url');
}
function unb64url(s: string): string {
    return Buffer.from(s, 'base64url').toString('utf8');
}

function signToken(canonicalName: string, expMs: number, sessionEpoch: number, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${canonicalName}.${expMs}.${sessionEpoch}`)
        .digest('base64url');
}

function signLegacyToken(canonicalName: string, expMs: number, secret: string): string {
    return createHmac('sha256', secret)
        .update(`${canonicalName}.${expMs}`)
        .digest('base64url');
}

/** Shared storage key for an account's revocable session epoch. */
export function playerSessionEpochKey(name: string): string {
    return `auth-session:${safeName(name)}`;
}

function parseSessionEpoch(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
        throw new Error('Invalid player session epoch.');
    }
    return epoch;
}

/** Read the current per-account epoch. Missing keys are legacy epoch 0. */
export async function readPlayerSessionEpoch(name: string): Promise<number> {
    return parseSessionEpoch(await kv.get<unknown>(playerSessionEpochKey(name)));
}

/** Atomically revoke existing tokens and return the new epoch. */
export async function rotatePlayerSessionEpoch(name: string): Promise<number> {
    const epoch = await kv.incr(playerSessionEpochKey(name));
    return parseSessionEpoch(epoch);
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
export function issuePlayerToken(
    name: string,
    ttlMs: number = TOKEN_TTL_MS,
    sessionEpoch = 0,
): string | null {
    const secret = sessionSecret();
    if (!secret) return null;
    const canonical = safeName(name);
    if (!canonical || !Number.isSafeInteger(sessionEpoch) || sessionEpoch < 0) return null;
    const expMs = Date.now() + ttlMs;
    const sig = signToken(canonical, expMs, sessionEpoch, secret);
    return `${TOKEN_VERSION}.${b64url(canonical)}.${expMs}.${sessionEpoch}.${sig}`;
}

/**
 * Verify a session token. Returns the canonical player name on success, or
 * null if the token is missing/malformed/expired/forged/revoked, shared
 * storage is unavailable, or SESSION_SECRET is unset. Uses no scrypt.
 *
 * Does NOT check bans — authedPlayer applies the existing getActiveBan() gate
 * after this returns, so a token alone can never bypass a ban.
 */
export async function verifyPlayerToken(token: string): Promise<string | null> {
    const secret = sessionSecret();
    if (!secret) return null;
    if (!token) return null;
    const parts = token.split('.');
    const version = parts[0];
    if (version !== TOKEN_VERSION && version !== LEGACY_TOKEN_VERSION) return null;
    if (version === TOKEN_VERSION && parts.length !== 5) return null;
    if (version === LEGACY_TOKEN_VERSION && parts.length !== 4) return null;

    const nameB64 = parts[1];
    const expStr = parts[2];
    const sessionEpoch = version === TOKEN_VERSION ? Number(parts[3]) : 0;
    const sig = version === TOKEN_VERSION ? parts[4] : parts[3];
    let canonical: string;
    try {
        canonical = unb64url(nameB64);
    } catch {
        return null;
    }
    if (!canonical || canonical !== safeName(canonical)) return null;
    const expMs = Number(expStr);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
    if (!Number.isSafeInteger(sessionEpoch) || sessionEpoch < 0) return null;
    // Recompute the signature and constant-time compare. safeEqual handles
    // length mismatch without leaking via timing.
    const expected = version === TOKEN_VERSION
        ? signToken(canonical, expMs, sessionEpoch, secret)
        : signLegacyToken(canonical, expMs, secret);
    if (!safeEqual(sig, expected)) return null;

    // Fail closed on storage errors. Reading the epoch on every token-authenticated
    // request is what makes credential mutations revoke sessions immediately.
    try {
        const currentEpoch = await readPlayerSessionEpoch(canonical);
        if (currentEpoch !== sessionEpoch) return null;
        // Legacy v1 tokens predate epochs, so also require the auth record to
        // exist. Credential mutations still rotate epoch 0 immediately; this
        // extra check covers legacy rows removed by older administrative code.
        if (version === LEGACY_TOKEN_VERSION && !await kv.get<unknown>(`auth:${canonical}`)) return null;
        return canonical;
    } catch {
        return null;
    }
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
export function isFullAdmin(req: ReqLike): boolean {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided) return false;
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
export function isAdmin(req: ReqLike): boolean {
    if (isFullAdmin(req)) return true;
    const expectedContent = process.env.ADMIN_CONTENT_PASSWORD;
    if (!expectedContent) return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided) return false;
    return safeEqual(provided, expectedContent);
}

/**
 * Verify the request carries valid player credentials.
 * Returns the canonical lowercased name on success, null on failure.
 *
 * Accepts (in priority order):
 *   - x-player-token (preferred)        — revocable HMAC session token, no
 *     scrypt and one shared epoch read. Minted at login (see
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
export async function authedPlayer(
    req: ReqLike,
    nameFromRoute?: string,
): Promise<string | null> {
    try {
        // ── Fast path: revocable token (no scrypt; one epoch read) ─────────
        const token = headerString(req, 'x-player-token');
        if (token) {
            const rawTokenName = await verifyPlayerToken(token);
            if (rawTokenName) {
                // Normalize to the safeName slug so the returned identity always
                // equals the storage-key form (covers any legacy token minted
                // before the canonicalization was unified).
                const tokenName = safeName(rawTokenName);
                // If the route/header names an explicit player, the token must
                // match it — a valid token for player A cannot act as player B.
                // Canonicalize via safeName so a display name with spaces /
                // stripped chars compares equal to the slug encoded in the token.
                const claimed = safeName(headerString(req, 'x-player-name') || nameFromRoute || '');
                if (claimed && claimed !== tokenName) return null;
                // Same ban gate as the password path — bans bite immediately.
                const ban = await getActiveBan(tokenName);
                if (ban) return null;
                return tokenName;
            }
            // Token present but invalid/expired: fall through to the password
            // path so a stale token alone doesn't block a request that also
            // carries a valid password (and the client can re-mint).
        }

        // ── Slow path: scrypt password verify ──────────────────────────────
        const headerName = headerString(req, 'x-player-name');
        const pw = headerString(req, 'x-player-password');
        if (!pw) return null;
        const name = headerName || nameFromRoute || '';
        if (!name) return null;
        const canonical = safeName(name);
        if (!(await verifyPlayerPassword(canonical, pw))) return null;
        // Banned players authenticate but lose access. authedPlayer is the
        // single chokepoint for every player-only endpoint, so this one check
        // freezes the account out of every game action until the ban lifts.
        const ban = await getActiveBan(canonical);
        if (ban) return null;
        return canonical;
    } catch {
        return null;
    }
}

/**
 * Convenience: require *either* a valid player auth or admin auth.
 * Returns { admin: true } or { admin: false, name } on success, null on failure.
 */
export async function authedPlayerOrAdmin(
    req: ReqLike,
    nameFromRoute?: string,
): Promise<{ admin: true } | { admin: false; name: string } | null> {
    if (isAdmin(req)) return { admin: true };
    const name = await authedPlayer(req, nameFromRoute);
    if (name) return { admin: false, name };
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
export function bodyNameMatchesAuth(
    identity: { admin: true } | { admin: false; name: string },
    bodyName: string | undefined | null,
): boolean {
    if (identity.admin) return true;
    if (!bodyName) return false;
    // identity.name is the safeName slug (see authedPlayer), so compare the
    // body name through the same canonicalizer.
    return identity.name === safeName(bodyName);
}
