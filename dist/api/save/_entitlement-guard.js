"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isServerOwnedItemId = isServerOwnedItemId;
exports.isHighRiskTileCardId = isHighRiskTileCardId;
exports.capStringArrayItemGain = capStringArrayItemGain;
exports.preserveEntitledStringArray = preserveEntitledStringArray;
exports.preserveEntitledStacks = preserveEntitledStacks;
const _card_catalog_js_1 = require("../clan/war/_card-catalog.js");
const _anbu_infiltration_js_1 = require("../_anbu-infiltration.js");
const SERVER_OWNED_ITEM_IDS = new Set([
    'weekly-boss-core',
    'dungeon-key',
    'dungeon-legendary-fragment',
    'hollow-gate-key',
    'veil-of-the-hollow',
    'warforged-relic',
    'legendary-war-crate',
    'hunt-legendary-material',
    'hunt-ancient-beast-core',
    'hunt-titan-bone',
    // Anbu Vault Infiltration war caches — minted ONLY by the raid settle
    // (api/_anbu-infiltration-store.ts), redeemed only by its turn-in. A client
    // save can spend them, never mint them.
    _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply,
    _anbu_infiltration_js_1.CACHE_ITEM_IDS.warResources,
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
function isServerOwnedItemId(itemId) {
    return SERVER_OWNED_ITEM_IDS.has(itemId);
}
function isHighRiskTileCardId(cardId) {
    const rarity = _card_catalog_js_1.BUILTIN_CLASH[cardId]?.rarity;
    return rarity === 'epic' || rarity === 'legendary';
}
function capStringArrayItemGain(incoming, existing, itemId, maxGain) {
    if (!Array.isArray(incoming))
        return null;
    const allowed = (countStrings(existing).get(itemId) ?? 0) + Math.max(0, Math.floor(maxGain));
    let kept = 0;
    const out = [];
    for (const raw of incoming) {
        if (typeof raw !== 'string' || !raw)
            continue;
        if (raw !== itemId) {
            out.push(raw);
            continue;
        }
        if (kept >= allowed)
            continue;
        kept += 1;
        out.push(raw);
    }
    return out;
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
