import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import { clanPointMonthKey, clanPointWeekKey } from '../_clan-points.js';

export const CLAN_EXCHANGE_WEEKLY_CAP = 1_000;

export type ClanExchangeItemId =
    | 'smallRyoPouch'
    | 'boneCharmBundle'
    | 'fateShardBundle'
    | 'clanBannerFrame'
    | 'largeRyoPouch'
    | 'boneCharmCrate'
    | 'fateShardCrate'
    | 'auraStone'
    | 'warSupplyGrant'
    | 'territoryControlScroll'
    | 'honorSealBundle'
    | 'premiumFateShardCrate'
    | 'auraStoneBundle'
    | 'greaterWarSupplyGrant'
    | 'weaponCache'
    | 'armorCache';

export type ClanExchangeLimit =
    | { kind: 'weekly'; count: number }
    | { kind: 'monthly'; count: number }
    | { kind: 'oneTime' };

export type ClanExchangeReward =
    | { kind: 'currency'; currency: 'ryo' | 'boneCharms' | 'fateShards' | 'auraStones' | 'honorSeals'; amount: number }
    | { kind: 'item'; itemId: string; count: number }
    | { kind: 'treasury'; currency: 'warSupply'; amount: number }
    | { kind: 'cache'; cache: 'weapon' | 'armor' }
    | { kind: 'locked'; reason: string };

export type ClanExchangeItemDef = {
    id: ClanExchangeItemId;
    tier: 1 | 2 | 3;
    requiredClanLevel: number;
    name: string;
    description: string;
    cost: number;
    limit: ClanExchangeLimit;
    rarity: 'standard' | 'rare' | 'epic' | 'legendary';
    reward: ClanExchangeReward;
};

export type ClanExchangePurchases = {
    weekly?: Record<string, Record<string, number>>;
    monthly?: Record<string, Record<string, number>>;
    oneTime?: Record<string, boolean>;
};

export type ClanExchangeReveal = {
    kind: 'item';
    itemId: string;
    name: string;
    rarity: string;
    slot: string;
};

export type ClanExchangePurchaseSuccess = {
    ok: true;
    character: Record<string, unknown>;
    clanData: Record<string, unknown>;
    item: ClanExchangeItemDef;
    purchaseCount: number;
    remaining: number;
    reveal?: ClanExchangeReveal;
};

export type ClanExchangePurchaseFailure = {
    ok: false;
    code:
        | 'not-in-clan'
        | 'clan-not-found'
        | 'wrong-clan'
        | 'unknown-item'
        | 'coming-soon'
        | 'level-locked'
        | 'insufficient-points'
        | 'limit-reached'
        | 'empty-cache';
    error: string;
};

export type ClanExchangePurchaseResult = ClanExchangePurchaseSuccess | ClanExchangePurchaseFailure;

