/*
 * Fate Shard purchase catalogue — the single definition shared by every rail.
 *
 * One list, two storefronts: Tebex sells these on the web, Google Play Billing
 * sells them inside the Android TWA. Both providers hold their own copy of the
 * price (that is what the customer is actually charged, in their own currency),
 * so this file is the *canonical mapping* between our package ids and theirs —
 * never the source of truth for money.
 *
 * ⛔ THE SERVER MUST NEVER GRANT FROM A CLIENT-SUPPLIED AMOUNT.
 * A purchase arrives as a provider webhook naming a provider package id. The
 * server resolves that id to a row here and credits `shards` from THIS table.
 * It does not read a shard count, price, or quantity from the client, and it
 * does not trust the webhook's own money fields for the grant. Same rule as
 * every other reward path in this repo: the payload says *what happened*, the
 * server decides *what it is worth*.
 *
 * ⛔ DISPLAY PRICE COMES FROM THE PROVIDER, NOT FROM `usd`.
 * `usd` is the reference price we set the products up with, used for planning
 * and for the bonus maths below. The shop UI must render the provider's
 * localized price so a player in France sees euros with their VAT included.
 * Showing `usd` to everyone would be wrong in most of the world.
 */

export type ShardPackageId =
    | 'shards-35'
    | 'shards-155'
    | 'shards-420'
    | 'shards-900';

export interface ShardPackage {
    id: ShardPackageId;
    /** Shards credited on a verified purchase. The ONLY quantity the server trusts. */
    shards: number;
    /** Reference USD price the products are configured with. Not for display. */
    usd: number;
}

/**
 * The owner's tiers, mirroring the packages created in the Tebex dashboard.
 * The $5 tier is the base rate every other tier's bonus is measured against.
 *
 * ECONOMY CONTEXT — a deliberately premium rate, 7.00 to 9.00 shards per dollar:
 *   Legendary card pack ..............  30 shards ≈ $4
 *   one legendary armour piece ....... 150 shards ≈ $19
 *   profession change / forge roll ... 200 shards ≈ $25
 *   best-in-slot legendary loadout ... 900 shards = the $100 tier exactly
 *   EVERY shard-priced power item ... 6250 shards ≈ $694 at the best rate
 *
 * That last line is the one that matters: buying the game's whole power
 * catalogue costs hundreds of dollars, and every item is earnable in play. It
 * is what keeps "money buys time, not power" true in practice rather than as a
 * slogan — see feedback_balanced_pvp_design_pillar. Re-check these figures
 * before changing any tier, because the rate silently prices every shard sink
 * in the game.
 *
 * ⚠ The top tier is deliberately equal to one complete legendary loadout. That
 * is a clear value proposition, and it is also the most pay-to-win-adjacent
 * point in the catalogue — a knowing choice, not an accident. If the gear ladder
 * is ever re-costed, revisit whether this equivalence still reads the way it
 * should.
 */
export const SHARD_PACKAGES: readonly ShardPackage[] = [
    { id: 'shards-35', shards: 35, usd: 5 },
    { id: 'shards-155', shards: 155, usd: 20 },
    { id: 'shards-420', shards: 420, usd: 50 },
    { id: 'shards-900', shards: 900, usd: 100 },
] as const;

const BY_ID = new Map<string, ShardPackage>(SHARD_PACKAGES.map((pack) => [pack.id, pack]));

/** Resolve a package id to its row. Unknown ids return null — never a default. */
export function shardPackage(id: string): ShardPackage | null {
    return BY_ID.get(id) ?? null;
}

/** Shards per reference dollar, used as the baseline for bonus maths. */
function rate(pack: ShardPackage): number {
    return pack.shards / pack.usd;
}

/** The smallest tier sets the baseline every "extra" claim is measured against. */
const BASE_RATE = rate(SHARD_PACKAGES[0]!);

