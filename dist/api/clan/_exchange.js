"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAN_EXCHANGE_ITEMS = exports.CLAN_EXCHANGE_WEEKLY_CAP = void 0;
exports.refundClanExchangeTreasuryPurchase = refundClanExchangeTreasuryPurchase;
exports.eligibleCacheItems = eligibleCacheItems;
exports.buyClanExchangeItem = buyClanExchangeItem;
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const _clan_points_js_1 = require("../_clan-points.js");
exports.CLAN_EXCHANGE_WEEKLY_CAP = 1_000;
exports.CLAN_EXCHANGE_ITEMS = [
    // ── Camp (Lv 1+) — member issue ──────────────────────────────────
    {
        id: 'smallRyoPouch',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Genin Coin Cache',
        description: 'A drawstring purse of ryō, issued to every active clan member.',
        cost: 100,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'standard',
        reward: { kind: 'currency', currency: 'ryo', amount: 2_500 },
    },
    {
        id: 'boneCharmBundle',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Ossuary Charm Satchel',
        description: 'Ten carved bone charms strung for bloodline rites and events.',
        cost: 150,
        limit: { kind: 'weekly', count: 5 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 10 },
    },
    {
        id: 'fateShardBundle',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Fate Shard Offering',
        description: "Five Fate Shards drawn from the clan's offering bowl.",
        cost: 250,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'fateShards', amount: 5 },
    },
    {
        id: 'clanBannerFrame',
        tier: 1,
        hall: 'camp',
        requiredClanLevel: 1,
        name: 'Clan Banner Sigil',
        description: 'A clan banner sigil — reserved for the coming cosmetic frame rites.',
        cost: 500,
        limit: { kind: 'oneTime' },
        rarity: 'epic',
        reward: { kind: 'locked', reason: 'Coming Soon' },
    },
    // ── Dojo (Lv 7+) — proven contributors ───────────────────────────
    {
        id: 'largeRyoPouch',
        tier: 1,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Chūnin War Chest',
        description: "A chūnin's war chest — ten thousand ryō for a proven earner.",
        cost: 400,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'rare',
        reward: { kind: 'currency', currency: 'ryo', amount: 10_000 },
    },
    {
        id: 'boneCharmCrate',
        tier: 2,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Ossuary Reliquary',
        description: 'A lacquered reliquary of thirty-five bone charms.',
        cost: 450,
        limit: { kind: 'weekly', count: 3 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'boneCharms', amount: 35 },
    },
    {
        id: 'auraStone',
        tier: 2,
        hall: 'dojo',
        requiredClanLevel: 7,
        name: 'Kaguya Aura Stone',
        description: 'A single Kaguya aura stone for advanced shinobi growth.',
        cost: 800,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'auraStones', amount: 1 },
    },
    // ── Compound (Lv 15+) — officer stores ───────────────────────────
    {
        id: 'fateShardCrate',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: 'Sealed Fate Reliquary',
        description: 'A warded reliquary holding fifteen Fate Shards.',
        cost: 650,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'fateShards', amount: 15 },
    },
    {
        id: 'warSupplyGrant',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: "Quartermaster's Requisition",
        description: 'Requisition five hundred War Supply straight to the clan stores.',
        cost: 750,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 500 },
    },
    {
        id: 'territoryControlScroll',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: 'Border Claim Scroll',
        description: 'A sealed border claim scroll to reinforce a clan sector.',
        cost: 900,
        limit: { kind: 'weekly', count: 2 },
        rarity: 'epic',
        reward: { kind: 'item', itemId: 'territory-control-scroll', count: 1 },
    },
    {
        id: 'honorSealBundle',
        tier: 2,
        hall: 'compound',
        requiredClanLevel: 15,
        name: 'Rite of Honor Seals',
        description: 'Ten ceremonial Honor Seals for high-value shinobi development.',
        cost: 1_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'epic',
        reward: { kind: 'currency', currency: 'honorSeals', amount: 10 },
    },
    // ── Fortress (Lv 25+) — war stores ───────────────────────────────
    {
        id: 'premiumFateShardCrate',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Grand Fate Reliquary',
        description: 'A grand reliquary packed with thirty-five Fate Shards.',
        cost: 1_200,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'fateShards', amount: 35 },
    },
    {
        id: 'greaterWarSupplyGrant',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Grand Quartermaster Requisition',
        description: 'Requisition fifteen hundred War Supply to the clan stores.',
        cost: 1_750,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'treasury', currency: 'warSupply', amount: 1_500 },
    },
    {
        id: 'weaponCache',
        tier: 3,
        hall: 'fortress',
        requiredClanLevel: 25,
        name: 'Forbidden Armory Scroll',
        description: 'A forbidden armory scroll — unseals one Epic or Legendary weapon from the live catalog.',
        cost: 6_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'weapon' },
    },
    // ── Citadel (Lv 40+) — elite vault ───────────────────────────────
    {
        id: 'auraStoneBundle',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: 'Kaguya Aura Trove',
        description: 'A trove of three Kaguya aura stones bound in a clan scroll.',
        cost: 1_500,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'auraStones', amount: 3 },
    },
    {
        id: 'armorCache',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: 'Vault of the Fallen',
        description: 'A vault of the fallen — unseals one Epic or Legendary armor piece from the live catalog.',
        cost: 8_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'cache', cache: 'armor' },
    },
    {
        id: 'kageCoffer',
        tier: 3,
        hall: 'citadel',
        requiredClanLevel: 40,
        name: "Kage's Coffer",
        description: "The kage's own coffer — fifty thousand ryō for the clan's finest.",
        cost: 4_000,
        limit: { kind: 'weekly', count: 1 },
        rarity: 'legendary',
        reward: { kind: 'currency', currency: 'ryo', amount: 50_000 },
    },
];
const ITEM_BY_ID = new Map(exports.CLAN_EXCHANGE_ITEMS.map((item) => [item.id, item]));
const STACKABLE_EXCHANGE_ITEM_IDS = new Set(['territory-control-scroll']);
const ARMOR_SLOTS = new Set(['armor', 'head', 'body', 'waist', 'legs', 'feet']);
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function floorNonNegative(v) {
    return Math.max(0, Math.floor(num(v)));
}
function normalizeClanName(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function cleanPurchases(raw) {
    if (!raw || typeof raw !== 'object')
        return { weekly: {}, monthly: {}, oneTime: {} };
    const obj = raw;
    return {
        weekly: obj.weekly && typeof obj.weekly === 'object' ? obj.weekly : {},
        monthly: obj.monthly && typeof obj.monthly === 'object' ? obj.monthly : {},
        oneTime: obj.oneTime && typeof obj.oneTime === 'object' ? obj.oneTime : {},
    };
}
function purchaseCount(purchases, item, now) {
    if (item.limit.kind === 'weekly')
        return floorNonNegative(purchases.weekly?.[(0, _clan_points_js_1.clanPointWeekKey)(now)]?.[item.id]);
    if (item.limit.kind === 'monthly')
        return floorNonNegative(purchases.monthly?.[(0, _clan_points_js_1.clanPointMonthKey)(now)]?.[item.id]);
    return purchases.oneTime?.[item.id] ? 1 : 0;
}
function purchaseLimitCount(item) {
    return item.limit.kind === 'oneTime' ? 1 : item.limit.count;
}
function recordPurchase(purchases, item, now) {
    const next = cleanPurchases(purchases);
    if (item.limit.kind === 'weekly') {
        const key = (0, _clan_points_js_1.clanPointWeekKey)(now);
        next.weekly = { ...(next.weekly ?? {}), [key]: { ...(next.weekly?.[key] ?? {}), [item.id]: purchaseCount(next, item, now) + 1 } };
    }
    else if (item.limit.kind === 'monthly') {
        const key = (0, _clan_points_js_1.clanPointMonthKey)(now);
        next.monthly = { ...(next.monthly ?? {}), [key]: { ...(next.monthly?.[key] ?? {}), [item.id]: purchaseCount(next, item, now) + 1 } };
    }
    else {
        next.oneTime = { ...(next.oneTime ?? {}), [item.id]: true };
    }
    return next;
}
function removePurchase(purchases, item, now) {
    const next = cleanPurchases(purchases);
    if (item.limit.kind === 'weekly') {
        const key = (0, _clan_points_js_1.clanPointWeekKey)(now);
        const bucket = { ...(next.weekly?.[key] ?? {}) };
        const count = floorNonNegative(bucket[item.id]);
        if (count <= 1)
            delete bucket[item.id];
        else
            bucket[item.id] = count - 1;
        next.weekly = { ...(next.weekly ?? {}) };
        if (Object.keys(bucket).length)
            next.weekly[key] = bucket;
        else
            delete next.weekly[key];
    }
    else if (item.limit.kind === 'monthly') {
        const key = (0, _clan_points_js_1.clanPointMonthKey)(now);
        const bucket = { ...(next.monthly?.[key] ?? {}) };
        const count = floorNonNegative(bucket[item.id]);
        if (count <= 1)
            delete bucket[item.id];
        else
            bucket[item.id] = count - 1;
        next.monthly = { ...(next.monthly ?? {}) };
        if (Object.keys(bucket).length)
            next.monthly[key] = bucket;
        else
            delete next.monthly[key];
    }
    else {
        next.oneTime = { ...(next.oneTime ?? {}) };
        delete next.oneTime[item.id];
    }
    return next;
}
function refundClanExchangeTreasuryPurchase(args) {
    const item = ITEM_BY_ID.get(args.itemId);
    if (!item || item.reward.kind !== 'treasury')
        return args.character;
    const now = args.now ?? new Date();
    return {
        ...args.character,
        clanPoints: floorNonNegative(args.character.clanPoints) + item.cost,
        clanExchangePurchases: removePurchase(cleanPurchases(args.character.clanExchangePurchases), item, now),
    };
}
function addItem(character, itemId, count) {
    const n = Math.max(1, Math.floor(count));
    if (STACKABLE_EXCHANGE_ITEM_IDS.has(itemId)) {
        const stacks = Array.isArray(character.itemStacks)
            ? character.itemStacks
            : [];
        const counts = new Map();
        for (const stack of stacks) {
            const id = String(stack.itemId ?? '');
            if (!id)
                continue;
            counts.set(id, floorNonNegative(stack.count) + (counts.get(id) ?? 0));
        }
        counts.set(itemId, (counts.get(itemId) ?? 0) + n);
        return {
            ...character,
            itemStacks: [...counts.entries()].map(([id, c]) => ({ itemId: id, count: Math.min(9_999, c) })),
        };
    }
    const inventory = Array.isArray(character.inventory) ? character.inventory.filter((v) => typeof v === 'string') : [];
    return { ...character, inventory: [...inventory, ...Array.from({ length: n }, () => itemId)] };
}
function hasCatalogItem(catalog, itemId) {
    return !!catalog[itemId];
}
function isWeapon(item) {
    return item.slot === 'weapon' || (item.slot === 'hand' && Number.isFinite(Number(item.weaponEp)));
}
function isArmor(item) {
    return ARMOR_SLOTS.has(item.slot);
}
function eligibleCacheItems(catalog = _item_catalog_js_1.ITEM_CATALOG, cache) {
    const all = Object.values(catalog).filter((item) => {
        const rarity = String(item.rarity ?? '').toLowerCase();
        if (rarity !== 'epic' && rarity !== 'legendary')
            return false;
        return cache === 'weapon' ? isWeapon(item) : isArmor(item);
    });
    return {
        epic: all.filter((item) => String(item.rarity).toLowerCase() === 'epic'),
        legendary: all.filter((item) => String(item.rarity).toLowerCase() === 'legendary'),
        all,
    };
}
function rollCacheItem(catalog, cache, rng) {
    const pools = eligibleCacheItems(catalog, cache);
    if (pools.all.length === 0)
        return null;
    const wantLegendary = rng() >= 0.5;
    const primary = wantLegendary ? pools.legendary : pools.epic;
    const fallback = wantLegendary ? pools.epic : pools.legendary;
    const pool = primary.length ? primary : fallback;
    return pool[Math.floor(rng() * pool.length)] ?? null;
}
function applyReward(character, clanData, reward, catalog, rng) {
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
        const treasury = (clanData.treasury && typeof clanData.treasury === 'object') ? clanData.treasury : {};
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
function buyClanExchangeItem(args) {
    const now = args.now ?? new Date();
    const rng = args.rng ?? Math.random;
    const catalog = args.itemCatalog ?? _item_catalog_js_1.ITEM_CATALOG;
    const item = ITEM_BY_ID.get(args.itemId);
    if (!item)
        return { ok: false, code: 'unknown-item', error: 'Unknown Clan Exchange item.' };
    if (!args.character.clan)
        return { ok: false, code: 'not-in-clan', error: 'Join a clan before using Clan Exchange.' };
    if (!args.clanData)
        return { ok: false, code: 'clan-not-found', error: 'Clan data could not be found.' };
    if (normalizeClanName(args.character.clan) !== normalizeClanName(args.clanData.name)) {
        return { ok: false, code: 'wrong-clan', error: 'This exchange belongs to a different clan.' };
    }
    if (item.reward.kind === 'locked')
        return { ok: false, code: 'coming-soon', error: item.reward.reason };
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
    const rewardApplied = applyReward({ ...args.character, clanPoints: clanPoints - item.cost }, args.clanData, item.reward, catalog, rng);
    if (rewardApplied.error)
        return rewardApplied.error;
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
