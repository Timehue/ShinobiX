/*
 * Tebex Headless basket construction — pure, side-effect free, fully testable.
 *
 * Underscore-prefixed: shared helper, not a route. The HTTP handler lives in
 * api/tebex/basket.ts and does the network calls; everything that decides what
 * we SEND to Tebex and how we READ their answer lives here.
 *
 * ── WHY THE IDENTITY LIVES IN `custom` ────────────────────────────────────
 * Tebex's webhook schema carries `products[].username.id` and
 * `customer.username.id`, and those are the obvious place to look for "who
 * bought this". They are populated for GAME stores — Minecraft and friends,
 * where the buyer types a game username at checkout and Tebex resolves it.
 *
 * Ours is a UNIVERSAL webstore. Tebex's own words: "No username is required for
 * your store." Nothing ever asks the buyer who they are, so those fields arrive
 * empty and an identity read from them resolves to nobody. The player would pay
 * and receive nothing, while the webhook answered 200 and moved on.
 *
 * So identity rides in the basket's `custom` object, which Tebex documents as
 * "included with webhook responses". We set it server-side from the
 * authenticated session at basket creation; the buyer never types a name and
 * never gets to choose one. That is the same rule as every other reward path
 * here — the client says what it wants to buy, the SERVER says who it is for.
 *
 * ⛔ Never populate the player name from a request body. `basket.ts` passes the
 * result of authedPlayer() and nothing else. A basket is a claim on real money;
 * letting a body field name the recipient would let anyone credit a stranger's
 * account, or more likely, typo their own shards into the void.
 */
import { canonicalOrigin } from '../_canonical-domain.js';
import { PROVIDER_PACKAGE_IDS, shardPackage, SUBSCRIPTION_ID, type ShardPackage } from '../../shared/shard-packages.js';

/**
 * Tebex product id for the recurring Shinobi Supporter package. Empty until the
 * dashboard package exists, which keeps the whole subscription rail inert
 * rather than entitling anyone off an unverified product.
 */
export function tebexSubscriptionPackageId(env: NodeJS.ProcessEnv = process.env): string {
    return String(env.TEBEX_SUBSCRIPTION_PACKAGE_ID ?? '').trim();
}

/** Headless API host. The webstore's PUBLIC token goes in the path. */
export const TEBEX_HEADLESS_BASE = 'https://headless.tebex.io/api/accounts';

/** Key inside the basket `custom` object holding the player slug. */
export const BASKET_CUSTOM_PLAYER_KEY = 'playerName';

/**
 * Marks a basket as ours, so a webhook for something created elsewhere (a
 * hand-made test basket, a future non-shard product) is recognisably not a
 * shard purchase rather than being read as one with a missing name.
 */
export const BASKET_CUSTOM_SOURCE = 'shinobi-journey';

export interface CreatedBasket {
    ident: string;
    /** Only present while the basket is unpaid; that is exactly when we need it. */
    checkoutUrl: string;
}

/** The `custom` blob attached to a basket, and echoed back to us on payment. */
export function basketCustomForPlayer(playerName: string): Record<string, string> {
    return { [BASKET_CUSTOM_PLAYER_KEY]: playerName, source: BASKET_CUSTOM_SOURCE };
}

/**
 * Pull our player slug back out of a webhook's `custom` blob.
 *
 * Tolerates the string-encoded form: Tebex round-trips `custom` through their
 * storage and some store configurations hand it back as a JSON string rather
 * than an object. Returning '' for anything unrecognised keeps the caller's
 * fail-closed shape — an unreadable custom blob must mean "no identity", never
 * a guess.
 */
