/*
 * Subscription entitlement core — provider-neutral.
 *
 * Underscore-prefixed: shared helper, not a route.
 *
 * This is the half of the old `api/patreon/_patreon.ts` that outlived Patreon.
 * The Patreon rail (OAuth link, membership webhook, status endpoint) was removed
 * when the storefront moved to Google Play Billing inside the TWA; what stayed
 * is the part that owns the flag itself, because that is the risky part and
 * rewriting it per-provider is how entitlement bugs get made.
 *
 * SECURITY MODEL (see docs/auth-and-anti-cheat-patterns.md for the wider one):
 *   - The subscriber flag lives on the player's save at `character.patreon` and
 *     is SERVER-OWNED. api/save/[name].ts lists `patreon` in
 *     ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS, so a client save can never set or
 *     forge it — it is always copied from the stored record.
 *   - The ONLY writers are the two functions below, and both take the `save:`
 *     lock with `{ failClosed: true }`.
 *
 * WHY THE STORED KEY IS STILL CALLED `patreon`: it is live save data on a
 * running game. Renaming it would mean migrating every existing save and
 * touching the ownership ledger, the golden-master snapshot, and the client
 * mirror — all for cosmetics, with a silent perk-loss as the failure mode.
 * The key is frozen and provider-agnostic; only the rail that writes it changes.
 *
 * NEXT PROVIDER: a Play Billing purchase verifier calls `applyEntitlementToSave`
 * with the purchase/subscription id as `sourceId` and an `Entitlement` built
 * from the verified Google Play Developer API response. Nothing else needs to
 * move.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { mergePreservingImages, safeName } from './_utils.js';
import { isPatreonSubscriber } from './_entitlements.js';

// ─── Entitlement shape ────────────────────────────────────────────────────────

export interface Entitlement {
    active: boolean;
    tier: string;
    entitledCents: number;
}

/** The single subscriber tier id today; extend when more tiers are added. */
export const SUBSCRIBER_TIER = 'shinobi-supporter';

/**
 * Why a revoke left the stored flag alone.
 *   subscription-not-on-save  the flag carries another subscription, or none
 *   admin-comp-on-save        the flag is a live admin comp
 */
export type RevokeRefusal = 'subscription-not-on-save' | 'admin-comp-on-save';

/**
 * What applyEntitlementToSave did. Only `no-save` leaves the question open;
 * `applied` and `refused` are final, so a provider need not redeliver either.
 */
export type EntitlementWrite =
    /** The flag says what the event said. A re-delivery that already matched counts. */
    | { outcome: 'applied' }
    /** There is no save under that name. */
    | { outcome: 'no-save' }
    /** A revoke that was not this subscription's to make. `heldBy` is the flag's `userId`, or ''. */
    | { outcome: 'refused'; reason: RevokeRefusal; heldBy: string };

// ─── Apply the flag to the player's save (one of only two writers) ────────────

/**
 * A revoke ends ONE subscription: the one it names. Providers address their
 * events by account name, and a name outlives its account. After a deletion or
 * a full reset, whoever registers the name next may hold a subscription of
 * their own, so a late `ended` for the old one can reach a save that never
 * held it. Overwriting that flag would revoke perks its owner pays for. It
 * would also erase the only record of their subscription, which account
 * deletion reads to cancel it.
 *
 * A live admin comp is the operator's grant, made regardless of payment, and
 * it expires on its own. A provider ending a subscription says nothing about
 * it, even when the comp was made over that same subscription.
 *
 * Revoke-only: a grant is never refused here.
 */
function revokeRefusal(
    character: Record<string, unknown>,
    prev: Record<string, unknown> | null,
    sourceId: string,
): EntitlementWrite | null {
    const heldBy = typeof prev?.userId === 'string' ? prev.userId : '';
    if (prev?.source === 'admin' && isPatreonSubscriber(character)) {
        return { outcome: 'refused', reason: 'admin-comp-on-save', heldBy };
    }
    if (prev?.userId !== sourceId) {
        return { outcome: 'refused', reason: 'subscription-not-on-save', heldBy };
    }
    return null;
}

/**
 * Write `character.patreon` under the save lock. Idempotent: a re-delivered
 * purchase notification whose entitlement matches the stored flag is a no-op
 * (no version bump), so provider retries are cheap and safe.
 *
 * A revoke (`ent.active === false`) only writes over a flag that carries the
 * same `sourceId` and is not a live admin comp. Anything else comes back
 * `refused` with the save untouched; see revokeRefusal.
 *
 * `no-save` means the save doesn't exist (a brand-new or deleted account). The
 * caller decides whether that is worth a retry: a grant may land once the
 * account exists, but a revoke has nothing to revoke.
 *
 * `sourceId` identifies the paying account at the billing provider. It persists
 * as `userId` inside the flag because that is the stored field name.
 */
