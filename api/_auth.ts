/**
 * Shared authentication helpers.
 *
 * Two trust levels:
 *   - player:  x-player-name + x-player-password headers must verify
 *   - admin:   x-admin-password header must equal process.env.ADMIN_PASSWORD
 *
 * Most game-mutating endpoints accept either (admin can do anything a player can).
 */

import { timingSafeEqual } from 'crypto';
import { verifyPlayerPassword } from './player-auth.js';
import { safeName } from './_utils.js';
import { getActiveBan } from './admin/moderation.js';

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
 * Verify the request carries a valid player password.
 * Returns the canonical lowercased name on success, null on failure.
 *
 * Accepts:
 *   - x-player-name + x-player-password (preferred)
 *   - x-player-password only when the route already implies a name
 *     (caller passes `nameFromRoute`)
 */
export async function authedPlayer(
    req: ReqLike,
    nameFromRoute?: string,
): Promise<string | null> {
    const headerName = headerString(req, 'x-player-name');
    const pw = headerString(req, 'x-player-password');
    if (!pw) return null;
    const name = headerName || nameFromRoute || '';
    if (!name) return null;
    const canonical = name.trim().toLowerCase();
    try {
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
    const a = identity.name;
    const b = safeName(bodyName) || bodyName.trim().toLowerCase();
    return a === b || a === bodyName.trim().toLowerCase();
}
