export const EXCHANGE_FEE_PERCENT = 5;
export const EXCHANGE_LISTING_LIMIT = 30;
export const EXCHANGE_MAX_PRICE = 1_000_000_000;
export const EXCHANGE_MAX_QUANTITY = 9999;
export const EXCHANGE_SALE_EVENT = 'sunscar-exchange:sold';
export const EXCHANGE_CURRENCIES = { ryo: 'ryo', fateShards: 'Fate Shards' } as const;
export type ExchangeCurrency = keyof typeof EXCHANGE_CURRENCIES;

export const EXCHANGE_CATEGORIES = [
    'all', 'pets', 'weapons', 'armor', 'accessories', 'consumables', 'materials', 'cards', 'resources',
] as const;
export type ExchangeCategory = typeof EXCHANGE_CATEGORIES[number];
export type ExchangeKind = 'item' | 'pet' | 'card' | 'resource';
export type ExchangeAsset = {
    kind: ExchangeKind;
    id: string;
    name: string;
    category: Exclude<ExchangeCategory, 'all'>;
    rarity: string;
    description: string;
    image?: string;
    level?: number;
    stats: Array<{ label: string; value: string }>;
};
export type ExchangeOwnedAsset = ExchangeAsset & { quantity: number; unavailable?: string };
export type ExchangeListing = {
    id: string;
    seller: string;
    sellerName: string;
    buyer?: string;
    asset: ExchangeAsset;
    quantity: number;
    price: number;
    /** Listings created before currency selection are priced in ryo. */
    currency?: ExchangeCurrency;
    fee: number;
    proceeds: number;
    createdAt: number;
    completedAt?: number;
    state: 'preparing' | 'active' | 'buying' | 'sold' | 'cancelling' | 'cancelled' | 'failed';
};
export const EXCHANGE_READINESS_REASON_CODES = [
    'listing-missing', 'listing-unavailable', 'own-listing', 'purchase-pending',
    'insufficient-funds', 'invalid-balance', 'level-required',
    'duplicate-companion', 'companion-capacity', 'card-capacity',
    'inventory-capacity', 'stack-quantity', 'stack-capacity',
] as const;
export type ExchangeReadinessReasonCode = typeof EXCHANGE_READINESS_REASON_CODES[number];
export type ExchangePreparationTarget = {
    screen: 'home' | 'inventory';
    label: string;
    section?: 'sanctuary';
};
export type ExchangePurchaseReadiness = {
    listingId: string;
    observedAt: number;
    status: 'ready' | 'blocked';
    reasonCode?: ExchangeReadinessReasonCode;
    message?: string;
    prepare?: ExchangePreparationTarget;
    /** Fresh public state when the listing still exists. Never purchase authority. */
    listing?: ExchangeListing;
};
export function exchangeCurrency(listing: Pick<ExchangeListing, 'currency'>): ExchangeCurrency {
    return listing.currency ?? 'ryo';
}
export function exchangeFee(price: number): number {
    return Math.floor(price * EXCHANGE_FEE_PERCENT / 100);
}
export type ExchangeSaleReceipt = {
    listingId: string;
    seller: string;
    assetName: string;
    quantity: number;
    currency: ExchangeCurrency;
    price: number;
    fee: number;
    proceeds: number;
};
export function isExchangeSaleReceipt(value: unknown): value is ExchangeSaleReceipt {
    if (!value || typeof value !== 'object') return false;
    const sale = value as ExchangeSaleReceipt;
    return typeof sale.listingId === 'string' && /^[a-f0-9]{32}$/.test(sale.listingId)
        && typeof sale.seller === 'string' && !!sale.seller && typeof sale.assetName === 'string' && !!sale.assetName
        && Number.isSafeInteger(sale.quantity) && sale.quantity > 0 && sale.quantity <= EXCHANGE_MAX_QUANTITY
        && (sale.currency === 'ryo' || sale.currency === 'fateShards')
        && Number.isSafeInteger(sale.price) && sale.price > 0 && sale.price <= EXCHANGE_MAX_PRICE
        && sale.fee === exchangeFee(sale.price) && sale.proceeds === sale.price - sale.fee;
}
export const EXCHANGE_RESOURCES: Record<string, string> = {
    fateShards: 'Fate Shards', boneCharms: 'Bone Charms', auraStones: 'Aura Stones',
    honorSeals: 'Honor Seals', mythicSeals: 'Mythic Seals',
};

// ── Market browsing (server-side filter / sort / page) ─────────────────────────
//
// The open market is filtered, sorted and paged by the server so a browse never
// ships every live listing. One definition serves the server query and the
// client's controls, so the two can never disagree on what a filter means.

/** Listings per market page — the size of the grid the Exchange renders. */
export const EXCHANGE_MARKET_PAGE_SIZE = 12;
export const EXCHANGE_MARKET_SEARCH_MAX = 80;
export const EXCHANGE_MARKET_SORTS = ['newest', 'price-low', 'price-high', 'rarity'] as const;
export type ExchangeMarketSort = typeof EXCHANGE_MARKET_SORTS[number];
/** Rarity rank for the rarity sort and the rarity filter's options. */
export const EXCHANGE_RARITY_ORDER: Readonly<Record<string, number>> = { named: 7, mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1, standard: 1 };

