"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_ANCIENT_CHEST_LIMIT = void 0;
exports.rollAncientChestLoot = rollAncientChestLoot;
exports.applyAncientChestLoot = applyAncientChestLoot;
const _xp_engine_js_1 = require("../_xp-engine.js");
exports.DAILY_ANCIENT_CHEST_LIMIT = 23;
const TREATS = ['pet-treat', 'elemental-pet-treat', 'ancient-pet-treat'];
const COMMON_CARDS = [...Array.from({ length: 20 }, (_, i) => i + 1), ...Array.from({ length: 20 }, (_, i) => i + 51)]
    .map((n) => `tc-${String(n).padStart(2, '0')}`);
const RARE_CARDS = [...Array.from({ length: 20 }, (_, i) => i + 21), ...Array.from({ length: 20 }, (_, i) => i + 71)]
    .map((n) => `tc-${String(n).padStart(2, '0')}`);
function rollAncientChestLoot(sectorRaw, random) {
    const sector = Math.floor(Number(sectorRaw));
    if (!Number.isFinite(sector) || sector < 1 || sector > 60)
        return null;
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const loot = { xp: 50 + sector * 2 };
    if (unit() < 0.5)
        loot.ryo = 100 + Math.floor(unit() * 401);
    const roll = unit();
    if (roll < 0.2)
        loot.itemId = TREATS[Math.floor(unit() * TREATS.length)];
    else if (roll < 0.55)
        loot.itemId = 'shinobi-vest';
    else if (roll < 0.65)
        loot.itemId = 'chakra-ring';
    else if (roll < 0.83)
        loot.cardId = COMMON_CARDS[Math.floor(unit() * COMMON_CARDS.length)];
    else if (roll < 0.92)
        loot.cardId = RARE_CARDS[Math.floor(unit() * RARE_CARDS.length)];
    else if (roll < 0.97)
        loot.fateShards = 1;
    else if (roll < 0.99)
        loot.boneCharms = 1;
    else
        loot.auraStones = 1;
    if (unit() < 0.2)
        loot.auraDust = 5 + Math.floor(unit() * 11);
    return loot;
}
function applyAncientChestLoot(character, loot) {
    const leveled = (0, _xp_engine_js_1.gainXp)(character, loot.xp);
    const inventory = Array.isArray(leveled.inventory) ? leveled.inventory : [];
    const tileCards = Array.isArray(leveled.tileCards) ? leveled.tileCards : [];
    const stackable = loot.itemId === 'pet-treat' || loot.itemId === 'elemental-pet-treat' || loot.itemId === 'ancient-pet-treat';
    return {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + (loot.ryo ?? 0),
        fateShards: Math.max(0, Number(leveled.fateShards) || 0) + (loot.fateShards ?? 0),
        boneCharms: Math.max(0, Number(leveled.boneCharms) || 0) + (loot.boneCharms ?? 0),
        auraStones: Math.max(0, Number(leveled.auraStones) || 0) + (loot.auraStones ?? 0),
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + (loot.auraDust ?? 0),
        inventory: loot.itemId && (stackable || !inventory.includes(loot.itemId)) ? [...inventory, loot.itemId] : inventory,
        tileCards: loot.cardId && !tileCards.includes(loot.cardId) ? [...tileCards, loot.cardId] : tileCards,
    };
}
