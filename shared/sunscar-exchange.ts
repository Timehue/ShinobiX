export const EXCHANGE_FEE_PERCENT = 5;
export const EXCHANGE_LISTING_LIMIT = 30;
export const EXCHANGE_MAX_PRICE = 1_000_000_000;
export const EXCHANGE_MAX_QUANTITY = 9999;
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
export function exchangeCurrency(listing: Pick<ExchangeListing, 'currency'>): ExchangeCurrency {
    return listing.currency ?? 'ryo';
}
export function exchangeFee(price: number): number {
    return Math.floor(price * EXCHANGE_FEE_PERCENT / 100);
}
export const EXCHANGE_RESOURCES: Record<string, string> = {
    fateShards: 'Fate Shards', boneCharms: 'Bone Charms', auraStones: 'Aura Stones',
    honorSeals: 'Honor Seals', mythicSeals: 'Mythic Seals',
};