/**
 * How much more value a tier gives than the base tier, as a whole percent.
 *
 * DERIVED, NEVER HARDCODED — and that is the point. The original tier sheet
 * carried hand-written bonus labels that did not match the numbers: the $4.99
 * tier was advertised as "10% EXTRA" while actually giving 6%, and the $199.99
 * tier claimed 50% while actually giving 99%. Overstating is a false claim on a
 * paid product; understating quietly wastes the incentive. Computing it from the
 * same data the player is charged against makes both impossible.
 *
 * Rounds DOWN, so the number shown can never exceed the value delivered.
 */
export function shardBonusPercent(pack: ShardPackage): number {
    return Math.floor(((rate(pack) / BASE_RATE) - 1) * 100);
}

/**
 * Provider package ids, filled in once the products exist in each dashboard.
 *
 * Kept as a map rather than a field on ShardPackage so the catalogue stays
 * provider-agnostic and a missing id is an obvious gap rather than a silent
 * empty string. A rail with no id for a package simply cannot sell it, which is
 * the safe failure: better to hide a tier than to take money for one the server
 * cannot resolve back to a shard amount.
 */
export interface ProviderPackageMap {
    /** Tebex package id (numeric in their dashboard, stored as string). */
    tebex?: Partial<Record<ShardPackageId, string>>;
    /** Google Play in-app product id. Must be a CONSUMABLE, or it sells once ever. */
    play?: Partial<Record<ShardPackageId, string>>;
}

export const PROVIDER_PACKAGE_IDS: ProviderPackageMap = {
    /*
     * Live Tebex package ids, read from the dashboard 2026-09-01.
     *
     * ⛔ THE PAIRING IS THE PAYOUT. The webhook resolves the id Tebex reports to
     * a row here and credits THAT row's shards. Mis-file one and the customer is
     * charged one tier and credited another — a $100 buyer receiving 35 shards.
     * The ids are NOT sequential with the tiers (…03, …06, …08, …09), so they
     * cannot be checked by eye or regenerated by pattern; each was read off its
     * own package page.
     *
     * The subscription is deliberately absent: it is one product, it grants a
     * flag rather than currency, and its id lives in TEBEX_SUBSCRIPTION_PACKAGE_ID
     * (currently 7651601). See docs/TEBEX_STOREFRONT_SETUP.md.
     */
    tebex: {
        'shards-35': '7651603',
        'shards-155': '7651606',
        'shards-420': '7651608',
        'shards-900': '7651609',
    },
    // TODO: fill from Play Console once in-app products exist (needs an uploaded
    // build with the Billing Library before the console will let you create them).
    play: {},
};

/*
 * ── Shinobi Supporter subscription ────────────────────────────────────────
 *
 * Not a shard pack — it grants the recurring perk flag rather than currency —
 * but it lives here because this file is the one place that maps our concepts
 * to provider product ids, and splitting that across two files is how a mapping
 * ends up half-updated.
 *
 * The provider id is read from the environment rather than committed because,
 * unlike the shard tiers, there is exactly one of them and it is the only
 * thing standing between a created dashboard package and a working
 * subscription. Unset means the rail is inert: recurring webhooks are
 * acknowledged and ignored rather than entitling someone off an unverified
 * product.
 */
/** The catalogue id the client names to buy the recurring supporter tier. */
export const SUBSCRIPTION_ID = 'shinobi-supporter';

/** Reference monthly price, for the same planning-only purpose as `usd` above. */
export const SUBSCRIPTION_REFERENCE_USD = 15;

/*
 * The Tebex product id itself is read from the environment SERVER-SIDE (see
 * api/tebex/_basket-core.ts). It is deliberately not here: this module is
 * bundled into the browser, which has no `process`, and a storefront product id
 * has no business shipping to the client anyway.
 */

/** Reverse lookup: a verified provider package id → our canonical package. */
export function shardPackageForProvider(
    provider: keyof ProviderPackageMap,
    providerId: string,
): ShardPackage | null {
    const table = PROVIDER_PACKAGE_IDS[provider] ?? {};
    for (const [ourId, theirId] of Object.entries(table)) {
        if (theirId === providerId) return shardPackage(ourId);
    }
    return null;
}
