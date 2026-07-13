"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sellCatalogItem = sellCatalogItem;
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const _forge_js_1 = require("../craft/_forge.js");
const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));
function sellCatalogItem(character, itemIdRaw, qtyRaw, equipmentSlotRaw) {
    const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : '';
    const item = _item_catalog_js_1.ITEM_CATALOG[itemId];
    if (!item || whole(item.cost) <= 0)
        return { ok: false, reason: 'item-not-sellable' };
    const slot = String(item.slot ?? '');
    if (!item.armorQuality && !['head', 'body', 'waist', 'legs', 'feet', 'hand', 'gloves', 'thrown', 'item', 'potion'].includes(slot))
        return { ok: false, reason: 'item-not-sellable' };
    const equipmentSlot = typeof equipmentSlotRaw === 'string' ? equipmentSlotRaw : '';
    let next = character;
    let qty = Math.max(1, Math.min(50, whole(qtyRaw) || 1));
    if (equipmentSlot) {
        const equipment = character.equipment && typeof character.equipment === 'object' ? character.equipment : {};
        if (String(equipment[equipmentSlot] ?? '') !== itemId)
            return { ok: false, reason: 'item-not-equipped' };
        const nextEquipment = { ...equipment, [equipmentSlot]: undefined };
        if (equipmentSlot === 'hand')
            nextEquipment.weapon = undefined;
        if (equipmentSlot === 'body')
            nextEquipment.armor = undefined;
        if (equipmentSlot === 'aura')
            nextEquipment.accessory = undefined;
        next = { ...character, equipment: nextEquipment };
        qty = 1;
    }
    else {
        qty = Math.min(qty, (0, _forge_js_1.countOwned)(character, itemId));
        if (qty <= 0)
            return { ok: false, reason: 'item-not-owned' };
        next = (0, _forge_js_1.removeOwned)(character, itemId, qty);
    }
    const unitValue = Math.floor(whole(item.cost) / 2);
    return { ok: true, character: { ...next, ryo: whole(next.ryo) + unitValue * qty }, sale: { itemId, qty, unitValue, totalValue: unitValue * qty } };
}
