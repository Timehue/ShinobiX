/**
 * Complete removal of one player account and the rows that point back at it.
 *
 * Underscore-prefixed: shared helper, not a route.
 *
 * Deleting `auth:` and `save:` is the easy half. The half that matters is
 * everything ELSE that names the slug, because those rows live on other
 * players' records: a clan roster still counting a departed member, a
 * moderation reverse-index whose 50-name cap is filling up with the dead. Left
 * alone they are invisible to the player who left and a slow problem for
 * everyone still here.
 *
 * NOTE ON THE BILLING SIDE: a live Tebex subscription belongs to the account,
 * not to the save, and Tebex knows nothing about a deletion here. Left alone,
 * someone who deletes their account keeps being charged monthly for a game they
 * no longer have. deletePlayerAccount therefore cancels it BEFORE removing the
 * save — the save holds the only copy of the reference. A cancellation that
 * fails never blocks the deletion (that right is not negotiable), but it is
 * parked in an operator list rather than lost with the record.
 *
 * NOTE ON THE SESSION EPOCH: this deliberately rotates `auth-session:<slug>`
 * rather than deleting it. That key is the only revocation state for issued
 * tokens, and a missing key reads as epoch 0 — so deleting it would let a token
 * minted before the deletion authenticate as whoever registers the freed name
 * next. Rotating leaves a tiny integer behind and closes that door.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { withKvLock } from './_lock.js';
import { rotatePlayerSessionEpoch } from './_auth.js';
import { authKey, googleIdentityKey, type AuthRecord } from './player-auth.js';
import { recoveryCodeKey } from './_recovery-code.js';
import { REGISTRY_KEY } from './player/_public-index.js';
import { clanSlugBare } from './clan/_kick-core.js';
import { cancelSubscriptionForDeletedAccount } from './tebex/_cancel-subscription.js';

export type DeletePlayerAccountResult = {
    name: string;
    /** Which of the account's own rows were present and removed. */
    removed: string[];
    /** Rows belonging to OTHER records that referenced this player. */
    detached: string[];
    /** Non-fatal problems; deletion continues past each of them. */
    failures: string[];
};

type ClanRecord = {
    members?: Array<Record<string, unknown>>;
    roleOverrides?: Record<string, string>;
    joinRequests?: Array<Record<string, unknown>>;
};

/** Drop the player from any clan roster, join queue, or role table naming them. */
async function detachFromClan(slug: string, clanName: string, result: DeletePlayerAccountResult): Promise<void> {
    const clanSlug = clanSlugBare(clanName);
    if (!clanSlug) return;
    const clanKey = `save:clan-${clanSlug}`;
    try {
        await withKvLock(clanKey, async () => {
            const record = await kv.get<ClanRecord>(clanKey);
            if (!record) return;

            const named = (entry: unknown): boolean => {
                if (!entry || typeof entry !== 'object') return false;
                return safeName(String((entry as { name?: unknown }).name ?? '')) === slug;
            };
            const members = Array.isArray(record.members) ? record.members : [];
            const joinRequests = Array.isArray(record.joinRequests) ? record.joinRequests : [];
            const nextMembers = members.filter((m) => !named(m));
            const nextRequests = joinRequests.filter((r) => !named(r));
            const nextRoles = { ...(record.roleOverrides ?? {}) };
            const hadRole = Object.prototype.hasOwnProperty.call(nextRoles, slug);
            delete nextRoles[slug];

            if (nextMembers.length === members.length && nextRequests.length === joinRequests.length && !hadRole) return;
            await kv.set(clanKey, {
                ...record,
                members: nextMembers,
                joinRequests: nextRequests,
                roleOverrides: nextRoles,
            });
            result.detached.push(clanKey);
        }, { failClosed: true });
    } catch (err) {
        result.failures.push(`clan ${clanSlug}: ${(err as Error).message}`);
    }
}

/**
 * Remove the slug from the moderation reverse indexes it appears in.
 *
 * This is the cleanup that actually matters for anti-cheat. `mod:by-ip:<ip>`
 * and `mod:by-fp:<fp>` are capped name lists (MAX_NAMES_PER_IP), so dead
 * accounts left in them evict LIVE players from alt-detection — and a stream of
 * swept guest accounts would do exactly that.
 */
async function detachFromModerationIndexes(slug: string, result: DeletePlayerAccountResult): Promise<void> {
    // Forward records are `{ lastIp, ips: [] }` and `{ lastFp, fps: [] }`
    // respectively — see recordClientIp / recordClientFingerprint.
    const sources: { forwardKey: string; reversePrefix: string; field: 'ips' | 'fps' }[] = [
        { forwardKey: `mod:ip:${slug}`, reversePrefix: 'mod:by-ip', field: 'ips' },
        { forwardKey: `mod:fp:${slug}`, reversePrefix: 'mod:by-fp', field: 'fps' },
    ];
    for (const { forwardKey, reversePrefix, field } of sources) {
        try {
            const forward = await kv.get<{ ips?: string[]; fps?: string[] }>(forwardKey);
            const values = forward?.[field] ?? [];
            for (const value of Array.isArray(values) ? values : []) {
                const reverseKey = `${reversePrefix}:${value}`;
                const names = await kv.get<string[]>(reverseKey);
                if (!Array.isArray(names) || !names.some((n) => safeName(n) === slug)) continue;
                const next = names.filter((n) => safeName(n) !== slug);
                if (next.length) await kv.set(reverseKey, next);
                else await kv.del(reverseKey);
                result.detached.push(reverseKey);
            }
            if (await kv.del(forwardKey)) result.removed.push(forwardKey);
        } catch (err) {
            result.failures.push(`${forwardKey}: ${(err as Error).message}`);
        }
    }
}

