"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRAFT_POINTS = void 0;
exports.countOwned = countOwned;
exports.removeOwned = removeOwned;
exports.addOwned = addOwned;
exports.craftPointTotal = craftPointTotal;
exports.consumeCraftPoints = consumeCraftPoints;
exports.applyForge = applyForge;
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
exports.CRAFT_POINTS = {
    'hunt-torn-hide': 3, 'hunt-wild-feather': 3, 'hunt-small-fang': 3, 'hunt-cracked-horn': 3,
    'hunt-beast-meat': 5, 'hunt-frost-pelt': 8, 'hunt-shadow-claw': 8, 'hunt-wolf-fang': 10,
    'hunt-ash-scale': 15, 'hunt-ember-scale': 20, 'hunt-shadow-pelt': 25,
    'hunt-ancient-beast-core': 30, 'hunt-titan-bone': 30, 'hunt-legendary-material': 50,
    'weekly-boss-core': 150, 'dungeon-legendary-relic': 200, 'warforged-relic': 250, 'veil-of-the-hollow': 250,
};
const SUPPLY_RECIPES = {
    'pet-treat': { points: 50 }, 'elemental-pet-treat': { points: 100 },
    'currency:aura-dust': { points: 50, currency: 'auraDust', amount: 50 },
    'currency:bone-charm': { points: 1000, currency: 'boneCharms', amount: 1 },
    'thrown-shuriken': { points: 15, count: 3 }, 'thrown-senbon': { points: 30 },
    'thrown-serpent-dust': { points: 40 }, 'item-smoke-bomb': { points: 25 },
    'item-attack-pill': { points: 20 }, 'item-defense-pill': { points: 20 },
    'potion-rejuvenation': { points: 250 },
    'pve-hunters-bond-harness': { points: 280 }, 'pve-loyal-companion-bell': { points: 280 },
    'pve-frenzy-claw': { points: 350 }, 'pve-guardians-blessing': { points: 350 },
    'pve-sanguine-charm': { points: 350 }, 'pve-predators-fang': { points: 420 },
    'pve-avengers-pendant': { points: 420 }, 'pve-bloodbond-totem': { points: 420 },
    'pve-pack-alpha-crest': { points: 490 }, 'pve-apex-predator-fang': { points: 490 },
    'consum-phantom-charm': { points: 170 }, 'consum-smoke-pellet': { points: 170 },
    'consum-cleansing-incense': { points: 200 }, 'consum-thornmail-oil': { points: 220 },
    'consum-lifeline-elixir': { points: 250 }, 'consum-second-wind': { points: 280 },
};
const STACKABLE_OUTPUTS = new Set([...Object.keys(SUPPLY_RECIPES), 'dungeon-legendary-relic']);
const count = (v) => Math.max(0, Math.floor(Number(v) || 0));
function countOwned(character, itemId) {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    return inventory.filter((id) => id === itemId).length
        + stacks.filter((s) => String(s?.itemId ?? '') === itemId).reduce((sum, s) => sum + count(s.count), 0);
}
function removeOwned(character, itemId, amountRaw) {
    let remaining = count(amountRaw);
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    const nextStacks = stacks.map((stack) => {
        if (remaining <= 0 || String(stack?.itemId ?? '') !== itemId)
            return stack;
        const take = Math.min(count(stack.count), remaining);
        remaining -= take;
        return { ...stack, count: count(stack.count) - take };
    }).filter((stack) => count(stack.count) > 0);
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const nextInventory = inventory.filter((id) => {
        if (id === itemId && remaining > 0) {
            remaining -= 1;
            return false;
        }
        return true;
    });
    return { ...character, inventory: nextInventory, itemStacks: nextStacks };
}
function addOwned(character, itemId, amountRaw, stackable = STACKABLE_OUTPUTS.has(itemId)) {
    const amount = count(amountRaw);
    if (!amount)
        return character;
    if (!stackable) {
        const inventory = Array.isArray(character.inventory) ? character.inventory : [];
        return { ...character, inventory: [...inventory, ...Array.from({ length: amount }, () => itemId)] };
    }
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    const found = stacks.some((s) => String(s?.itemId ?? '') === itemId);
    return {
        ...character,
        itemStacks: found
            ? stacks.map((s) => String(s?.itemId ?? '') === itemId ? { ...s, count: count(s.count) + amount } : s)
            : [...stacks, { itemId, count: amount }],
    };
}
function craftPointTotal(character) {
    return Object.entries(exports.CRAFT_POINTS).reduce((sum, [id, points]) => sum + countOwned(character, id) * points, 0);
}
function consumeCraftPoints(character, pointsRaw) {
    const required = count(pointsRaw);
    if (craftPointTotal(character) < required)
        return null;
    let next = character;
    let remaining = required;
    for (const [id, points] of Object.entries(exports.CRAFT_POINTS).sort((a, b) => a[1] - b[1])) {
        while (remaining > 0 && countOwned(next, id) > 0) {
            next = removeOwned(next, id, 1);
            remaining -= points;
        }
    }
    return next;
}
function ryoFor(item) { return item.rarity === 'rare' ? 600 : item.rarity === 'epic' ? 1400 : 3500; }
function itemPoints(item, armor) {
    if (item.rarity === 'rare')
        return armor ? 200 : 150;
    if (item.rarity === 'epic')
        return armor ? 400 : 350;
    return armor ? 800 : 700;
}
function applyForge(character, kind, recipeId, quantityRaw) {
    const quantity = Math.max(1, Math.min(20, count(quantityRaw) || 1));
    if (kind === 'relic') {
        if (recipeId !== 'dungeon-legendary-relic' || countOwned(character, 'dungeon-legendary-fragment') < 5)
            return null;
        return addOwned(removeOwned(character, 'dungeon-legendary-fragment', 5), recipeId, 1, true);
    }
    if (kind === 'supply') {
        const recipe = SUPPLY_RECIPES[recipeId];
        if (!recipe)
            return null;
        const paid = consumeCraftPoints(character, recipe.points * quantity);
        if (!paid)
            return null;
        if (recipe.currency)
            return { ...paid, [recipe.currency]: count(paid[recipe.currency]) + (recipe.amount ?? 0) * quantity };
        return addOwned(paid, recipeId, (recipe.count ?? 1) * quantity, true);
    }
    const item = _item_catalog_js_1.ITEM_CATALOG[recipeId];
    if (!item || recipeId.startsWith('named-'))
        return null;
    const armor = kind === 'armor';
    const valid = armor
        ? ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.rarity === 'rare' && Boolean(item.armorQuality)
        : item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
    if (!valid || count(character.level) < count(item.levelReq ?? 1))
        return null;
    const ryo = ryoFor(item);
    if (count(character.ryo) < ryo)
        return null;
    const paid = consumeCraftPoints(character, itemPoints(item, armor));
    if (!paid)
        return null;
    return addOwned({ ...paid, ryo: count(paid.ryo) - ryo }, recipeId, 1, false);
}