export const CLAN_EXCHANGE_ITEMS: ClanExchangeItemDef[] = [
    {
        id: 'smallRyoPouch',
        tier: 1,
        requiredClanLevel: 1,
        name: 'Small Ryo Pouch',
        description: 'A sealed clan stipend for active members.',
        cost: 100,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'standard',
        reward: { kind: 'currency', currency: 'ryo', amount: 2_500 },
    },
    {
        id: 'boneCharmBundle',
        tier: 1,
        requiredClanLevel: 1,
        name: 'Bone Charm Bundle',
        description: 'Ten ritual charms used in bloodline and event progression.',
        cost: 150,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 10 },
    },
    {
        id: 'fateShardBundle',
        tier: 1,
        requiredClanLevel: 1,
        name: 'Fate Shard Bundle',
        description: 'Five Fate Shards from the clan vault.',
        cost: 250,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'fateShards', amount: 5 },
    },
    {
        id: 'clanBannerFrame',
        tier: 1,
        requiredClanLevel: 1,
        name: 'Clan Banner Frame',
        description: 'A profile banner cosmetic reserved for a future cosmetic frame system.',
        cost: 500,
        limit: { kind: 'oneTime' },
        rarity: 'epic',
        reward: { kind: 'locked', reason: 'Coming Soon' },
    },
    {
        id: 'largeRyoPouch',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Large Ryo Pouch',
        description: 'A heavier stipend for proven clan contributors.',
        cost: 400,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'ryo', amount: 10_000 },
    },
    {
        id: 'boneCharmCrate',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Bone Charm Crate',
        description: 'A lacquered crate containing thirty-five Bone Charms.',
        cost: 450,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 35 },
    },
    {
        id: 'fateShardCrate',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Fate Shard Crate',
        description: 'A protected shipment of fifteen Fate Shards.',
        cost: 650,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'fateShards', amount: 15 },
    },
    {
        id: 'auraStone',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Aura Stone',
        description: 'A focused Aura Stone for advanced shinobi growth.',
        cost: 800,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'auraStones', amount: 1 },
    },
    {
        id: 'warSupplyGrant',
        tier: 2,
        requiredClanLevel: 5,
        name: 'War Supply Grant',
        description: 'Send five hundred War Supply directly to your clan treasury.',
        cost: 750,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 500 },
    },
    {
        id: 'territoryControlScroll',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Territory Control Scroll',
        description: 'A real territory scroll used to reinforce clan sector control.',
        cost: 900,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'item', itemId: 'territory-control-scroll', count: 1 },
    },
    {
        id: 'honorSealBundle',
        tier: 2,
        requiredClanLevel: 5,
        name: 'Honor Seal Bundle',
        description: 'Ten Honor Seals for high-value shinobi development.',
        cost: 1_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'honorSeals', amount: 10 },
    },
    {
        id: 'premiumFateShardCrate',
        tier: 3,
        requiredClanLevel: 10,
        name: 'Premium Fate Shard Crate',
        description: 'A ceremonial crate packed with thirty-five Fate Shards.',
        cost: 1_200,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'fateShards', amount: 35 },
    },
    {
        id: 'auraStoneBundle',
        tier: 3,
        requiredClanLevel: 10,
        name: 'Aura Stone Bundle',
        description: 'Three Aura Stones bound in a clan exchange scroll.',
        cost: 1_500,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'auraStones', amount: 3 },
    },
    {
        id: 'greaterWarSupplyGrant',
        tier: 3,
        requiredClanLevel: 10,
        name: 'Greater War Supply Grant',
        description: 'Send fifteen hundred War Supply directly to your clan treasury.',
        cost: 1_750,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 1_500 },
    },
    {
        id: 'weaponCache',
        tier: 3,
        requiredClanLevel: 10,
        name: 'Weapon Cache',
        description: 'Roll one existing Epic or Legendary weapon from the real item catalog.',
        cost: 6_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'weapon' },
    },
    {
        id: 'armorCache',
        tier: 3,
        requiredClanLevel: 10,
        name: 'Armor Cache',
        description: 'Roll one existing Epic or Legendary armor piece from the real item catalog.',
        cost: 8_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'armor' },
    },
];

const ITEM_BY_ID = new Map(CLAN_EXCHANGE_ITEMS.map((item) => [item.id, item]));
const STACKABLE_EXCHANGE_ITEM_IDS = new Set(['territory-control-scroll']);
const ARMOR_SLOTS = new Set(['armor', 'head', 'body', 'waist', 'legs', 'feet']);

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function floorNonNegative(v: unknown): number {
    return Math.max(0, Math.floor(num(v)));
}

