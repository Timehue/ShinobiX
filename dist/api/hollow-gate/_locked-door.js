"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxLockedDoorsForDepth = maxLockedDoorsForDepth;
exports.rollHollowLockedDoor = rollHollowLockedDoor;
const _catalog_js_1 = require("../pet/_catalog.js");
function maxLockedDoorsForDepth(depthRaw) {
    return Math.max(1, Math.min(60, Math.floor(Number(depthRaw) || 1) * 3));
}
function rollHollowLockedDoor(random, now = Date.now(), floorRaw = 1) {
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const roll = unit();
    if (roll < 0.5) {
        const floor = Math.max(1, Math.min(20, Math.floor(Number(floorRaw) || 1)));
        const loot = { xp: 100 + floor * 10, hollowShards: 5 + floor * 2 };
        if (unit() < 0.5)
            loot.ryo = 100 + Math.floor(unit() * 401);
        const lootRoll = unit();
        if (lootRoll < 0.82)
            loot.fateShards = 1;
        else if (lootRoll < 0.95)
            loot.boneCharms = 1;
        else
            loot.auraStones = 1;
        if (unit() < 0.2)
            loot.auraDust = 5 + Math.floor(unit() * 11);
        return { outcome: 'chest', loot };
    }
    if (roll < 0.75)
        return { outcome: 'trap' };
    const rarity = roll < 0.99 ? 'rare' : roll < 0.998 ? 'legendary' : 'mythic';
    const pool = Object.values(_catalog_js_1.PET_CATALOG).filter((pet) => pet.rarity === rarity);
    const template = pool[Math.floor(unit() * pool.length)];
    if (!template)
        return { outcome: 'trap' };
    return {
        outcome: 'pet',
        rarity,
        pet: { ...structuredClone(template), id: `${template.id}-hg-${now}` },
    };
}
