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
import { authKey, googleIdentityKey, releaseGoogleIdentityForAccount, type AuthRecord } from './player-auth.js';
import { recoveryCodeKey } from './_recovery-code.js';
import { currencyLedgerKey } from './_currency-ledger.js';
import { REGISTRY_KEY } from './player/_public-index.js';
import { clanSlugBare } from './clan/_kick-core.js';
import { applyClanSuccession, resolveEligibleClanSuccession } from './clan/_succession.js';
import { cancelSubscriptionForDeletedAccount } from './tebex/_cancel-subscription.js';
import { IMG_OWNER_PREFIX, removeStoredImages, storedImageExists } from './images.js';

export type DeletePlayerAccountResult = {
    name: string;
    /** Which of the account's own rows were present and removed. */
    removed: string[];
    /** Rows belonging to OTHER records that referenced this player. */
    detached: string[];
    /** Cleanup problems. Protected teardown failures retain auth for a retry. */
    failures: string[];
};

/** Remove First Pact progress that belongs to one canonical player slug.
 *
 * First Pact lives outside `save:<slug>`, so every path that destroys the
 * character must compose this cleanup explicitly. The exact key prevents an
 * account deletion from touching another player's crossing. */
export async function deletePlayerFirstPactState(rawName: string): Promise<string | null> {
    const slug = safeName(rawName);
    if (!slug) return null;
    const key = `first-pact:${slug}`;
    return withKvLock(key, async () => await kv.del(key) ? key : null, { failClosed: true });
}

type ClanRecord = {
    founderName?: string;
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
            const nextRequests = joinRequests.filter((r) => !named(r));
            // A departing founder hands the clan on exactly as Leave does
            // (clan/_succession.ts). Deletion used to drop them from the roster
            // but keep `founderName`, so nobody could dissolve the clan,
            // distribute its seal pool or run any other founder-only action.
            const succession = await resolveEligibleClanSuccession(record, slug);
            const next = applyClanSuccession(record, slug, succession);
            const rolesBefore = Object.keys(record.roleOverrides ?? {}).length;

            if (next.members.length === members.length
                && nextRequests.length === joinRequests.length
                && Object.keys(next.roleOverrides).length === rolesBefore
                && succession.kind !== 'succeeded') return;
            await kv.set(clanKey, {
                ...record,
                members: next.members,
                joinRequests: nextRequests,
                roleOverrides: next.roleOverrides,
                ...(succession.kind === 'succeeded' ? { founderName: next.founderName } : {}),
            });
            result.detached.push(clanKey);
            // `founderName` is the authority every founder gate reads; the
            // successor's `clanFounder` hint self-corrects on their next clan load.
        }, { failClosed: true });
    } catch (err) {
        result.failures.push(`clan ${clanSlug}: ${(err as Error).message}`);
    }
}

/**
 * Remove the slug from the moderation reverse indexes it appears in.
 *
 * This is the cleanup that actually matters for anti-cheat. `mod:by-ip-v2:<ip>`
 * and `mod:by-fp:<fp>` are capped name lists (MAX_NAMES_PER_IP), so dead
 * accounts left in them evict LIVE players from alt-detection — and a stream of
 * swept guest accounts would do exactly that.
 */
