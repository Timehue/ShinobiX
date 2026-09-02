/*
 * Cancel a Tebex subscription when the account it belongs to is deleted.
 *
 * Underscore-prefixed: shared helper, not a route.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Deleting an account removes the save that carries the supporter flag, but the
 * recurring payment lives at Tebex and knows nothing about it. Without this, a
 * player who deletes their account keeps being charged every month for a game
 * they no longer have, and has to discover the charge and chase it themselves.
 * That is a billing wrong, not a housekeeping detail.
 *
 * ── FAIL-OPEN, BUT NEVER SILENT ───────────────────────────────────────────
 * ⛔ A failure here must NOT block the deletion. Account deletion is a right,
 * and holding it hostage to a third party being reachable would be worse than
 * the problem. But a failed cancellation cannot simply be swallowed either: the
 * save is about to be destroyed, and with it the only record of which
 * subscription belonged to whom. So an unsuccessful attempt is written to an
 * operator-visible orphan list BEFORE the account goes, and the reference
 * survives for a human to cancel by hand.
 *
 * Credentials: the Checkout API uses HTTP Basic with the account API key as the
 * username and a BLANK password. This is a privileged key — it can cancel real
 * subscriptions — so it is separate from the public storefront token and unset
 * means this whole path is inert rather than half-working.
 */
import { kv } from '../_storage.js';

/** Checkout API root — distinct from the Headless storefront host. */
export const TEBEX_CHECKOUT_API = 'https://checkout.tebex.io/api';

/** References Tebex issues for recurring payments all carry this prefix. */
const RECURRING_PREFIX = 'tbx-r-';

/**
 * Where references we could not cancel are parked for a human.
 *
 * A hash rather than a list so re-running a deletion overwrites its own entry
 * instead of growing a duplicate, and so an operator can delete one key once
 * they have cancelled it in the dashboard.
 */
export const ORPHANED_SUBSCRIPTIONS_KEY = 'tebex:orphaned-subscriptions';

export type CancelOutcome =
    | { ok: true; status: number }
    | { ok: false; reason: 'unconfigured' | 'invalid-reference' | 'rejected' | 'unreachable'; status?: number; detail?: string };

const apiKey = (): string => String(process.env.TEBEX_CHECKOUT_API_KEY ?? '').trim();

/** True for something shaped like a recurring-payment reference. */
export function isRecurringReference(value: unknown): boolean {
    return typeof value === 'string' && value.trim().startsWith(RECURRING_PREFIX) && value.trim().length > RECURRING_PREFIX.length;
}

/**
 * Read the active subscription reference off a save's character, if any.
 *
 * `character.patreon` keeps its original storage key — it is live save data and
 * provider-agnostic; only the rail that writes it changed. `userId` holds the
 * paying account at the provider, which for Tebex is the `tbx-r-…` reference.
 *
 * Returns null for an inactive or admin-comped subscription: a comp has no
 * recurring payment behind it, so there is nothing at Tebex to cancel.
 */
export function subscriptionReferenceFromSave(save: unknown): string | null {
    const character = (save as { character?: Record<string, unknown> })?.character;
    const flag = character?.patreon as { active?: unknown; userId?: unknown } | undefined;
    if (!flag || flag.active !== true) return null;
    return isRecurringReference(flag.userId) ? String(flag.userId).trim() : null;
}

/**
 * Cancel one recurring payment. Never throws — the caller is mid-deletion.
 *
 * 204 is the documented success. 404 is treated as success too: the
 * subscription is already gone, which is the state we wanted, and reporting it
 * as a failure would park a reference no human needs to act on.
 */
export async function cancelTebexSubscription(
    reference: string,
    fetchFn: typeof fetch = fetch,
): Promise<CancelOutcome> {
    if (!isRecurringReference(reference)) return { ok: false, reason: 'invalid-reference' };
    const key = apiKey();
    if (!key) return { ok: false, reason: 'unconfigured' };

    try {
        const response = await fetchFn(`${TEBEX_CHECKOUT_API}/recurring-payments/${encodeURIComponent(reference)}`, {
            method: 'DELETE',
            headers: {
                // Basic auth: API key as the username, blank password.
                Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 204 || response.status === 200 || response.status === 404) {
            return { ok: true, status: response.status };
        }
        const detail = await response.text().catch(() => '');
        return { ok: false, reason: 'rejected', status: response.status, detail: detail.slice(0, 200) };
    } catch (error) {
        // Includes the timeout. Tebex being unreachable is not the deleting
        // player's problem, so this is parked rather than raised.
        return { ok: false, reason: 'unreachable', detail: (error as Error)?.name };
    }
}

/**
 * Park a reference we could not cancel, so it outlives the save being deleted.
 *
 * Best-effort by design: if even this write fails there is nothing further to
 * try, and the caller is in the middle of an account deletion that must still
 * complete. The console line is the last resort.
 */
export async function recordOrphanedSubscription(
    slug: string,
    reference: string,
    reason: string,
): Promise<void> {
    const entry = JSON.stringify({ slug, reference, reason, at: new Date().toISOString() });
    try {
        await kv.hset(ORPHANED_SUBSCRIPTIONS_KEY, { [reference]: entry });
    } catch (error) {
        console.error('[tebex] ORPHANED SUBSCRIPTION could not be recorded', entry, (error as Error)?.message);
    }
}

/**
 * The whole job for one deleting account: find the subscription, cancel it, and
 * park it if that failed. Returns a short note for the deletion result, or null
 * when the account had no subscription at all (the common case).
 */
export async function cancelSubscriptionForDeletedAccount(
    slug: string,
    save: unknown,
    fetchFn: typeof fetch = fetch,
): Promise<string | null> {
    const reference = subscriptionReferenceFromSave(save);
    if (!reference) return null;

    const outcome = await cancelTebexSubscription(reference, fetchFn);
    if (outcome.ok) {
        console.log('[tebex] subscription cancelled for deleted account', slug, reference, outcome.status);
        return `tebex subscription ${reference} cancelled`;
    }

    console.error('[tebex] SUBSCRIPTION NOT CANCELLED for deleted account', slug, reference, outcome.reason, outcome.detail ?? '');
    await recordOrphanedSubscription(slug, reference, outcome.reason);
    return `tebex subscription ${reference} NOT cancelled (${outcome.reason}) — parked in ${ORPHANED_SUBSCRIPTIONS_KEY}`;
}
