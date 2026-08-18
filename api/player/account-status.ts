import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { AccountStatusResponse } from '../../shared/account-status.js';
import { authedPlayer } from '../_auth.js';
import { authKey, isCredentialLessGuest, isPasswordlessRecord, type AuthRecord } from '../player-auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { guestSocialLockEnabled } from '../_guest-gate.js';

/**
 * The caller's own account standing: guest or claimed, Google-linked or not,
 * and whether the tavern and message channels are shut for them.
 *
 * The client cannot work this out for itself. Its only guest signal today is
 * `shinobix:guestName` in localStorage, which is browser-local (wrong on any
 * other device) and player-editable (wrong on purpose). Screens that show a
 * lock must agree with the endpoints that enforce it, so the same server-side
 * predicate answers both — see `api/_guest-gate.ts`.
 *
 * Deliberately not folded into `player/capabilities`: that one is
 * unauthenticated world state, and per-account fields have no business there.
 * Deliberately not folded into the heartbeat either: this is fetched once per
 * session, and the heartbeat is the hottest endpoint in the game.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    // Session-scoped read, refreshed after a Google link. Sized for a shared
    // NAT, well above what one client needs.
    if (!enforceRateLimit(req, res, 'player-account-status', 120, 60_000)) return;

    // Player credentials only. An admin has no "own account" here, and
    // authedPlayerOrAdmin would resolve an admin-only request to `{admin:true}`
    // with no name to report on.
    const name = await authedPlayer(req);
    if (!name) return res.status(401).json({ error: 'Authentication required.' });

    let record: AuthRecord | null;
    try {
        record = await kv.get<AuthRecord>(authKey(name));
    } catch (err) {
        // Never guess. A wrong "you are locked" would strand a real account out
        // of chat; a wrong "you are free" would show a guest controls that the
        // server then rejects. The client keeps its previous answer on 503.
        console.error('[player-account-status]', String(err));
        return res.status(503).json({ error: 'Storage unavailable. Try again.' });
    }

    // `isPasswordlessRecord(null)` is false, so guard the missing record
    // explicitly rather than reporting a password on an account with no record.
    const hasPassword = !!record && !isPasswordlessRecord(record);
    const body: AccountStatusResponse = {
        ok: true,
        account: {
            name,
            guest: record?.guest === true,
            google: !!record?.google,
            hasPassword,
            // The same predicate the endpoints and the guest sweep use, rather
            // than a local re-derivation that could drift from either.
            socialLocked: isCredentialLessGuest(record) && guestSocialLockEnabled(),
        },
    };
    return res.status(200).json(body);
}