async function detachFromModerationIndexes(slug: string, result: DeletePlayerAccountResult): Promise<void> {
    // Forward records are `{ lastIp, ips: [] }` and `{ lastFp, fps: [] }`
    // respectively — see recordClientIp / recordClientFingerprint.
    const sources: { forwardKey: string; reversePrefix: string; field: 'ips' | 'fps' }[] = [
        { forwardKey: `mod:ip:${slug}`, reversePrefix: 'mod:by-ip', field: 'ips' },
        { forwardKey: `mod:ip-v2:${slug}`, reversePrefix: 'mod:by-ip-v2', field: 'ips' },
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
 * Release the shared rows that hold value or standing for the player and need
 * a settlement rather than a plain delete. Each runs while the save still
 * exists, so anything owed to or by the departing player can still settle.
 * The modules load lazily: they pull in the save pipeline, which this
 * module's importers must not depend on.
 *
 *  - Sunscar Exchange: in-flight trades finish, the player's open listings are
 *    voided, a standing high bid is withdrawn, and the player index goes.
 *  - PvP bounty board: the head on the player comes down and every backer is
 *    refunded their stake through the claim payout's save receipts.
 *  - Elder and ANBU seats, in every village (Kage seats are handled above).
 */
async function releaseSettledPlayerRows(slug: string, result: DeletePlayerAccountResult): Promise<void> {
    try {
        const { settleExchangeForDeletedPlayer } = await import('./festival/_exchange.js');
        const exchange = await settleExchangeForDeletedPlayer(slug);
        for (const id of exchange.closed) result.detached.push(`sunscar-exchange:listing:${id}`);
        result.failures.push(...exchange.failures);
    } catch (err) {
        result.failures.push(`sunscar exchange: ${(err as Error).message}`);
    }
    try {
        const { refundBountyOnDeletedTarget } = await import('./pvp/_bounty-deleted-target.js');
        const bounty = await refundBountyOnDeletedTarget(slug);
        if (bounty.removedHead) result.detached.push(`pvp:bounties[${slug}]`);
        result.failures.push(...bounty.failures);
    } catch (err) {
        result.failures.push(`pvp bounty: ${(err as Error).message}`);
    }
    try {
        const [{ clearAppointments }, { WAR_VILLAGES }] = await Promise.all([
            import('./village/_clear-appointments.js'),
            import('./_war-map-sectors.js'),
        ]);
        for (const village of WAR_VILLAGES) {
            if (await clearAppointments(village, slug)) result.detached.push(`village-seats:${village}`);
        }
    } catch (err) {
        result.failures.push(`village seats: ${(err as Error).message}`);
    }
}

/** Values read per batch while looking for the player's image claims. */
const IMAGE_CLAIM_READ_CHUNK = 200;

/**
 * Release the shared-image rows that name the player (2026-10-15 audit M7).
 * Slugs are reusable, so whoever registers this name next would otherwise
 * inherit them: the avatar `avatar:<name>` (still served, by name, to everyone),
 * every `img-owner:` claim held by the slug (which let the newcomer replace the
 * departed player's bloodline / jutsu / gear art), and the old misc upload
 * counter.
 *
 * The avatar goes through the admin delete path (removeStoredImages): its R2
 * copy, legacy fields, own row, claim, metadata and a version bump, so no
 * cached immutable URL keeps serving it. Only an avatar that exists is
 * removed, so an account without one does not re-key every player's avatar.
 *
 * The claims are found by a keys-only scan of `img-owner:*` plus batched reads
 * of those small values. That is one read of every claim per deletion, which
 * is acceptable because deletion is rare and the claim count is bounded by
 * uploads; it is never on a request path. Each claim is removed with a
 * compare-and-delete, so a claim another player took meanwhile survives.
 */
async function releasePlayerImages(slug: string, save: unknown, result: DeletePlayerAccountResult): Promise<void> {
    // The client publishes `avatar:<display name, lowercased>`, which can differ
    // from the slug (a name with a space); the server accepts both forms.
    const avatarIds = new Set([`avatar:${slug}`]);
    const displayName = (save as { character?: { name?: unknown } } | null)?.character?.name;
    if (typeof displayName === 'string' && safeName(displayName) === slug) avatarIds.add(`avatar:${displayName.toLowerCase()}`);
    try {
        const present: string[] = [];
        for (const id of avatarIds) if (await storedImageExists(id) !== false) present.push(id);
        if (present.length) {
            const { removed, failed } = await removeStoredImages(present, 'account-deletion');
            result.removed.push(...removed.map((id) => `shared:img:${id}`));
            result.failures.push(...failed.map(({ id, reason }) => `${id}: ${reason}`));
        }
    } catch (err) {
        result.failures.push(`avatar:${slug}: ${(err as Error).message}`);
    }

    const miscCounterKey = `upload:misc-count:${slug}`;
    try {
        if (await kv.del(miscCounterKey)) result.removed.push(miscCounterKey);
    } catch (err) {
        result.failures.push(`${miscCounterKey}: ${(err as Error).message}`);
    }

    try {
        const claimKeys = (await kv.keys(`${IMG_OWNER_PREFIX}*`)).filter((key) => key.startsWith(IMG_OWNER_PREFIX));
        for (let i = 0; i < claimKeys.length; i += IMAGE_CLAIM_READ_CHUNK) {
            const chunk = claimKeys.slice(i, i + IMAGE_CLAIM_READ_CHUNK);
            const owners = await kv.mget<unknown[]>(...chunk);
            for (const [index, key] of chunk.entries()) {
                if (owners[index] !== slug) continue;
                if (await kv.delIfEqual(key, slug)) result.detached.push(key);
            }
        }
    } catch (err) {
        result.failures.push(`${IMG_OWNER_PREFIX}* claims: ${(err as Error).message}`);
    }
}

/**
 * Free every login name the account reserved (`account-name:<name>` → slug,
 * api/player/account-name.ts). Registration refuses a reserved name, so a
 * deleted account used to lock its login name, and every name it renamed
 * away from, out of registration forever. Same shape as the image-claim
 * release: a keys-only scan, batched reads, and a compare-and-delete so a
 * name another account holds is never touched. A freed reservation cannot
 * sign anyone in: login also requires the committed save to carry the name,
 * and the session epoch is rotated by the deletion.
 */
async function releaseAccountNames(slug: string, result: DeletePlayerAccountResult): Promise<void> {
    try {
        const keys = (await kv.keys('account-name:*')).filter((key) => key.startsWith('account-name:'));
        for (let i = 0; i < keys.length; i += IMAGE_CLAIM_READ_CHUNK) {
            const chunk = keys.slice(i, i + IMAGE_CLAIM_READ_CHUNK);
            const owners = await kv.mget<unknown[]>(...chunk);
            for (const [index, key] of chunk.entries()) {
                if (typeof owners[index] !== 'string' || safeName(owners[index] as string) !== slug) continue;
                if (await kv.delIfEqual(key, owners[index])) result.removed.push(key);
            }
        }
    } catch (err) {
        result.failures.push(`account-name:* reservations: ${(err as Error).message}`);
    }
}

/**
 * Side-car rows the account owns outside `save:<slug>`, by exact key.
 *
 * Slugs are reusable, and each of these was read back by whoever registered
 * the name next: the Legacy marker (the Sage then re-seeded the old Legacy and
 * paid its Aura Stones again, so delete-and-re-register was also a farm), the
 * story record (the newcomer's interlude choices were locked to the old
 * ones), and the DM inbox (a private message list; the threads themselves are
 * hidden, not deleted: see hideDmThreadsFromReusedName).
 */
export function playerOwnedSideRowKeys(slug: string): string[] {
    return [
        `story:${slug}`,
        `dm:inbox:${slug}`,
        `legacy:accepted:${slug}`,
        `legacy:aura-granted:${slug}`,
        `legacy:stats:${slug}`,
        `legacy:events:${slug}`,
        `legacy:trial:${slug}`,
        `legacy:eligibility:${slug}`,
        `legacy:sage-offer:${slug}`,
        `legacy:sage-pity:${slug}`,
        `legacy:economy-outbox:${slug}`,
    ];
}

/**
 * Side-car rows the account owns, by pattern. A slug never contains `:` or
 * `|`, so each pattern can only match this account's rows.
 * - `pet-sanctuary:` holds stored companions; a newcomer could withdraw them.
 * - `tower-firstclear:` receipts would deny the newcomer every first clear.
 */
export function playerOwnedSideRowPatterns(slug: string): string[] {
    return [
        `pet-sanctuary:${slug}:*`,
        `tower-firstclear:${slug}:*`,
        `pet:showdown-played:${slug}:*`,
    ];
}

/**
 * Hide every DM thread from whoever registers this name next, without erasing
 * it. A thread is keyed by the two names, so a newcomer could read the old
 * conversation by naming the partner. The thread is also the partner's
 * history, which the published policy keeps ("messages you sent to others"
 * may outlive the account), so this writes the same per-partner hide stamp
 * as the player's own "delete conversation" (api/messages.ts): the name sees
 * only messages sent after now, and the partner keeps everything.
 */
async function hideDmThreadsFromReusedName(slug: string, now: number, result: DeletePlayerAccountResult): Promise<void> {
    try {
        const threads = [...await kv.keys(`dm:thread:${slug}|*`), ...await kv.keys(`dm:thread:*|${slug}`)];
        for (const key of new Set(threads)) {
            const [a, b] = key.slice('dm:thread:'.length).split('|');
            const partner = a === slug ? b : a;
            if (!partner || partner === slug) continue;
            const stampKey = `dm:deleted-at:${slug}|${partner}`;
            await kv.set(stampKey, now);
            result.detached.push(stampKey);
        }
    } catch (err) {
        result.failures.push(`dm:thread:* (${slug}): ${(err as Error).message}`);
    }
}

async function removePlayerOwnedSideRows(slug: string, result: DeletePlayerAccountResult): Promise<void> {
    await hideDmThreadsFromReusedName(slug, Date.now(), result);
    for (const key of playerOwnedSideRowKeys(slug)) {
        try {
            if (await kv.del(key)) result.removed.push(key);
        } catch (err) {
            result.failures.push(`${key}: ${(err as Error).message}`);
        }
    }
    for (const pattern of playerOwnedSideRowPatterns(slug)) {
        try {
            for (const key of await kv.keys(pattern)) {
                if (await kv.del(key)) result.removed.push(key);
            }
        } catch (err) {
            result.failures.push(`${pattern}: ${(err as Error).message}`);
        }
    }
}

/**
 * Detach every row that POINTS AT a player, and remove the side-car rows the
 * account owns outside `save:` (see playerOwnedSideRowKeys), without touching
 * the player's own `auth:` / `save:` records.
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
    // A deleted Kage would otherwise hold the seat forever (and a reused slug
    // would inherit it). Loaded lazily: the village modules pull in the save
    // pipeline, which this module's importers must not depend on.
    try {
        const { vacateKageSeatsOf } = await import('./village/_kage-inactivity.js');
        for (const village of await vacateKageSeatsOf(slug)) result.detached.push(`kage-seat:${village}`);
    } catch (err) {
        result.failures.push(`kage seat: ${(err as Error).message}`);
    }
    await releaseSettledPlayerRows(slug, result);
    await detachFromModerationIndexes(slug, result);
    await releaseAccountNames(slug, result);
    await releasePlayerImages(slug, save, result);
    await removePlayerOwnedSideRows(slug, result);
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
    try {
        // The sweep already holds save -> auth. Retain auth -> First Pact here
        // before any reference, credential or character teardown, so a busy
        // story lock leaves the whole account untouched and retryable.
        await withKvLock(authKey(slug), () => withKvLock(`first-pact:${slug}`, async () => {
            const record = await kv.get<AuthRecord>(authKey(slug));
            const firstPactRemoved = await deletePlayerFirstPactState(slug);
            if (firstPactRemoved) result.removed.push(firstPactRemoved);

            // The save must remain available to discover clan/billing references.
            // Storage/reference failures keep the auth retry anchor; billing
            // cancellation retains its deliberate non-blocking/parked behavior.
            const detached = await detachPlayerReferences(slug);
            result.removed.push(...detached.removed);
            result.detached.push(...detached.detached);
            result.failures.push(...detached.failures);
            if (detached.failures.some(failure => !failure.startsWith('tebex subscription:'))) return;

            if (record?.google?.sub) {
                const identityKey = googleIdentityKey(record.google.sub);
                if (await releaseGoogleIdentityForAccount(slug, record.google.sub)) result.removed.push(identityKey);
            }
            // The recovery code has to go with the account. Slugs are reusable,
            // so a surviving `auth-recovery:<slug>` is a working credential to
            // whoever registers this name next — see _recovery-code.ts.
            if (await kv.del(recoveryCodeKey(slug))) result.removed.push(recoveryCodeKey(slug));

            // Remove the derived index before the save, so a failed index cleanup
            // also retains the save's reference evidence for a fresh retry.
            await kv.hdel(REGISTRY_KEY, slug);
            result.detached.push(`${REGISTRY_KEY}[${slug}]`);
            if (await kv.del(saveKey)) result.removed.push(saveKey);
            // The currency ledger mirrors the save. Slugs are reusable, so a
            // surviving row would be read against the next account of this name.
            const ledgerKey = currencyLedgerKey(slug);
            if (await kv.del(ledgerKey)) result.removed.push(ledgerKey);

            // Auth is the sweep's retry anchor and the final deletion. Rotate,
            // never erase revocation state. Keep the retained row aligned before
            // a refused auth deletion so the unchanged generation guard permits
            // a later sweep. If rotation commits but this stamp fails, the
            // unchanged epoch guard still refuses that lower-row generation;
            // recovery needs fresh credential proof or operator intervention.
            // A poisoned lease must never perform speculative compensation.
            const sessionEpoch = await rotatePlayerSessionEpoch(slug);
            if (record) await kv.set(authKey(slug), { ...record, sessionEpoch });
            if (await kv.del(authKey(slug))) result.removed.push(authKey(slug));
            else result.failures.push(`${authKey(slug)}: final deletion was not confirmed`);
        }, { failClosed: true }), { failClosed: true });
    } catch (err) {
        result.failures.push(`${slug} teardown: ${(err as Error).message}`);
    }

    return result;
}
