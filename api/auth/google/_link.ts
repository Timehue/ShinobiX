import { safeName } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { readPlayerSessionEpoch, rotatePlayerSessionEpoch } from '../../_auth.js';
import { withKvLock } from '../../_lock.js';
import { authKey, googleIdentityKey, synchronizeVerifiedAuthRecordEpoch, withoutGuestResumeAuthority, type AuthRecord } from '../../player-auth.js';

/*
 * Link-mode Google sign-in, split in two (2026-11-04).
 *
 * The callback used to write the link the moment Google redirected back. The
 * redirect carries no proof of WHICH browser started the flow, so an attacker
 * could start link mode on their own account, send the authorize URL to a
 * victim, and the victim's Google got attached to the attacker's shinobi: from
 * then on the victim's "Sign in with Google" opened the attacker's account.
 *
 * Now the callback only checks that the link is possible and hands back a
 * ticket. The link is written in /claim, which already requires the nonce
 * that only the starting browser holds. For a real player the screens, the
 * messages and the number of steps are unchanged.
 */

export type LinkOutcome = 'linked' | 'taken' | 'expired' | 'error';

export type LinkRequest = { name: string; epoch: number };

/** Read-only: would a link of `sub` to this account succeed right now? */
export async function precheckGoogleLink(request: LinkRequest, sub: string): Promise<Exclude<LinkOutcome, 'linked'> | 'ok'> {
    const name = safeName(request.name ?? '');
    if (!name) return 'error';
    const record = await kv.get<AuthRecord>(authKey(name));
    if (!record) return 'error';
    if ((record.sessionEpoch ?? 0) !== request.epoch) return 'expired';
    if (record.google?.sub && record.google.sub !== sub) return 'taken';
    const owner = await kv.get<{ name?: string }>(googleIdentityKey(sub));
    if (owner && safeName(owner.name ?? '') !== name) return 'taken';
    return 'ok';
}

export type LinkResult =
    | { outcome: 'linked'; name: string; sessionEpoch: number }
    | { outcome: Exclude<LinkOutcome, 'linked'> };

/** Attach the identity and return the exact credential generation committed. */
export async function linkGoogleToAccount(request: LinkRequest, identity: { sub: string; email: string }): Promise<LinkResult> {
    const name = safeName(request.name ?? '');
    if (!name) return { outcome: 'error' };

    // All Google writers use account -> subject lock order, including signup,
    // dangling-index cleanup and deletion. NX still enforces unique ownership.
    return await withKvLock(authKey(name), () => withKvLock(googleIdentityKey(identity.sub), async (): Promise<LinkResult> => {
        const record = await kv.get<AuthRecord>(authKey(name));
        if (!record) return { outcome: 'error' };
        // Revocation can happen while we wait for the lock. Check both records
        // here, before claiming the identity or changing credentials.
        if ((record.sessionEpoch ?? 0) !== request.epoch
            || await readPlayerSessionEpoch(name) !== request.epoch) return { outcome: 'expired' };
        if (record.google?.sub && record.google.sub !== identity.sub) return { outcome: 'taken' };

        const claimed = await kv.set(
            googleIdentityKey(identity.sub),
            { name },
            { nx: true },
        );
        if (!claimed) {
            // Someone already holds this Google account. Re-linking the same
            // pair is fine and idempotent; anything else is a genuine conflict.
            const owner = await kv.get<{ name?: string }>(googleIdentityKey(identity.sub));
            if (safeName(owner?.name ?? '') !== name) return { outcome: 'taken' };
        }

        // Linking Google is exactly how a guest account stops being disposable:
        // it now has a real owner and a way back in.
        const { guest, ...kept } = withoutGuestResumeAuthority(record);
        const now = Date.now();
        const linkedRecord: AuthRecord = {
            ...kept,
            google: { sub: identity.sub, email: identity.email, linkedAt: now, lastAuthAt: now },
        };

        // Claiming a guest rotates the epoch. The long-lived credential that let
        // an anonymous browser hold the account must not survive the account
        // acquiring a real owner; the claim endpoint hands back a fresh token.
        if (guest) linkedRecord.sessionEpoch = await rotatePlayerSessionEpoch(name);

        try {
            await kv.set(authKey(name), linkedRecord);
        } catch (err) {
            const committed = await kv.get<AuthRecord>(authKey(name));
            if (claimed && committed?.google?.sub !== identity.sub) {
                await kv.delIfEqual(googleIdentityKey(identity.sub), { name });
            }
            // The signed link state proved this guest before its epoch was
            // rotated. If publication failed without changing the auth row,
            // keep its existing resume door usable at the new revoked epoch.
            if (guest && committed && JSON.stringify(committed) === JSON.stringify(record)) {
                await synchronizeVerifiedAuthRecordEpoch(name, committed);
            }
            throw err;
        }
        return { outcome: 'linked', name, sessionEpoch: linkedRecord.sessionEpoch ?? 0 };
    }, { failClosed: true }), { failClosed: true });
}