export async function applyEntitlementToSave(
    playerName: string,
    sourceId: string,
    ent: Entitlement,
): Promise<EntitlementWrite> {
    const key = `save:${safeName(playerName)}`;
    return await withKvLock<EntitlementWrite>(key, async () => {
        const rec = await kv.get<Record<string, unknown>>(key);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!rec || !char) return { outcome: 'no-save' };

        const now = Date.now();
        const prev = (char.patreon ?? null) as Record<string, unknown> | null;
        if (!ent.active) {
            const refused = revokeRefusal(char, prev, sourceId);
            if (refused) return refused;
        }
        // Skip the write when nothing meaningful changed — makes re-delivery a
        // free no-op instead of a redundant version bump.
        if (prev
            && prev.userId === sourceId
            && prev.active === ent.active
            && prev.tier === ent.tier
            && Number(prev.entitledCents) === ent.entitledCents) {
            return { outcome: 'applied' };
        }
        // Preserve the original "since" while active; clear tracking on lapse.
        const prevSince = prev && Number(prev.since) > 0 ? Number(prev.since) : 0;
        const since = ent.active ? (prevSince || now) : (prevSince || undefined);

        char.patreon = {
            userId: sourceId,
            tier: ent.tier,
            active: ent.active,
            entitledCents: ent.entitledCents,
            since,
            updatedAt: now,
        };
        const record = bumpSaveVersion({ ...rec, character: char });
        await kv.set(key, mergePreservingImages(record, rec));
        return { outcome: 'applied' };
    }, { failClosed: true });
}

// ─── Admin comp grant (manual subscription, no payment) ───────────────────────

export interface AdminSubResult {
    active: boolean;
    tier: string;
    expiresAt: number | null;
}

/**
 * Full-admin comp: activate (or revoke) the Shinobi Supporter perks on a
 * player's save regardless of payment. An activation auto-EXPIRES after `days`
 * (default 30) via character.patreon.expiresAt — isPatreonSubscriber treats a
 * lapsed comp as inactive, so no cron is needed. Writes the server-owned flag
 * under the save lock (the same field a client save can never forge). Returns
 * null when the player has no server save.
 *
 * With the Patreon rail gone this is currently the ONLY way to grant perks, so
 * it is load-bearing rather than a convenience until Play Billing lands.
 */
export async function applyAdminSubscription(
    playerName: string,
    opts: { active: boolean; days?: number },
): Promise<AdminSubResult | null> {
    const key = `save:${safeName(playerName)}`;
    return await withKvLock<AdminSubResult | null>(key, async () => {
        const rec = await kv.get<Record<string, unknown>>(key);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!rec || !char) return null;

        const now = Date.now();
        const prev = (char.patreon ?? null) as Record<string, unknown> | null;
        const prevUserId = typeof prev?.userId === 'string' ? prev.userId : '';
        const prevSince = prev && Number(prev.since) > 0 ? Number(prev.since) : 0;

        let flag: Record<string, unknown>;
        if (opts.active) {
            const days = Math.max(1, Math.floor(opts.days ?? 30));
            flag = {
                userId: prevUserId,
                tier: SUBSCRIBER_TIER,
                active: true,
                entitledCents: Number(prev?.entitledCents ?? 0),
                since: prevSince || now,
                updatedAt: now,
                expiresAt: now + days * 86_400_000,
                source: 'admin',
            };
        } else {
            flag = {
                userId: prevUserId,
                tier: 'none',
                active: false,
                entitledCents: Number(prev?.entitledCents ?? 0),
                since: prevSince || undefined,
                updatedAt: now,
                source: 'admin',
            };
        }
        char.patreon = flag;
        const record = bumpSaveVersion({ ...rec, character: char });
        await kv.set(key, mergePreservingImages(record, rec));
        return { active: opts.active, tier: String(flag.tier), expiresAt: (flag.expiresAt as number | undefined) ?? null };
    }, { failClosed: true });
}

// ─── Pure read helpers ────────────────────────────────────────────────────────
// isPatreonSubscriber is the canonical entitlement read shared with the
// save-handler perk clamps; re-export it so callers can import from either.

export { isPatreonSubscriber };

/** Tier id for an active subscriber, or null when the flag is inactive/absent. */
export function subscriptionTier(character: unknown): string | null {
    if (!isPatreonSubscriber(character)) return null;
    const tier = (character as { patreon?: { tier?: string } }).patreon?.tier;
    return String(tier ?? SUBSCRIBER_TIER);
}