/**
 * Detach every row that POINTS AT a player, without touching the player's own
 * `auth:` / `save:` records.
 *
 * Split out from full deletion because the two are not the same operation. The
 * `DELETE /api/save/:name` path removes a character and must run this; the
 * `player-auth` `delete` action is narrower — the admin "clear auth lock" tool
 * uses it to free a stuck credential so someone can re-register, explicitly
 * KEEPING their save — so it must not.
 *
 * Moderation *state* (`mod:ban:` / `mod:silence:`) is deliberately left alone:
 * it outlives resets by design, so a ban is not something you can shed by
 * deleting your character.
 */
export async function detachPlayerReferences(rawName: string): Promise<DeletePlayerAccountResult> {
    const slug = safeName(rawName);
    const result: DeletePlayerAccountResult = { name: slug, removed: [], detached: [], failures: [] };
    if (!slug) {
        result.failures.push('empty slug');
        return result;
    }

    let clanName = '';
    let save: unknown = null;
    try {
        save = await kv.get<{ character?: { clan?: unknown } }>(`save:${slug}`);
        clanName = String((save as { character?: { clan?: unknown } } | null)?.character?.clan ?? '');
    } catch (err) {
        result.failures.push(`save:${slug} read: ${(err as Error).message}`);
    }

    // Cancel the billing relationship while the save still exists — it holds
    // the only copy of the subscription reference, and every deletion path runs
    // through here. A failure is parked for an operator, never fatal: the right
    // to delete an account does not depend on a third party being reachable.
    try {
        const note = await cancelSubscriptionForDeletedAccount(slug, save);
        // Silent for the overwhelming majority who never subscribed.
        if (note) result.detached.push(note);
    } catch (err) {
        result.failures.push(`tebex subscription: ${(err as Error).message}`);
    }

    for (const socialKey of [`friends:${slug}`, `player-friends:${slug}`]) {
        try {
            if (await kv.del(socialKey)) result.removed.push(socialKey);
        } catch (err) {
            result.failures.push(`${socialKey}: ${(err as Error).message}`);
        }
    }

    if (clanName) await detachFromClan(slug, clanName, result);
    await detachFromModerationIndexes(slug, result);
    return result;
}

/**
 * Delete an account outright — its own records plus every back-reference.
 * Used by the guest sweep; see detachPlayerReferences for why the interactive
 * paths compose the halves themselves rather than calling this.
 */
export async function deletePlayerAccount(rawName: string): Promise<DeletePlayerAccountResult> {
    const slug = safeName(rawName);
    const result: DeletePlayerAccountResult = { name: slug, removed: [], detached: [], failures: [] };
    if (!slug) {
        result.failures.push('empty slug');
        return result;
    }

    const saveKey = `save:${slug}`;
    // Detach FIRST: reading the save is how the clan is discovered AND how the
    // Tebex subscription is cancelled, and this deletes that save a few lines
    // below.
    const detached = await detachPlayerReferences(slug);
    result.removed.push(...detached.removed);
    result.detached.push(...detached.detached);
    result.failures.push(...detached.failures);

    try {
        await withKvLock(authKey(slug), async () => {
            const record = await kv.get<AuthRecord>(authKey(slug));
            // Rotate, never delete — see the note at the top of this file.
            await rotatePlayerSessionEpoch(slug);
            if (await kv.del(authKey(slug))) result.removed.push(authKey(slug));
            if (record?.google?.sub) {
                const identityKey = googleIdentityKey(record.google.sub);
                if (await kv.del(identityKey)) result.removed.push(identityKey);
            }
            // The recovery code has to go with the account. Slugs are reusable,
            // so a surviving `auth-recovery:<slug>` is a working credential to
            // whoever registers this name next — see _recovery-code.ts.
            if (await kv.del(recoveryCodeKey(slug))) result.removed.push(recoveryCodeKey(slug));
        }, { failClosed: true });
    } catch (err) {
        result.failures.push(`${authKey(slug)}: ${(err as Error).message}`);
    }

    try {
        if (await kv.del(saveKey)) result.removed.push(saveKey);
        await kv.hdel(REGISTRY_KEY, slug);
        result.detached.push(`${REGISTRY_KEY}[${slug}]`);
    } catch (err) {
        result.failures.push(`${saveKey}: ${(err as Error).message}`);
    }

    return result;
}