function normalizeClanName(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanPurchases(raw: unknown): ClanExchangePurchases {
    if (!raw || typeof raw !== 'object') return { weekly: {}, monthly: {}, oneTime: {} };
    const obj = raw as ClanExchangePurchases;
    return {
        weekly: obj.weekly && typeof obj.weekly === 'object' ? obj.weekly : {},
        monthly: obj.monthly && typeof obj.monthly === 'object' ? obj.monthly : {},
        oneTime: obj.oneTime && typeof obj.oneTime === 'object' ? obj.oneTime : {},
    };
}

function purchaseCount(purchases: ClanExchangePurchases, item: ClanExchangeItemDef, now: Date): number {
    if (item.limit.kind === 'weekly') return floorNonNegative(purchases.weekly?.[clanPointWeekKey(now)]?.[item.id]);
    if (item.limit.kind === 'monthly') return floorNonNegative(purchases.monthly?.[clanPointMonthKey(now)]?.[item.id]);
    return purchases.oneTime?.[item.id] ? 1 : 0;
}

function purchaseLimitCount(item: ClanExchangeItemDef): number {
    return item.limit.kind === 'oneTime' ? 1 : item.limit.count;
}

function recordPurchase(purchases: ClanExchangePurchases, item: ClanExchangeItemDef, now: Date): ClanExchangePurchases {
    const next = cleanPurchases(purchases);
    if (item.limit.kind === 'weekly') {
        const key = clanPointWeekKey(now);
        next.weekly = { ...(next.weekly ?? {}), [key]: { ...(next.weekly?.[key] ?? {}), [item.id]: purchaseCount(next, item, now) + 1 } };
    } else if (item.limit.kind === 'monthly') {
        const key = clanPointMonthKey(now);
        next.monthly = { ...(next.monthly ?? {}), [key]: { ...(next.monthly?.[key] ?? {}), [item.id]: purchaseCount(next, item, now) + 1 } };
    } else {
        next.oneTime = { ...(next.oneTime ?? {}), [item.id]: true };
    }
    return next;
}

function addItem(character: Record<string, unknown>, itemId: string, count: number): Record<string, unknown> {
    const n = Math.max(1, Math.floor(count));
    if (STACKABLE_EXCHANGE_ITEM_IDS.has(itemId)) {
        const stacks = Array.isArray(character.itemStacks)
            ? (character.itemStacks as Array<Record<string, unknown>>)
            : [];
        const counts = new Map<string, number>();
        for (const stack of stacks) {
            const id = String(stack.itemId ?? '');
            if (!id) continue;
            counts.set(id, floorNonNegative(stack.count) + (counts.get(id) ?? 0));
        }
        counts.set(itemId, (counts.get(itemId) ?? 0) + n);
        return {
            ...character,
            itemStacks: [...counts.entries()].map(([id, c]) => ({ itemId: id, count: Math.min(9_999, c) })),
        };
    }
    const inventory = Array.isArray(character.inventory) ? (character.inventory as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    return { ...character, inventory: [...inventory, ...Array.from({ length: n }, () => itemId)] };
}

function hasCatalogItem(catalog: Record<string, CatalogItem>, itemId: string): boolean {
    return !!catalog[itemId];
}

function isWeapon(item: CatalogItem): boolean {
    return item.slot === 'weapon' || (item.slot === 'hand' && Number.isFinite(Number(item.weaponEp)));
}

function isArmor(item: CatalogItem): boolean {
    return ARMOR_SLOTS.has(item.slot);
}

export function eligibleCacheItems(
    catalog: Record<string, CatalogItem> = ITEM_CATALOG,
    cache: 'weapon' | 'armor',
): { epic: CatalogItem[]; legendary: CatalogItem[]; all: CatalogItem[] } {
    const all = Object.values(catalog).filter((item) => {
        const rarity = String(item.rarity ?? '').toLowerCase();
        if (rarity !== 'epic' && rarity !== 'legendary') return false;
        return cache === 'weapon' ? isWeapon(item) : isArmor(item);
    });
    return {
        epic: all.filter((item) => String(item.rarity).toLowerCase() === 'epic'),
        legendary: all.filter((item) => String(item.rarity).toLowerCase() === 'legendary'),
        all,
    };
}

function rollCacheItem(catalog: Record<string, CatalogItem>, cache: 'weapon' | 'armor', rng: () => number): CatalogItem | null {
    const pools = eligibleCacheItems(catalog, cache);
    if (pools.all.length === 0) return null;
    const wantLegendary = rng() >= 0.5;
    const primary = wantLegendary ? pools.legendary : pools.epic;
    const fallback = wantLegendary ? pools.epic : pools.legendary;
    const pool = primary.length ? primary : fallback;
    return pool[Math.floor(rng() * pool.length)] ?? null;
}

function applyReward(
    character: Record<string, unknown>,
    clanData: Record<string, unknown>,
    reward: ClanExchangeReward,
    catalog: Record<string, CatalogItem>,
    rng: () => number,
): { character: Record<string, unknown>; clanData: Record<string, unknown>; reveal?: ClanExchangeReveal; error?: ClanExchangePurchaseFailure } {
    if (reward.kind === 'currency') {
        return {
            character: { ...character, [reward.currency]: floorNonNegative(character[reward.currency]) + reward.amount },
            clanData,
        };
    }
    if (reward.kind === 'item') {
        if (!hasCatalogItem(catalog, reward.itemId)) {
            return { character, clanData, error: { ok: false, code: 'empty-cache', error: 'That exchange item is not configured in the item catalog.' } };
        }
        return { character: addItem(character, reward.itemId, reward.count), clanData };
    }
    if (reward.kind === 'treasury') {
        const treasury = (clanData.treasury && typeof clanData.treasury === 'object') ? clanData.treasury as Record<string, unknown> : {};
        return {
            character,
            clanData: { ...clanData, treasury: { ...treasury, [reward.currency]: floorNonNegative(treasury[reward.currency]) + reward.amount } },
        };
    }
    if (reward.kind === 'cache') {
        const rolled = rollCacheItem(catalog, reward.cache, rng);
        if (!rolled) {
            return {
                character,
                clanData,
                error: {
                    ok: false,
                    code: 'empty-cache',
                    error: reward.cache === 'weapon' ? 'No eligible Epic or Legendary weapons are configured.' : 'No eligible Epic or Legendary armor is configured.',
                },
            };
        }
        return {
            character: addItem(character, rolled.id, 1),
            clanData,
            reveal: { kind: 'item', itemId: rolled.id, name: rolled.name, rarity: rolled.rarity, slot: rolled.slot },
        };
    }
    return { character, clanData, error: { ok: false, code: 'coming-soon', error: reward.reason } };
}

export function buyClanExchangeItem(args: {
    character: Record<string, unknown>;
    clanData: Record<string, unknown> | null | undefined;
    itemId: string;
    itemCatalog?: Record<string, CatalogItem>;
    now?: Date;
    rng?: () => number;
}): ClanExchangePurchaseResult {
    const now = args.now ?? new Date();
    const rng = args.rng ?? Math.random;
    const catalog = args.itemCatalog ?? ITEM_CATALOG;
    const item = ITEM_BY_ID.get(args.itemId as ClanExchangeItemId);
    if (!item) return { ok: false, code: 'unknown-item', error: 'Unknown Clan Exchange item.' };
    if (!args.character.clan) return { ok: false, code: 'not-in-clan', error: 'Join a clan before using Clan Exchange.' };
    if (!args.clanData) return { ok: false, code: 'clan-not-found', error: 'Clan data could not be found.' };
    if (normalizeClanName(args.character.clan) !== normalizeClanName(args.clanData.name)) {
        return { ok: false, code: 'wrong-clan', error: 'This exchange belongs to a different clan.' };
    }
    if (item.reward.kind === 'locked') return { ok: false, code: 'coming-soon', error: item.reward.reason };
    const clanLevel = Math.max(1, Math.floor(num(args.clanData.level ?? 1)));
    if (clanLevel < item.requiredClanLevel) {
        return { ok: false, code: 'level-locked', error: `Requires Clan Level ${item.requiredClanLevel}.` };
    }
    const clanPoints = floorNonNegative(args.character.clanPoints);
    if (clanPoints < item.cost) {
        return { ok: false, code: 'insufficient-points', error: `You need ${item.cost.toLocaleString()} Clan Points.` };
    }
    const purchases = cleanPurchases(args.character.clanExchangePurchases);
    const count = purchaseCount(purchases, item, now);
    const limit = purchaseLimitCount(item);
    if (count >= limit) {
        return { ok: false, code: 'limit-reached', error: item.limit.kind === 'oneTime' ? 'Already purchased.' : 'Purchase limit reached for this period.' };
    }

    const rewardApplied = applyReward(
        { ...args.character, clanPoints: clanPoints - item.cost },
        args.clanData,
        item.reward,
        catalog,
        rng,
    );
    if (rewardApplied.error) return rewardApplied.error;

    const nextPurchases = recordPurchase(purchases, item, now);
    const nextCount = count + 1;
    return {
        ok: true,
        character: { ...rewardApplied.character, clanExchangePurchases: nextPurchases },
        clanData: rewardApplied.clanData,
        item,
        purchaseCount: nextCount,
        remaining: Math.max(0, limit - nextCount),
        reveal: rewardApplied.reveal,
    };
}