export function readPlayerNameFromCustom(custom: unknown): string {
    let value = custom;
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return '';
        try { value = JSON.parse(text); } catch { return ''; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const name = (value as Record<string, unknown>)[BASKET_CUSTOM_PLAYER_KEY];
    return typeof name === 'string' ? name.trim() : '';
}

/**
 * Resolve one of our catalogue ids to the Tebex package id it maps to.
 *
 * Returns null when the mapping is missing, which is the honest state before
 * the dashboard packages exist. `basket.ts` turns that into a "not available"
 * response rather than inventing an id — a basket built on a guessed package id
 * would charge the customer for something the webhook could never resolve back
 * to a shard amount.
 */
export function tebexPackageIdFor(ourPackageId: string): { pack: ShardPackage; tebexId: string } | null {
    const pack = shardPackage(ourPackageId);
    if (!pack) return null;
    const tebexId = PROVIDER_PACKAGE_IDS.tebex?.[pack.id];
    if (!tebexId) return null;
    return { pack, tebexId };
}


export interface ResolvedProduct {
    tebexId: string;
    /** Shards credited on purchase; 0 for the subscription, which grants a flag. */
    shards: number;
    kind: 'shards' | 'subscription';
}

/**
 * Resolve any purchasable id — shard tier or subscription — to its Tebex
 * product. Unknown or unconfigured ids return null so the route refuses rather
 * than charging for something the webhook could not act on afterwards.
 */
export function resolvePurchasable(
    ourId: string,
    env: NodeJS.ProcessEnv = process.env,
): ResolvedProduct | null {
    if (ourId === SUBSCRIPTION_ID) {
        const tebexId = tebexSubscriptionPackageId(env);
        return tebexId ? { tebexId, shards: 0, kind: 'subscription' } : null;
    }
    const shard = tebexPackageIdFor(ourId);
    return shard ? { tebexId: shard.tebexId, shards: shard.pack.shards, kind: 'shards' } : null;
}

export interface CreateBasketInput {
    playerName: string;
    /** Buyer's address, forwarded for Tebex's own fraud checks. */
    ipAddress?: string;
    env?: NodeJS.ProcessEnv;
}

/**
 * Body for POST {base}/{token}/baskets.
 *
 * `complete_auto_redirect` is FALSE on purpose. Checkout opens in a second tab,
 * so redirecting on completion would boot a whole extra copy of the SPA — a
 * heavy load, and two live tabs racing each other's autosave and heartbeat over
 * the same save. The buyer instead lands on Tebex's own receipt page and closes
 * it, and the still-running game tab refreshes its balance.
 *
 * The URLs are still supplied: Tebex requires them, links them from the receipt,
 * and reuses them if payment is finished later from an emailed link.
 */
export function buildCreateBasketBody(input: CreateBasketInput): Record<string, unknown> {
    const origin = canonicalOrigin(input.env ?? process.env);
    const body: Record<string, unknown> = {
        complete_url: `${origin}/#/premiumShop?purchase=complete`,
        cancel_url: `${origin}/#/premiumShop?purchase=cancelled`,
        custom: basketCustomForPlayer(input.playerName),
        complete_auto_redirect: false,
    };
    if (input.ipAddress) body.ip_address = input.ipAddress;
    return body;
}

/** Body for POST {base}/{token}/{ident}/packages. */
export function buildAddPackageBody(tebexPackageId: string, quantity = 1): Record<string, unknown> {
    return { package_id: tebexPackageId, quantity: Math.max(1, Math.floor(quantity) || 1), dynamic: false };
}

/**
 * Read a created basket out of Tebex's response.
 *
 * Their Headless responses wrap the payload in `data`, but tolerate a bare
 * object too so a future unwrapped response does not break checkout. A basket
 * without a checkout link is treated as a failure: it is unpayable, and
 * returning it would hand the client an ident that silently goes nowhere.
 */
export function parseCreatedBasket(json: unknown): CreatedBasket | null {
    if (!json || typeof json !== 'object') return null;
    const root = json as Record<string, unknown>;
    const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
    const ident = typeof data.ident === 'string' ? data.ident.trim() : '';
    if (!ident) return null;
    const links = (data.links && typeof data.links === 'object' ? data.links : {}) as Record<string, unknown>;
    const checkoutUrl = typeof links.checkout === 'string' ? links.checkout.trim() : '';
    if (!checkoutUrl) return null;
    return { ident, checkoutUrl };
}

/**
 * One sellable tier, priced by Tebex rather than by us.
 *
 * `amount`/`currency` come straight from the storefront, which is the only
 * place that knows what this buyer will actually be charged — their currency,
 * their tax. shared/shard-packages.ts is explicit that its `usd` field is a
 * planning reference and must never be shown as the price.
 */
export interface CataloguePrice {
    packageId: string;
    tebexId: string;
    amount: number;
    currency: string;
}

/**
 * Read Tebex's package list into prices for the tiers we actually sell.
 *
 * Anything we have no mapping for is dropped rather than displayed: the shop
 * must not offer a tier the basket endpoint would then refuse. A package
 * missing a usable price is dropped for the same reason — a tile with a blank
 * price is worse than one tile fewer.
 */
export function parseCataloguePrices(json: unknown): CataloguePrice[] {
    const root = (json && typeof json === 'object' ? json as Record<string, unknown> : {});
    const list = Array.isArray(root.data) ? root.data : Array.isArray(json) ? json : [];
    const byTebexId = new Map<string, string>();
    for (const [ourId, theirId] of Object.entries(PROVIDER_PACKAGE_IDS.tebex ?? {})) {
        if (theirId) byTebexId.set(String(theirId), ourId);
    }
    // The subscription is priced by the same storefront call, so the supporter
    // tile shows a real localized figure rather than the reference dollar one.
    const subscriptionId = tebexSubscriptionPackageId();
    if (subscriptionId) byTebexId.set(subscriptionId, SUBSCRIPTION_ID);

    const prices: CataloguePrice[] = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const tebexId = row.id === undefined || row.id === null ? '' : String(row.id);
        const packageId = byTebexId.get(tebexId);
        if (!packageId) continue;
        const amount = Number(row.total_price ?? row.base_price);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const currency = typeof row.currency === 'string' && row.currency.trim() ? row.currency.trim().toUpperCase() : 'USD';
        prices.push({ packageId, tebexId, amount, currency });
    }
    return prices;
}
