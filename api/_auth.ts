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
 * Verify the request carries a valid admin password.
 * Accepts header `x-admin-password`. Constant-time compare.
 */
export function isAdmin(req: ReqLike): boolean {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return false;
    const provided = headerString(req, 'x-admin-password');
    if (!provided) return false;
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
        return (await verifyPlayerPassword(canonical, pw)) ? canonical : null;
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
