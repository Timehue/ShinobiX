import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    type ServerSettlementReceipt,
} from '../_settlement-receipts.js';
import type { SettlementCard, SettlementItem } from './_catalog.js';
import { canAppendPackableChronicleCards } from '../card-clash/_collection-cap.js';
import { isMarketplaceCard } from '../clan/war/_card-catalog.js';
import { effectiveItemLevelReq, meetsItemLevelReq } from '../../shared/item-level-gate.js';

export type ShopPackId = 'standard' | 'epic' | 'legendary';
// 'chroniclePoints' is valid for card packs only (the Basic Card Pack); shop
// ITEMS still trade exclusively in ryo / Fate Shards via itemCurrency().
export type ShopCurrency = 'ryo' | 'fateShards' | 'chroniclePoints';

export type ShopSettlementValue =
    | { kind: 'item-purchase'; itemId: string; quantity: number; currency: ShopCurrency; totalCost: number }
    | { kind: 'card-pack'; packId: ShopPackId; drawn: string[]; currency: ShopCurrency; totalCost: number };

export type ShopSettlementResult =
    | { ok: true; character: Record<string, unknown>; value: ShopSettlementValue; replayed: boolean }
    | { ok: false; status: 400 | 409; error: string };

// Kept aligned with the LIVE pack table in api/card-clash/_pack.ts (the path
// the shipped client actually buys through): same prices, currencies, rarity
// bands, and storefront pool halves. api/_cross-build-parity.test.ts pins the
// Shop's odds disclosure to this table, so drift here is a player-facing lie.
const PACKS: Record<ShopPackId, { count: number; rarities: SettlementCard['rarity'][]; cost: number; currency: ShopCurrency; pool: 'shop' | 'marketplace' }> = {
    // The Basic Card Pack costs Chronicle Points (Echoes of War), NOT ryo —
    // this legacy settlement path must never re-grow a ryo price for it.
    standard: { count: 5, rarities: ['common', 'rare'], cost: 100, currency: 'chroniclePoints', pool: 'shop' },
    epic: { count: 1, rarities: ['rare', 'epic'], cost: 10, currency: 'fateShards', pool: 'marketplace' },
    legendary: { count: 1, rarities: ['legendary'], cost: 30, currency: 'fateShards', pool: 'marketplace' },
};
const SHOP_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'hand', 'aura', 'weapon', 'thrown', 'item', 'potion', 'accessory']);
const RYO_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic']);
const FATE_RARITIES = new Set(['legendary', 'mythic']);
const MAX_STACK = 9999;
const MAX_INVENTORY = 500;

type StoredItems = { inventory: string[]; stacks: Map<string, number> };

function whole(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function boundedLevel(raw: unknown, max: number): number {
    const value = Math.floor(Number(raw) || 0);
    return Math.max(0, Math.min(max, value));
}

export function shopDiscountPercent(character: Record<string, unknown>, currency: ShopCurrency): number {
    // Chronicle Points sit outside the ryo economy: no discount ever applies.
    if (currency === 'chroniclePoints') return 0;
    if (currency === 'fateShards') return character.elderFocus === 'trade' ? 5 : 0;
    const village = character.villageUpgrades && typeof character.villageUpgrades === 'object'
        ? character.villageUpgrades as Record<string, unknown>
        : {};
    const clan = character.clanUpgradeLevels && typeof character.clanUpgradeLevels === 'object'
        ? character.clanUpgradeLevels as Record<string, unknown>
        : {};
    return boundedLevel(village.shop, 50) * 0.25
        + (character.elderFocus === 'trade' ? 5 : 0)
        + boundedLevel(clan.blacksmith, 50) * 0.2
        + (character.clanDoctrine === 'merchant' ? 5 : 0);
}

export function discountedShopCost(cost: number, percent: number): number {
    return Math.max(1, Math.floor(cost * Math.max(0, 1 - percent / 100)));
}

function storedItems(character: Record<string, unknown>): StoredItems | null {
    const rawStacks = character.itemStacks ?? [];
    if (!Array.isArray(character.inventory) || !Array.isArray(rawStacks)) return null;
    if (!character.inventory.every((entry) => typeof entry === 'string' && entry.length > 0)) return null;
    const stacks = new Map<string, number>();
    for (const raw of rawStacks) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const entry = raw as Record<string, unknown>;
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : '';
        const count = whole(entry.count);
        if (!itemId || count === null || count <= 0 || count > MAX_STACK) return null;
        const next = (stacks.get(itemId) ?? 0) + count;
        if (next > MAX_STACK) return null;
        stacks.set(itemId, next);
    }
    return { inventory: [...character.inventory as string[]], stacks };
}

