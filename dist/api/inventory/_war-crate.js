"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAR_CRATE_KEY_CHANCE = exports.WAR_CRATE_HONOR = exports.WAR_CRATE_RYO = exports.DUNGEON_KEY_ID = exports.WARFORGED_RELIC_ID = exports.LEGENDARY_WAR_CRATE_ID = void 0;
exports.applyWarCrateOpen = applyWarCrateOpen;
exports.LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';
exports.WARFORGED_RELIC_ID = 'warforged-relic';
exports.DUNGEON_KEY_ID = 'dungeon-key';
exports.WAR_CRATE_RYO = 500;
exports.WAR_CRATE_HONOR = 10;
exports.WAR_CRATE_KEY_CHANCE = 0.35;
const MAX_ITEM_STACK = 9999;
function whole(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function storedItems(character) {
    if (!Array.isArray(character.inventory) || !Array.isArray(character.itemStacks ?? []))
        return null;
    if (!character.inventory.every((entry) => typeof entry === 'string' && entry.length > 0))
        return null;
    const stacks = new Map();
    for (const raw of character.itemStacks) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return null;
        const entry = raw;
        if (typeof entry.itemId !== 'string' || !entry.itemId)
            return null;
        const count = whole(entry.count);
        if (count === null || count === 0 || count > MAX_ITEM_STACK)
            return null;
        const next = (stacks.get(entry.itemId) ?? 0) + count;
        if (next > MAX_ITEM_STACK)
            return null;
        stacks.set(entry.itemId, next);
    }
    return { inventory: [...character.inventory], stacks };
}
function addStack(stacks, itemId, count) {
    const next = (stacks.get(itemId) ?? 0) + count;
    if (!Number.isSafeInteger(next) || next > MAX_ITEM_STACK)
        return false;
    stacks.set(itemId, next);
    return true;
}
/** Consume exactly one stored crate and apply its sealed server-side payout. */
function applyWarCrateOpen(character, randomValue) {
    const items = storedItems(character);
    if (!items)
        return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
    const stackedCrates = items.stacks.get(exports.LEGENDARY_WAR_CRATE_ID) ?? 0;
    const inventoryIndex = items.inventory.indexOf(exports.LEGENDARY_WAR_CRATE_ID);
    if (stackedCrates <= 0 && inventoryIndex < 0)
        return { ok: false, status: 400, error: 'You do not own a Legendary War Crate.' };
    if (stackedCrates > 1)
        items.stacks.set(exports.LEGENDARY_WAR_CRATE_ID, stackedCrates - 1);
    else if (stackedCrates === 1)
        items.stacks.delete(exports.LEGENDARY_WAR_CRATE_ID);
    else
        items.inventory.splice(inventoryIndex, 1);
    const ryo = whole(character.ryo);
    const honorSeals = whole(character.honorSeals ?? 0);
    const boneCharms = whole(character.boneCharms ?? 0);
    if (ryo === null || honorSeals === null || boneCharms === null) {
        return { ok: false, status: 409, error: 'Stored reward balances are invalid. Contact support.' };
    }
    const honorGain = character.profession === 'vanguard' ? exports.WAR_CRATE_HONOR : 0;
    const charmGain = Math.max(1, Math.floor(exports.WAR_CRATE_HONOR / 8));
    const gotKey = Number.isFinite(randomValue) && randomValue >= 0 && randomValue < exports.WAR_CRATE_KEY_CHANCE;
    if (!Number.isSafeInteger(ryo + exports.WAR_CRATE_RYO)
        || !Number.isSafeInteger(honorSeals + honorGain)
        || !Number.isSafeInteger(boneCharms + charmGain)
        || !addStack(items.stacks, exports.WARFORGED_RELIC_ID, 1)
        || (gotKey && !addStack(items.stacks, exports.DUNGEON_KEY_ID, 1))) {
        return { ok: false, status: 409, error: 'A reward balance is too large to update safely.' };
    }
    return {
        ok: true,
        rewards: { ryo: exports.WAR_CRATE_RYO, honorSeals: honorGain, boneCharms: charmGain, relic: true, dungeonKey: gotKey },
        character: {
            ...character,
            inventory: items.inventory,
            itemStacks: [...items.stacks.entries()].map(([itemId, count]) => ({ itemId, count })),
            ryo: ryo + exports.WAR_CRATE_RYO,
            honorSeals: honorSeals + honorGain,
            boneCharms: boneCharms + charmGain,
        },
    };
}
