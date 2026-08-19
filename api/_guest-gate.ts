/**
 * Guest characters are shut out of the tavern and every player-to-player
 * message channel until the account becomes a real one.
 *
 * A guest is created anonymously, three per hour per browser fingerprint, with
 * no credential of any kind — which makes it the cheapest possible spam and
 * harassment vehicle on every surface that shows one player's free text to
 * another. The lock exists to make that throwaway account cost something, so it
 * lifts the moment the account gains a real credential. There are two doors and
 * either one is enough:
 *
 *   - **Link Google** — clears the `guest` flag outright
 *     (`api/auth/google/callback.ts`).
 *   - **Set a password** — `player-auth` action `change` deliberately spreads
 *     the existing record, so `guest: true` SURVIVES. That is why the predicate
 *     below is guest AND passwordless, not the `guest` flag alone: someone who
 *     set a password has an account they can be held to and re-enter from
 *     anywhere, which is the whole point of the gate.
 *
 * This predicate is shared with the 14-day guest sweep (`api/cron/_guest-sweep.ts`),
 * both reading `isCredentialLessGuest` in `player-auth.ts` — a guest who sets a
 * password is exempt from both the tavern lock and the sweep, never just one.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { authKey, isCredentialLessGuest, type AuthRecord } from './player-auth.js';

/** Machine-readable rejection code, so clients can render the lock rather than a raw error. */
export const GUEST_SOCIAL_ERROR_CODE = 'guest-account-unclaimed';

export const GUEST_SOCIAL_ERROR =
    'Guest characters cannot use the tavern or send messages. Link a Google account or set a password to unlock them.';

/**
 * Ships on. `DISABLE_GUEST_SOCIAL_LOCK=1` is the emergency switch that reopens
 * every gated surface at once — the same switch feeds `socialLocked` in the
 * account-status response, so throwing it also unlocks the UI.
 */
export function guestSocialLockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_GUEST_SOCIAL_LOCK !== '1';
}

/**
 * True when this account is still a credential-less guest. Ignores the kill
 * switch. The predicate itself lives beside `AuthRecord` in `player-auth.ts`,
 * shared with the guest sweep so the two can never disagree.
 */
export async function isUnclaimedGuest(name: string): Promise<boolean> {
    const slug = safeName(name);
    if (!slug) return false;
    return isCredentialLessGuest(await kv.get<AuthRecord>(authKey(slug)));
}

/**
 * Whether this account's social surfaces are locked right now.
 *
 * Fails OPEN on a storage error, and this is deliberate. The failure modes are
 * asymmetric: failing closed would silence every player's chat during a
 * Supabase blip (the record read cannot distinguish "not a guest" from "could
 * not tell"), whereas failing open lets an unclaimed guest post for the length
 * of the outage. This is an anti-spam gate, not a currency path, so the
 * reversible failure is the right one — contrast `withKvLock({failClosed})` on
 * treasury writes, where the unrecoverable failure is the other way round.
 */
export async function socialSurfacesLocked(name: string): Promise<boolean> {
    if (!guestSocialLockEnabled()) return false;
    try {
        return await isUnclaimedGuest(name);
    } catch (err) {
        console.error('[guest-gate] auth record read failed; allowing:', String(err));
        return false;
    }
}

type JsonResponder = { status(code: number): { json(body: unknown): unknown } };

type Identity = { admin: true } | { admin: false; name: string };

/**
 * Reject an unclaimed guest on a social endpoint.
 *
 * Returns true when it has already answered the request — callers must return
 * immediately. Admins are never gated, matching every other moderation bypass
 * in the chat handlers.
 */
export async function rejectUnclaimedGuest(res: JsonResponder, identity: Identity): Promise<boolean> {
    if (identity.admin) return false;
    if (!await socialSurfacesLocked(identity.name)) return false;
    res.status(403).json({
        error: GUEST_SOCIAL_ERROR,
        errorCode: GUEST_SOCIAL_ERROR_CODE,
        guestLocked: true,
    });
    return true;
}