function itemCount(items: StoredItems, itemId: string): number {
    return (items.stacks.get(itemId) ?? 0) + items.inventory.filter((id) => id === itemId).length;
}

function holdCap(item: SettlementItem): number | null {
    const slot = item.slot === 'weapon' ? 'hand' : item.slot === 'armor' ? 'body' : item.slot === 'accessory' ? 'aura' : item.slot;
    if (slot === 'potion') return 2;
    if (slot === 'thrown') return 50;
    if (slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null)) return 50;
    return null;
}

function itemCurrency(item: SettlementItem): ShopCurrency | null {
    if (RYO_RARITIES.has(item.rarity)) return 'ryo';
    if (FATE_RARITIES.has(item.rarity)) return 'fateShards';
    return null;
}

export function isPurchasableItem(item: SettlementItem): boolean {
    if (!SHOP_SLOTS.has(item.slot) || item.cost <= 0) return false;
    const craftOnlyWeapon = item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
    const normalizedSlot = item.slot === 'armor' ? 'body' : item.slot;
    const craftOnlyArmor = ['body', 'head', 'waist', 'legs', 'feet'].includes(normalizedSlot)
        && item.armorQuality != null && item.rarity === 'rare';
    return !craftOnlyWeapon && !craftOnlyArmor && itemCurrency(item) !== null;
}

function replayValue(receipt: ServerSettlementReceipt): ShopSettlementValue | null {
    const value = receipt.value;
    if (value.kind === 'item-purchase'
        && typeof value.itemId === 'string'
        && whole(value.quantity) !== null
        && (value.currency === 'ryo' || value.currency === 'fateShards')
        && whole(value.totalCost) !== null) return value as ShopSettlementValue;
    if (value.kind === 'card-pack'
        && (value.packId === 'standard' || value.packId === 'epic' || value.packId === 'legendary')
        && Array.isArray(value.drawn) && value.drawn.every((id) => typeof id === 'string')
        && (value.currency === 'ryo' || value.currency === 'fateShards' || value.currency === 'chroniclePoints')
        && whole(value.totalCost) !== null) return value as ShopSettlementValue;
    return null;
}

