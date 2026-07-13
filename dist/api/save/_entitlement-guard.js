"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preserveOwnedItems = preserveOwnedItems;
exports.isServerOwnedItemId = isServerOwnedItemId;
exports.isHighRiskTileCardId = isHighRiskTileCardId;
exports.preserveEntitledStringArray = preserveEntitledStringArray;
exports.preserveEntitledStacks = preserveEntitledStacks;
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const SERVER_OWNED_ITEM_IDS = new Set([
    'weekly-boss-core',
    'dungeon-key',
    'dungeon-legendary-relic',
    'dungeon-legendary-fragment',
    'veil-of-the-hollow',
    'warforged-relic',
    'legendary-war-crate',
    'hunt-legendary-material',
    'hunt-ancient-beast-core',
    'hunt-titan-bone',
]);
function countStrings(raw) {
    const counts = new Map();
    if (!Array.isArray(raw))
        return counts;
    for (const value of raw) {
        const id = typeof value === 'string' ? value : '';
        if (!id)
            continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}
function stackCounts(raw) {
    const counts = new Map();
    if (!Array.isArray(raw))
        return counts;
    for (const value of raw) {
        if (!value || typeof value !== 'object')
            continue;
        const entry = value;
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : '';
        const count = Math.max(0, Math.floor(Number(entry.count ?? 0)));
        if (!itemId || count <= 0)
            continue;
        counts.set(itemId, (counts.get(itemId) ?? 0) + count);
    }
    return counts;
}
function preserveOwnedItems(incomingInventory, incomingStacks, existingInventory, existingStacks) {
    const allowed = countStrings(existingInventory);
    for (const [id, count] of stackCounts(existingStacks))
        allowed.set(id, (allowed.get(id) ?? 0) + count);
    const used = new Map();
    const inventory = [];
    if (Array.isArray(incomingInventory)) {
        for (const raw of incomingInventory) {
            const id = typeof raw === 'string' ? raw : '';
            if (!id || (used.get(id) ?? 0) >= (allowed.get(id) ?? 0))
                continue;
            used.set(id, (used.get(id) ?? 0) + 1);
            inventory.push(id);
        }
    }
    const itemStacks = [];
    for (const [itemId, requested] of stackCounts(incomingStacks)) {
        const remaining = Math.max(0, (allowed.get(itemId) ?? 0) - (used.get(itemId) ?? 0));
        const count = Math.min(requested, remaining);
        if (count > 0)
            itemStacks.push({ itemId, count });
    }
    return { inventory, itemStacks };
}
function isServerOwnedItemId(itemId) {
    return SERVER_OWNED_ITEM_IDS.has(itemId);
}
function isHighRiskTileCardId(cardId) {
    const rarity = _card_catalog_js_1.BUILTIN_CLASH[cardId]?.rarity;
    return rarity === 'epic' || rarity === 'legendary';
}
function preserveEntitledStringArray(incoming, existing, isGuardedId) {
    if (!Array.isArray(incoming))
        return null;
    const existingCounts = countStrings(existing);
    const keptGuarded = new Map();
    const out = [];
    for (const raw of incoming) {
        const id = typeof raw === 'string' ? raw : '';
        if (!id)
            continue;
        if (!isGuardedId(id)) {
            out.push(id);
            continue;
        }
        const used = keptGuarded.get(id) ?? 0;
        const allowed = existingCounts.get(id) ?? 0;
        if (used >= allowed)
            continue;
        keptGuarded.set(id, used + 1);
        out.push(id);
    }
    return out;
}
function preserveEntitledStacks(incoming, existing, isGuardedId) {
    if (!Array.isArray(incoming))
        return null;
    const incomingCounts = stackCounts(incoming);
    const existingCounts = stackCounts(existing);
    const out = [];
    for (const [itemId, count] of incomingCounts.entries()) {
        const guarded = isGuardedId(itemId);
        const allowed = guarded ? Math.min(count, existingCounts.get(itemId) ?? 0) : count;
        if (allowed > 0)
            out.push({ itemId, count: allowed });
    }
    return out;
}
