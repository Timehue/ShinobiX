/*
 * Fate Shard storefront — the client half.
 *
 * Talks to api/tebex/* and nothing else. It never decides what a purchase is
 * worth: it names a package, the server binds the basket to the signed-in
 * player, Tebex takes the money, and the webhook credits the shards. Nothing
 * here can grant currency, and nothing here should ever try to.
 *
 * ⛔ PLAY POLICY LIVES IN `shardRail()`. Inside the Android app, offering a web
 * checkout for digital goods breaches Play's billing policy and is grounds for
 * removal. So the app surface gets Play Billing or it gets NOTHING — never the
 * web rail as a fallback. On the open web there is no such restriction.
 */
import { SHARD_PACKAGES, shardBonusPercent, type ShardPackage } from "../../../shared/shard-packages";
import type { Character } from "../types/character";
import { canUsePlayBilling, isPlayApp } from "./surface";

export type ShardRail =
    /** Android app with the Digital Goods API — Play Billing is the only legal rail. */
    | "play"
    /** Open web — Tebex hosted checkout. */
    | "web"
    /** Android app WITHOUT Play Billing. Show no purchase path at all. */
    | "blocked";

export function shardRail(): ShardRail {
    if (!isPlayApp()) return "web";
    return canUsePlayBilling() ? "play" : "blocked";
}

/** A tier as the shop should render it, price included when Tebex has one. */
export interface ShardTier {
    pack: ShardPackage;
    bonusPercent: number;
    /** Tebex's price for THIS buyer. Null when the storefront could not answer. */
    price: { amount: number; currency: string } | null;
}

export interface CataloguePriceRow {
    packageId: string;
    amount: number;
    currency: string;
}

/**
 * Ask the server what Tebex will charge. Never throws and never rejects: a
 * price lookup failing must not stop the shop rendering, so the caller gets
 * an empty list and falls back to the reference figures.
 */
export async function fetchShardPrices(signal?: AbortSignal): Promise<CataloguePriceRow[]> {
    try {
        const response = await fetch("/api/tebex/catalogue", { signal, cache: "no-cache" });
        const body = await response.json().catch(() => ({})) as { prices?: CataloguePriceRow[] };
        return Array.isArray(body.prices) ? body.prices : [];
    } catch {
        return [];
    }
}

/** Join the catalogue to whatever prices came back. Order follows the catalogue. */
export function buildShardTiers(prices: CataloguePriceRow[]): ShardTier[] {
    const byId = new Map(prices.map((row) => [row.packageId, row]));
    return SHARD_PACKAGES.map((pack) => {
        const row = byId.get(pack.id);
        return {
            pack,
            bonusPercent: shardBonusPercent(pack),
            price: row ? { amount: row.amount, currency: row.currency } : null,
        };
    });
}

/** Render a provider price in the buyer's own currency, falling back gracefully. */
export function formatPrice(price: { amount: number; currency: string }): string {
    try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
    } catch {
        // An unrecognised currency code must not blank the price out.
        return `${price.amount.toFixed(2)} ${price.currency}`;
    }
}

export interface CheckoutResult {
    ok: boolean;
    checkoutUrl?: string;
    error?: string;
}

/**
 * Open a checkout for one package.
 *
 * `tab` is the window opened SYNCHRONOUSLY by the click handler — see the note
 * in FateShardSection. Passing it in lets this function do the async work and
 * still land in a tab the popup blocker allowed.
 */
export async function openShardCheckout(packageId: string, tab: Window | null): Promise<CheckoutResult> {
    try {
        const response = await fetch("/api/tebex/basket", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ packageId }),
        });
        const body = await response.json().catch(() => ({})) as { ok?: boolean; checkoutUrl?: string; error?: string };
        if (!response.ok || !body.ok || !body.checkoutUrl) {
            tab?.close();
            return { ok: false, error: body.error || "Could not open checkout." };
        }
        if (tab) tab.location.href = body.checkoutUrl;
        return { ok: true, checkoutUrl: body.checkoutUrl };
    } catch {
        tab?.close();
        return { ok: false, error: "Could not reach the shop. Check your connection and try again." };
    }
}

/**
 * Re-read the authoritative save after a purchase.
 *
 * Shards are credited by the Tebex webhook, straight into the stored save, so
 * the running tab's copy is stale the moment payment lands. Re-reading is not
 * just cosmetic: `fateShards` is a server ledger where client saves may spend
 * but never grant, so a tab that kept autosaving its pre-purchase balance would
 * be writing a LOWER number over the credited one. Pulling the server's version
 * back in — and committing it through the normal versioned path — is what stops
 * a purchase being quietly undone by the next autosave.
 */
export async function refreshPurchasedSave(
    playerName: string,
    signal?: AbortSignal,
): Promise<{ character: Character; version: unknown } | null> {
    try {
        const response = await fetch(`/api/save/${encodeURIComponent(playerName.toLowerCase())}`, { cache: "no-cache", signal });
        const body = await response.json().catch(() => ({})) as { character?: Character; _saveVersion?: unknown };
        if (!response.ok || !body.character) return null;
        return { character: body.character, version: body._saveVersion };
    } catch {
        return null;
    }
}
