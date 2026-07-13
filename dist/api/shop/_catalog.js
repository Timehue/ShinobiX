"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettlementCatalogs = buildSettlementCatalogs;
exports.loadSettlementCatalogs = loadSettlementCatalogs;
const _storage_js_1 = require("../_storage.js");
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const ADMIN_DELETED_ITEM_MARKER = '__ADMIN_DELETED_ITEM__';
const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'];
const ITEM_SLOTS = new Set(['aura', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head', 'item', 'item1', 'item2', 'item3', 'thrown', 'potion', 'weapon', 'armor', 'accessory']);
const ITEM_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
const CARD_RARITIES = new Set(['common', 'rare', 'epic', 'legendary']);
function cleanItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const item = raw;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const slot = typeof item.slot === 'string' ? item.slot : '';
    const rarity = typeof item.rarity === 'string' ? item.rarity : '';
    const cost = Number(item.cost);
    if (!id || id.length > 120 || !name || !ITEM_SLOTS.has(slot) || !ITEM_RARITIES.has(rarity))
        return null;
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 100_000_000)
        return null;
    const levelReq = item.levelReq == null ? undefined : Number(item.levelReq);
    if (levelReq !== undefined && (!Number.isSafeInteger(levelReq) || levelReq < 1 || levelReq > 100))
        return null;
    return { ...item, id, name, slot, rarity, cost, ...(levelReq === undefined ? {} : { levelReq }) };
}
function cleanCard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const card = raw;
    const id = typeof card.id === 'string' ? card.id.trim() : '';
    const rarity = typeof card.rarity === 'string' ? card.rarity : '';
    if (!id || id.length > 120 || !CARD_RARITIES.has(rarity))
        return null;
    return { id, rarity: rarity };
}
/** Reproduce the client merge: built-in item definitions win, admin deletions hide them, Admin 2 wins custom-id collisions. */
function buildSettlementCatalogs(adminRecords) {
    const deleted = new Set();
    const customItems = new Map();
    const customCards = new Map();
    const builtinIds = new Set(Object.keys(_item_catalog_js_1.ITEM_CATALOG));
    for (const record of adminRecords) {
        for (const raw of Array.isArray(record?.creatorItems) ? record.creatorItems : []) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                continue;
            const value = raw;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id)
                continue;
            if (value.name === ADMIN_DELETED_ITEM_MARKER) {
                deleted.add(id);
                customItems.delete(id);
                continue;
            }
            if (builtinIds.has(id))
                continue;
            const item = cleanItem(value);
            if (item && !deleted.has(id))
                customItems.set(id, item);
        }
        for (const raw of Array.isArray(record?.creatorCards) ? record.creatorCards : []) {
            const card = cleanCard(raw);
            if (card)
                customCards.set(card.id, card);
        }
    }
    const items = new Map();
    for (const [id, raw] of Object.entries(_item_catalog_js_1.ITEM_CATALOG)) {
        if (!deleted.has(id))
            items.set(id, raw);
    }
    for (const [id, item] of customItems)
        items.set(id, item);
    const cards = new Map();
    for (const [id, raw] of Object.entries(_card_catalog_js_1.BUILTIN_CLASH)) {
        cards.set(id, { id, rarity: raw.rarity });
    }
    for (const [id, card] of customCards)
        cards.set(id, card);
    return { items, cards };
}
async function loadSettlementCatalogs() {
    const records = await Promise.all(ADMIN_SAVE_KEYS.map((key) => _storage_js_1.kv.get(key)));
    return buildSettlementCatalogs(records.filter((record) => !!record));
}