export type ExchangeMarketQuery = {
    v: 2;
    page: number;
    category: ExchangeCategory;
    rarity: string;
    currency: ExchangeCurrency | 'all';
    sort: ExchangeMarketSort;
    search: string;
    /** Only listings the viewer can pay for, in the listing's own currency. */
    affordable: boolean;
};
export type ExchangeMarketPage = {
    v: 2;
    /** The normalized query this page answers (clients match replies to it). */
    query: ExchangeMarketQuery;
    page: number;
    pageSize: number;
    pages: number;
    total: number;
    listings: ExchangeListing[];
};

export const EXCHANGE_MARKET_DEFAULT_QUERY: ExchangeMarketQuery = {
    v: 2, page: 1, category: 'all', rarity: 'all', currency: 'all', sort: 'newest', search: '', affordable: false,
};

/** Validate an untrusted market query. Null for anything malformed. */
export function parseExchangeMarketQuery(raw: unknown): ExchangeMarketQuery | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const page = value.page === undefined ? 1 : Number(value.page);
    const category = value.category ?? 'all';
    const rarity = value.rarity ?? 'all';
    const currency = value.currency ?? 'all';
    const sort = value.sort ?? 'newest';
    const search = value.search ?? '';
    const affordable = value.affordable ?? false;
    if (value.v !== 2
        || !Number.isSafeInteger(page) || page < 1
        || !(EXCHANGE_CATEGORIES as readonly unknown[]).includes(category)
        || typeof rarity !== 'string' || (rarity !== 'all' && !Object.hasOwn(EXCHANGE_RARITY_ORDER, rarity))
        || (currency !== 'all' && currency !== 'ryo' && currency !== 'fateShards')
        || !(EXCHANGE_MARKET_SORTS as readonly unknown[]).includes(sort)
        || typeof search !== 'string' || search.length > EXCHANGE_MARKET_SEARCH_MAX
        || typeof affordable !== 'boolean') {
        return null;
    }
    return {
        v: 2, page, category: category as ExchangeCategory, rarity, currency: currency as ExchangeCurrency | 'all',
        sort: sort as ExchangeMarketSort, search, affordable,
    };
}

/** Identity of a query's RESULT SET (every field but the page). */
export function exchangeMarketFilterKey(query: ExchangeMarketQuery): string {
    return JSON.stringify([query.category, query.rarity, query.currency, query.sort, query.search.toLowerCase().trim(), query.affordable]);
}

/** The fields a market filter or sort reads, as the server projects them. */
export type ExchangeMarketRow = {
    id: string; sellerName: string; price: number; currency?: ExchangeCurrency; createdAt: number;
    name: string; description: string; category: string; rarity: string;
};

/** Whether a listing passes the query's filters. `balances` is the viewer's
 *  stored purse; affordability compares a listing only to the currency it is
 *  priced in — ryo and Fate Shards are never treated as interchangeable. */
export function exchangeMarketMatches(query: ExchangeMarketQuery, row: ExchangeMarketRow, balances: { ryo: number; fateShards: number }): boolean {
    const currency = exchangeCurrency(row);
    return (query.category === 'all' || row.category === query.category)
        && (query.rarity === 'all' || row.rarity === query.rarity)
        && (query.currency === 'all' || currency === query.currency)
        && `${row.name} ${row.description} ${row.sellerName}`.toLowerCase().includes(query.search.toLowerCase().trim())
        && (!query.affordable || row.price <= (currency === 'fateShards' ? balances.fateShards : balances.ryo));
}

/** Total order for market pages. Price sorts group ryo before Fate Shards and
 *  compare whole-lot prices within a currency only. Every sort ends on newest
 *  first, then the listing id, so equal keys page deterministically. */
export function compareExchangeMarketRows(sort: ExchangeMarketSort, a: ExchangeMarketRow, b: ExchangeMarketRow): number {
    const tieBreak = () => (b.createdAt - a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (sort === 'price-low' || sort === 'price-high') {
        const ca = exchangeCurrency(a), cb = exchangeCurrency(b);
        if (ca !== cb) return ca === 'ryo' ? -1 : 1;
        return (sort === 'price-low' ? a.price - b.price : b.price - a.price) || tieBreak();
    }
    if (sort === 'rarity') return ((EXCHANGE_RARITY_ORDER[b.rarity] ?? 0) - (EXCHANGE_RARITY_ORDER[a.rarity] ?? 0)) || tieBreak();
    return tieBreak();
}

export function isExchangeMarketPage(value: unknown): value is ExchangeMarketPage {
    if (!value || typeof value !== 'object') return false;
    const page = value as ExchangeMarketPage;
    return page.v === 2 && !!parseExchangeMarketQuery(page.query)
        && Number.isSafeInteger(page.page) && page.page >= 1
        && Number.isSafeInteger(page.pages) && page.pages >= 1 && page.page <= page.pages
        && Number.isSafeInteger(page.total) && page.total >= 0
        && page.pageSize === EXCHANGE_MARKET_PAGE_SIZE
        && Array.isArray(page.listings) && page.listings.length <= EXCHANGE_MARKET_PAGE_SIZE;
}
