"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shopDiscountPercent = shopDiscountPercent;
exports.discountedShopCost = discountedShopCost;
exports.isPurchasableItem = isPurchasableItem;
exports.applyItemPurchase = applyItemPurchase;
exports.applyCardPackPurchase = applyCardPackPurchase;
const _settlement_receipts_js_1 = require("../_settlement-receipts.js");
const PACKS = {
    standard: { count: 5, rarities: ['common', 'rare'], cost: 250, currency: 'ryo' },
    epic: { count: 1, rarities: ['epic'], cost: 10, currency: 'fateShards' },
    legendary: { count: 1, rarities: ['legendary'], cost: 30, currency: 'fateShards' },
};
const SHOP_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'hand', 'aura', 'weapon', 'thrown', 'item', 'potion', 'accessory']);
const RYO_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic']);
const FATE_RARITIES = new Set(['legendary', 'mythic']);
const MAX_STACK = 9999;
const MAX_INVENTORY = 500;
const MAX_TILE_CARDS = 10_000;
function whole(raw) {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}
function boundedLevel(raw, max) {
    const value = Math.floor(Number(raw) || 0);
    return Math.max(0, Math.min(max, value));
}
function shopDiscountPercent(character, currency) {
    if (currency === 'fateShards')
        return character.elderFocus === 'trade' ? 5 : 0;
    const village = character.villageUpgrades && typeof character.villageUpgrades === 'object'
        ? character.villageUpgrades
        : {};
    const clan = character.clanUpgradeLevels && typeof character.clanUpgradeLevels === 'object'
        ? character.clanUpgradeLevels
        : {};
    return boundedLevel(village.shop, 50) * 0.25
        + (character.elderFocus === 'trade' ? 5 : 0)
        + boundedLevel(clan.blacksmith, 50) * 0.2
        + (character.clanDoctrine === 'merchant' ? 5 : 0);
}
function discountedShopCost(cost, percent) {
    return Math.max(1, Math.floor(cost * Math.max(0, 1 - percent / 100)));
}
function storedItems(character) {
    const rawStacks = character.itemStacks ?? [];
    if (!Array.isArray(character.inventory) || !Array.isArray(rawStacks))
        return null;
    if (!character.inventory.every((entry) => typeof entry === 'string' && entry.length > 0))
        return null;
    const stacks = new Map();
    for (const raw of rawStacks) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return null;
        const entry = raw;
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : '';
        const count = whole(entry.count);
        if (!itemId || count === null || count <= 0 || count > MAX_STACK)
            return null;
        const next = (stacks.get(itemId) ?? 0) + count;
        if (next > MAX_STACK)
            return null;
        stacks.set(itemId, next);
    }
    return { inventory: [...character.inventory], stacks };
}
function itemCount(items, itemId) {
    return (items.stacks.get(itemId) ?? 0) + items.inventory.filter((id) => id === itemId).length;
}
function holdCap(item) {
    const slot = item.slot === 'weapon' ? 'hand' : item.slot === 'armor' ? 'body' : item.slot === 'accessory' ? 'aura' : item.slot;
    if (slot === 'potion')
        return 2;
    if (slot === 'thrown')
        return 50;
    if (slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null))
        return 50;
    return null;
}
function itemCurrency(item) {
    if (RYO_RARITIES.has(item.rarity))
        return 'ryo';
    if (FATE_RARITIES.has(item.rarity))
        return 'fateShards';
    return null;
}
function isPurchasableItem(item) {
    if (!SHOP_SLOTS.has(item.slot) || item.cost <= 0)
        return false;
    const craftOnlyWeapon = item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
    const normalizedSlot = item.slot === 'armor' ? 'body' : item.slot;
    const craftOnlyArmor = ['body', 'head', 'waist', 'legs', 'feet'].includes(normalizedSlot)
        && item.armorQuality != null && item.rarity === 'rare';
    return !craftOnlyWeapon && !craftOnlyArmor && itemCurrency(item) !== null;
}
function replayValue(receipt) {
    const value = receipt.value;
    if (value.kind === 'item-purchase'
        && typeof value.itemId === 'string'
        && whole(value.quantity) !== null
        && (value.currency === 'ryo' || value.currency === 'fateShards')
        && whole(value.totalCost) !== null)
        return value;
    if (value.kind === 'card-pack'
        && (value.packId === 'standard' || value.packId === 'epic' || value.packId === 'legendary')
        && Array.isArray(value.drawn) && value.drawn.every((id) => typeof id === 'string')
        && (value.currency === 'ryo' || value.currency === 'fateShards')
        && whole(value.totalCost) !== null)
        return value;
    return null;
}
function inspect(character, requestId, fingerprint) {
    const receipt = (0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, requestId, fingerprint);
    if (receipt.status === 'invalid')
        return { fresh: false, result: { ok: false, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' } };
    if (receipt.status === 'conflict')
        return { fresh: false, result: { ok: false, status: 409, error: 'That settlement request ID was already used for another action.' } };
    if (receipt.status === 'replay') {
        const value = replayValue(receipt.receipt);
        if (!value)
            return { fresh: false, result: { ok: false, status: 409, error: 'Stored settlement receipt is invalid. Contact support.' } };
        return { fresh: false, result: { ok: true, character, value, replayed: true } };
    }
    return { fresh: true, receipts: receipt.receipts };
}
function withReceipt(character, receipts, requestId, fingerprint, value, now) {
    return {
        ok: true,
        replayed: false,
        value,
        character: (0, _settlement_receipts_js_1.appendSettlementReceipt)(character, receipts, { requestId, fingerprint, value, settledAt: now }),
    };
}
function applyItemPurchase(character, item, quantityRaw, requestId, now) {
    const requested = whole(quantityRaw);
    if (requested === null || requested < 1 || requested > 50)
        return { ok: false, status: 400, error: 'Quantity must be a whole number from 1 to 50.' };
    const fingerprint = `shop:item:${item.id}:${requested}`;
    const prior = inspect(character, requestId, fingerprint);
    if (!prior.fresh)
        return prior.result;
    if (!isPurchasableItem(item))
        return { ok: false, status: 400, error: 'That item is not sold by this shop.' };
    const level = whole(character.level);
    if (level === null)
        return { ok: false, status: 409, error: 'Stored level is invalid. Contact support.' };
    if (item.levelReq && level < item.levelReq)
        return { ok: false, status: 400, error: `Requires Level ${item.levelReq}.` };
    const items = storedItems(character);
    if (!items)
        return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
    const cap = holdCap(item);
    const quantity = cap === null ? 1 : Math.min(requested, Math.max(0, cap - itemCount(items, item.id)));
    if (quantity <= 0)
        return { ok: false, status: 400, error: `You can only carry ${cap} ${item.name}.` };
    if (cap === null && itemCount(items, item.id) > 0)
        return { ok: false, status: 400, error: 'You already own that item.' };
    const currency = itemCurrency(item);
    const balance = whole(character[currency]);
    if (balance === null)
        return { ok: false, status: 409, error: `Stored ${currency} balance is invalid. Contact support.` };
    const unitCost = discountedShopCost(item.cost, shopDiscountPercent(character, currency));
    const totalCost = unitCost * quantity;
    if (!Number.isSafeInteger(totalCost) || balance < totalCost)
        return { ok: false, status: 400, error: `Not enough ${currency === 'ryo' ? 'ryo' : 'Fate Shards'}.` };
    if (item.stackable) {
        const next = (items.stacks.get(item.id) ?? 0) + quantity;
        if (next > MAX_STACK)
            return { ok: false, status: 409, error: 'That item stack is full.' };
        items.stacks.set(item.id, next);
    }
    else {
        if (items.inventory.length + quantity > MAX_INVENTORY)
            return { ok: false, status: 409, error: 'Your inventory is full.' };
        for (let i = 0; i < quantity; i += 1)
            items.inventory.push(item.id);
    }
    const value = { kind: 'item-purchase', itemId: item.id, quantity, currency, totalCost };
    return withReceipt({
        ...character,
        [currency]: balance - totalCost,
        inventory: items.inventory,
        itemStacks: [...items.stacks.entries()].map(([itemId, count]) => ({ itemId, count })),
    }, prior.receipts, requestId, fingerprint, value, now);
}
function applyCardPackPurchase(character, cards, packId, requestId, now, pickIndex) {
    const pack = PACKS[packId];
    const fingerprint = `shop:pack:${packId}`;
    const prior = inspect(character, requestId, fingerprint);
    if (!prior.fresh)
        return prior.result;
    const pool = [...cards.values()].filter((card) => pack.rarities.includes(card.rarity));
    if (!pool.length)
        return { ok: false, status: 409, error: 'That card pack has no eligible cards. Contact support.' };
    if (!Array.isArray(character.tileCards ?? []) || !character.tileCards.every((id) => typeof id === 'string')) {
        return { ok: false, status: 409, error: 'Stored card collection is invalid. Contact support.' };
    }
    const owned = [...(character.tileCards ?? [])];
    if (owned.length + pack.count > MAX_TILE_CARDS)
        return { ok: false, status: 409, error: 'Your card collection is full.' };
    const balance = whole(character[pack.currency]);
    if (balance === null)
        return { ok: false, status: 409, error: 'Stored currency balance is invalid. Contact support.' };
    const totalCost = discountedShopCost(pack.cost, shopDiscountPercent(character, pack.currency));
    if (balance < totalCost)
        return { ok: false, status: 400, error: `Not enough ${pack.currency === 'ryo' ? 'ryo' : 'Fate Shards'}.` };
    const drawn = [];
    for (let i = 0; i < pack.count; i += 1) {
        const index = pickIndex(pool.length);
        if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length)
            return { ok: false, status: 409, error: 'Card draw failed safely. Please retry.' };
        drawn.push(pool[index].id);
    }
    const value = { kind: 'card-pack', packId, drawn, currency: pack.currency, totalCost };
    return withReceipt({ ...character, [pack.currency]: balance - totalCost, tileCards: [...owned, ...drawn] }, prior.receipts, requestId, fingerprint, value, now);
}
