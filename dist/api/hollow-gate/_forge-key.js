"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEY_FORGE_COSTS = void 0;
exports.forgeHollowGateKey = forgeHollowGateKey;
exports.KEY_FORGE_COSTS = { hollowShards: 80, dungeonKeys: 5, fateShards: 10 };
function countItem(character, itemId) {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const inline = inventory.filter((id) => id === itemId).length;
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    return inline + stacks.filter((s) => s?.itemId === itemId).reduce((n, s) => n + Math.max(0, Math.floor(Number(s.count) || 0)), 0);
}
function consumeItem(character, itemId, amount) {
    let remaining = amount;
    const stacks = (Array.isArray(character.itemStacks) ? character.itemStacks : []).flatMap((s) => {
        if (s?.itemId !== itemId || remaining <= 0)
            return [s];
        const count = Math.max(0, Math.floor(Number(s.count) || 0));
        const used = Math.min(count, remaining);
        remaining -= used;
        return count > used ? [{ ...s, count: count - used }] : [];
    });
    const inventory = [];
    for (const raw of Array.isArray(character.inventory) ? character.inventory : []) {
        if (raw === itemId && remaining > 0) {
            remaining -= 1;
            continue;
        }
        if (typeof raw === 'string')
            inventory.push(raw);
    }
    return { ...character, inventory, itemStacks: stacks };
}
function forgeHollowGateKey(character, source) {
    if (!(source in exports.KEY_FORGE_COSTS))
        return { ok: false, reason: 'invalid-source' };
    let next = { ...character };
    if (source === 'hollowShards') {
        const att = character.hollowGateAttunement;
        if (Math.floor(Number(att?.['key-forge']) || 0) < 1)
            return { ok: false, reason: 'forge-locked' };
        if (Number(character.hollowShards) < exports.KEY_FORGE_COSTS.hollowShards)
            return { ok: false, reason: 'insufficient-materials' };
        next.hollowShards = Number(character.hollowShards) - exports.KEY_FORGE_COSTS.hollowShards;
    }
    else if (source === 'fateShards') {
        if (Number(character.fateShards) < exports.KEY_FORGE_COSTS.fateShards)
            return { ok: false, reason: 'insufficient-materials' };
        next.fateShards = Number(character.fateShards) - exports.KEY_FORGE_COSTS.fateShards;
    }
    else {
        if (countItem(character, 'dungeon-key') < exports.KEY_FORGE_COSTS.dungeonKeys)
            return { ok: false, reason: 'insufficient-materials' };
        next = consumeItem(next, 'dungeon-key', exports.KEY_FORGE_COSTS.dungeonKeys);
    }
    const inventory = Array.isArray(next.inventory) ? next.inventory : [];
    return { ok: true, character: { ...next, inventory: [...inventory, 'hollow-gate-key'] } };
}