function inspect(
    character: Record<string, unknown>,
    requestId: string,
    fingerprint: string,
): { fresh: true; receipts: ServerSettlementReceipt[] } | { fresh: false; result: ShopSettlementResult } {
    const receipt = inspectSettlementReceipt(character, requestId, fingerprint);
    if (receipt.status === 'invalid') return { fresh: false, result: { ok: false, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' } };
    if (receipt.status === 'conflict') return { fresh: false, result: { ok: false, status: 409, error: 'That settlement request ID was already used for another action.' } };
    if (receipt.status === 'replay') {
        const value = replayValue(receipt.receipt);
        if (!value) return { fresh: false, result: { ok: false, status: 409, error: 'Stored settlement receipt is invalid. Contact support.' } };
        return { fresh: false, result: { ok: true, character, value, replayed: true } };
    }
    return { fresh: true, receipts: receipt.receipts };
}

function withReceipt(
    character: Record<string, unknown>,
    receipts: ServerSettlementReceipt[],
    requestId: string,
    fingerprint: string,
    value: ShopSettlementValue,
    now: number,
): ShopSettlementResult {
    return {
        ok: true,
        replayed: false,
        value,
        character: appendSettlementReceipt(character, receipts, { requestId, fingerprint, value, settledAt: now }),
    };
}

export function applyItemPurchase(
    character: Record<string, unknown>,
    item: SettlementItem,
    quantityRaw: number,
    requestId: string,
    now: number,
): ShopSettlementResult {
    const requested = whole(quantityRaw);
    if (requested === null || requested < 1 || requested > 50) return { ok: false, status: 400, error: 'Quantity must be a whole number from 1 to 50.' };
    const fingerprint = `shop:item:${item.id}:${requested}`;
    const prior = inspect(character, requestId, fingerprint);
    if (!prior.fresh) return prior.result;
    if (!isPurchasableItem(item)) return { ok: false, status: 400, error: 'That item is not sold by this shop.' };

    const level = whole(character.level);
    if (level === null) return { ok: false, status: 409, error: 'Stored level is invalid. Contact support.' };
    if (item.levelReq && level < item.levelReq) return { ok: false, status: 400, error: `Requires Level ${item.levelReq}.` };
    const items = storedItems(character);
    if (!items) return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };

    // Gear level ladder (shared/item-level-gate.ts). `levelReq` used to be read
    // only by the crafting path, so the shop would happily sell mythic armour to
    // a level-1 character. The gate belongs at every acquisition point, not one.
    if (!meetsItemLevelReq(item, character.level)) {
        return {
            ok: false,
            status: 400,
            error: `${item.name} requires level ${effectiveItemLevelReq(item)}.`,
        };
    }

    const cap = holdCap(item);
    const quantity = cap === null ? 1 : Math.min(requested, Math.max(0, cap - itemCount(items, item.id)));
    if (quantity <= 0) return { ok: false, status: 400, error: `You can only carry ${cap} ${item.name}.` };
    if (cap === null && itemCount(items, item.id) > 0) return { ok: false, status: 400, error: 'You already own that item.' };

    const currency = itemCurrency(item)!;
    const balance = whole(character[currency]);
    if (balance === null) return { ok: false, status: 409, error: `Stored ${currency} balance is invalid. Contact support.` };
    const unitCost = discountedShopCost(item.cost, shopDiscountPercent(character, currency));
    const totalCost = unitCost * quantity;
    if (!Number.isSafeInteger(totalCost) || balance < totalCost) return { ok: false, status: 400, error: `Not enough ${currency === 'ryo' ? 'ryo' : 'Fate Shards'}.` };

    if (item.stackable) {
        const next = (items.stacks.get(item.id) ?? 0) + quantity;
        if (next > MAX_STACK) return { ok: false, status: 409, error: 'That item stack is full.' };
        items.stacks.set(item.id, next);
    } else {
        if (items.inventory.length + quantity > MAX_INVENTORY) return { ok: false, status: 409, error: 'Your inventory is full.' };
        for (let i = 0; i < quantity; i += 1) items.inventory.push(item.id);
    }
    const value: ShopSettlementValue = { kind: 'item-purchase', itemId: item.id, quantity, currency, totalCost };
    return withReceipt({
        ...character,
        [currency]: balance - totalCost,
        inventory: items.inventory,
        itemStacks: [...items.stacks.entries()].map(([itemId, count]) => ({ itemId, count })),
    }, prior.receipts, requestId, fingerprint, value, now);
}

export function applyCardPackPurchase(
    character: Record<string, unknown>,
    cards: Map<string, SettlementCard>,
    packId: ShopPackId,
    requestId: string,
    now: number,
    pickIndex: (length: number) => number,
): ShopSettlementResult {
    const pack = PACKS[packId];
    const fingerprint = `shop:pack:${packId}`;
    const prior = inspect(character, requestId, fingerprint);
    if (!prior.fresh) return prior.result;
    // Rarity band AND storefront half, mirroring api/card-clash/_pack.ts: the
    // marketplace packs draw the best-50% pool, the Basic pack the rest.
    // (Admin-authored custom cards are never in the marketplace set, so they
    // stay reachable through the Basic pack only.)
    const pool = [...cards.values()].filter((card) =>
        pack.rarities.includes(card.rarity) && isMarketplaceCard(card.id) === (pack.pool === 'marketplace'));
    if (!pool.length) return { ok: false, status: 409, error: 'That card pack has no eligible cards. Contact support.' };
    if (!Array.isArray(character.tileCards ?? []) || !(character.tileCards as unknown[]).every((id) => typeof id === 'string')) {
        return { ok: false, status: 409, error: 'Stored card collection is invalid. Contact support.' };
    }
    const owned = [...(character.tileCards as string[] | undefined ?? [])];
    if (!canAppendPackableChronicleCards(owned, pack.count)) return { ok: false, status: 409, error: 'Your card collection is full.' };
    const balance = whole(character[pack.currency]);
    if (balance === null) return { ok: false, status: 409, error: 'Stored currency balance is invalid. Contact support.' };
    const totalCost = discountedShopCost(pack.cost, shopDiscountPercent(character, pack.currency));
    const packCurrencyLabel = pack.currency === 'chroniclePoints'
        ? 'Chronicle Points — win Showdowns in Echoes of War to earn more'
        : pack.currency === 'ryo' ? 'ryo' : 'Fate Shards';
    if (balance < totalCost) return { ok: false, status: 400, error: `Not enough ${packCurrencyLabel}.` };

    const drawn: string[] = [];
    for (let i = 0; i < pack.count; i += 1) {
        const index = pickIndex(pool.length);
        if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length) return { ok: false, status: 409, error: 'Card draw failed safely. Please retry.' };
        drawn.push(pool[index]!.id);
    }
    const value: ShopSettlementValue = { kind: 'card-pack', packId, drawn, currency: pack.currency, totalCost };
    return withReceipt({ ...character, [pack.currency]: balance - totalCost, tileCards: [...owned, ...drawn] }, prior.receipts, requestId, fingerprint, value, now);
}
