"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_PACK_TYPES = void 0;
exports.parseCardPackType = parseCardPackType;
exports.cardPackDiscountPercent = cardPackDiscountPercent;
exports.cardPackCost = cardPackCost;
exports.applyCardPackOpen = applyCardPackOpen;
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
exports.CARD_PACK_TYPES = ['standard', 'epic', 'legendary'];
const PACKS = {
    standard: { currency: 'ryo', baseCost: 250, count: 5, rarities: ['common', 'rare'] },
    epic: { currency: 'fateShards', baseCost: 10, count: 1, rarities: ['epic'] },
    legendary: { currency: 'fateShards', baseCost: 30, count: 1, rarities: ['legendary'] },
};
const CARD_COLLECTION_CAP = 1_200;
function parseCardPackType(value) {
    return typeof value === 'string' && exports.CARD_PACK_TYPES.includes(value)
        ? value
        : null;
}
function cardPackDiscountPercent(character, type) {
    // Grand Marketplace packs use only the trade-focus discount in the client.
    if (type !== 'standard')
        return character.elderFocus === 'trade' ? 5 : 0;
    const village = character.villageUpgrades && typeof character.villageUpgrades === 'object'
        ? character.villageUpgrades
        : {};
    const clan = character.clanUpgradeLevels && typeof character.clanUpgradeLevels === 'object'
        ? character.clanUpgradeLevels
        : {};
    const shopLevel = Math.max(0, Math.min(50, Math.floor(Number(village.shop) || 0)));
    const blacksmithLevel = Math.max(0, Math.floor(Number(clan.blacksmith) || 0));
    const blacksmith = Math.min(10, blacksmithLevel * 0.2);
    const elder = character.elderFocus === 'trade' ? 5 : 0;
    const doctrine = character.clanDoctrine === 'merchant' ? 5 : 0;
    return shopLevel * 0.25 + blacksmith + elder + doctrine;
}
function cardPackCost(character, type) {
    const def = PACKS[type];
    return Math.max(1, Math.floor(def.baseCost * Math.max(0, 1 - cardPackDiscountPercent(character, type) / 100)));
}
function applyCardPackOpen(character, typeRaw, pickIndex) {
    const type = parseCardPackType(typeRaw);
    if (!type)
        return { ok: false, status: 400, error: 'Invalid card pack.' };
    const def = PACKS[type];
    const owned = Array.isArray(character.tileCards)
        ? character.tileCards.filter((id) => typeof id === 'string' && !!id)
        : [];
    if (owned.length + def.count > CARD_COLLECTION_CAP) {
        return { ok: false, status: 409, error: `Card collection is capped at ${CARD_COLLECTION_CAP}.` };
    }
    const balance = Math.max(0, Math.floor(Number(character[def.currency]) || 0));
    const cost = cardPackCost(character, type);
    if (balance < cost)
        return { ok: false, status: 409, error: `Not enough ${def.currency}.` };
    const pool = Object.entries(_card_catalog_js_1.BUILTIN_CLASH)
        .filter(([, card]) => def.rarities.includes(card.rarity))
        .map(([id]) => id);
    if (pool.length === 0)
        return { ok: false, status: 503, error: 'Card pack pool is unavailable.' };
    const cards = [];
    for (let i = 0; i < def.count; i++) {
        const rawIndex = Math.floor(Number(pickIndex(pool.length)) || 0);
        cards.push(pool[Math.max(0, Math.min(pool.length - 1, rawIndex))]);
    }
    const nextBalance = balance - cost;
    return {
        ok: true,
        character: { ...character, [def.currency]: nextBalance, tileCards: [...owned, ...cards] },
        cards,
        currency: def.currency,
        cost,
        balance: nextBalance,
    };
}
