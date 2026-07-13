"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseCatalogItem = purchaseCatalogItem;
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
function whole(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
function itemCount(character, id) {
    const inline = Array.isArray(character.inventory) ? character.inventory.filter((x) => x === id).length : 0;
    const stacked = Array.isArray(character.itemStacks)
        ? character.itemStacks.filter((s) => s?.itemId === id).reduce((n, s) => n + whole(s.count), 0) : 0;
    return inline + stacked;
}
function purchaseDiscount(character, premium) {
    if (premium)
        return character.elderFocus === 'trade' ? 5 : 0;
    const upgrades = character.villageUpgrades;
    const clanUpgrades = character.clanUpgradeLevels;
    return whole(upgrades?.shop) * 0.25
        + (character.elderFocus === 'trade' ? 5 : 0)
        + Math.min(10, whole(clanUpgrades?.blacksmith) * 0.2)
        + (character.clanDoctrine === 'merchant' ? 5 : 0);
}
function purchaseCatalogItem(character, itemId, qtyRaw) {
    const id = typeof itemId === 'string' ? itemId : '';
    const item = _item_catalog_js_1.ITEM_CATALOG[id];
    const baseCost = whole(item?.cost);
    if (!item || baseCost <= 0)
        return { ok: false, reason: 'item-not-for-sale' };
    if (whole(character.level) < whole(item.levelReq ?? 1))
        return { ok: false, reason: 'level-required' };
    const premium = item.rarity === 'legendary' || item.rarity === 'mythic';
    const currency = premium ? 'fateShards' : 'ryo';
    const combatConsumable = item.slot === 'thrown' || item.slot === 'potion'
        || (item.slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null));
    const cap = item.slot === 'potion' ? 2 : combatConsumable ? 50 : null;
    let qty = cap == null ? 1 : Math.max(1, Math.min(50, whole(qtyRaw) || 1));
    if (cap != null)
        qty = Math.min(qty, Math.max(0, cap - itemCount(character, id)));
    else if (itemCount(character, id) > 0)
        return { ok: false, reason: 'already-owned' };
    if (qty <= 0)
        return { ok: false, reason: 'hold-cap' };
    const percent = purchaseDiscount(character, premium);
    const unitCost = Math.max(1, Math.floor(baseCost * Math.max(0, 1 - percent / 100)));
    const totalCost = unitCost * qty;
    const balance = whole(character[currency]);
    if (balance < totalCost)
        return { ok: false, reason: 'insufficient-funds' };
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    return {
        ok: true,
        character: { ...character, [currency]: balance - totalCost, inventory: [...inventory, ...Array.from({ length: qty }, () => id)] },
        item: { id, qty, currency, unitCost, totalCost },
    };
}
