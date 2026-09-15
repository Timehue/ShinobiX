export const EXCHANGE_FEE_PERCENT = 5;
export const EXCHANGE_LISTING_LIMIT = 30;
export const EXCHANGE_MAX_PRICE = 1_000_000_000;
export const EXCHANGE_MAX_QUANTITY = 9999;

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
    fee: number;
    proceeds: number;
    createdAt: number;
    completedAt?: number;
    state: 'preparing' | 'active' | 'buying' | 'sold' | 'cancelling' | 'cancelled' | 'failed';
};
export function exchangeFee(price: number): number {
    return Math.floor(price * EXCHANGE_FEE_PERCENT / 100);
}
export const EXCHANGE_RESOURCES: Record<string, string> = {
    fateShards: 'Fate Shards', boneCharms: 'Bone Charms', auraStones: 'Aura Stones',
    honorSeals: 'Honor Seals', mythicSeals: 'Mythic Seals',
};
