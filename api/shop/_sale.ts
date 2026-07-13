import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { removeOwned, countOwned } from '../craft/_forge.js';

const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
export function sellCatalogItem(character: Record<string, unknown>, itemIdRaw: unknown, qtyRaw: unknown, equipmentSlotRaw?: unknown) {
    const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : ''; const item = ITEM_CATALOG[itemId];
    if (!item || whole(item.cost) <= 0) return { ok: false as const, reason: 'item-not-sellable' as const };
    const slot = String(item.slot ?? '');
    if (!item.armorQuality && !['head', 'body', 'waist', 'legs', 'feet', 'hand', 'gloves', 'thrown', 'item', 'potion'].includes(slot)) return { ok: false as const, reason: 'item-not-sellable' as const };
    const equipmentSlot = typeof equipmentSlotRaw === 'string' ? equipmentSlotRaw : '';
    let next = character; let qty = Math.max(1, Math.min(50, whole(qtyRaw) || 1));
    if (equipmentSlot) {
        const equipment = character.equipment && typeof character.equipment === 'object' ? character.equipment as Record<string, unknown> : {};
        if (String(equipment[equipmentSlot] ?? '') !== itemId) return { ok: false as const, reason: 'item-not-equipped' as const };
        const nextEquipment = { ...equipment, [equipmentSlot]: undefined };
        if (equipmentSlot === 'hand') nextEquipment.weapon = undefined;
        if (equipmentSlot === 'body') nextEquipment.armor = undefined;
        if (equipmentSlot === 'aura') nextEquipment.accessory = undefined;
        next = { ...character, equipment: nextEquipment }; qty = 1;
    } else {
        qty = Math.min(qty, countOwned(character, itemId));
        if (qty <= 0) return { ok: false as const, reason: 'item-not-owned' as const };
        next = removeOwned(character, itemId, qty);
    }
    const unitValue = Math.floor(whole(item.cost) / 2);
    return { ok: true as const, character: { ...next, ryo: whole(next.ryo) + unitValue * qty }, sale: { itemId, qty, unitValue, totalValue: unitValue * qty } };
}
