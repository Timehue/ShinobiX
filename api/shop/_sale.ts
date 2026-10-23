import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { removeOwned, countOwned } from '../craft/_forge.js';
import { canonicalEquipmentSlot, resolvedEquipmentEntries, REFERENCE_EQUIPMENT_SLOTS } from '../_equipment-ownership.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { standardSaleUnitValue } from '../../shared/crafting-recipes.js';
import { unitSaleValue } from '../inventory/_sale.js';
import { petUnlockLeftWithoutCopy } from '../pet/_pet-unlocks.js';
import type { SettlementItem } from './_catalog.js';

const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
export function sellCatalogItem(character: Record<string, unknown>, itemIdRaw: unknown, qtyRaw: unknown, equipmentSlotRaw?: unknown) {
    const itemId = typeof itemIdRaw === 'string' ? itemIdRaw : ''; const item = ITEM_CATALOG[itemId];
    // Gear step drops cost 0 and sell for one flat price (shared/gear-steps.ts).
    const stepDrop = !!item && isStepItemId(itemId);
    if (!item || (whole(item.cost) <= 0 && !stepDrop)) return { ok: false as const, reason: 'item-not-sellable' as const };
    // A crafted good capped to 0 (gathered-only inputs) is refused, never sold for nothing.
    if (!stepDrop && standardSaleUnitValue(itemId, whole(item.cost)) <= 0) return { ok: false as const, reason: 'item-not-sellable' as const };
    const slot = String(item.slot ?? '');
    // The same slots /inventory/sell buys (api/inventory/_sale.ts SELLABLE_SLOTS):
    // never the potion slot.
    if (!item.armorQuality && !['head', 'body', 'waist', 'legs', 'feet', 'hand', 'gloves', 'thrown', 'item'].includes(slot)) return { ok: false as const, reason: 'item-not-sellable' as const };
    const equipmentSlot = typeof equipmentSlotRaw === 'string' ? equipmentSlotRaw : '';
    let next = character; let qty = Math.max(1, Math.min(50, whole(qtyRaw) || 1));
    if (equipmentSlot) {
        if (REFERENCE_EQUIPMENT_SLOTS.has(equipmentSlot)) return { ok: false as const, reason: 'sell-consumable-from-backpack' as const };
        const equipment = character.equipment && typeof character.equipment === 'object' ? character.equipment as Record<string, unknown> : {};
        const canonicalSlot = canonicalEquipmentSlot(equipmentSlot);
        const equipped = resolvedEquipmentEntries(equipment).find(([key]) => canonicalEquipmentSlot(key) === canonicalSlot);
        if (equipped?.[1] !== itemId) return { ok: false as const, reason: 'item-not-equipped' as const };
        const nextEquipment = { ...equipment };
        for (const slot of Object.keys(nextEquipment)) {
            if (canonicalEquipmentSlot(slot) === canonicalSlot) delete nextEquipment[slot];
        }
        next = { ...character, equipment: nextEquipment }; qty = 1;
    } else {
        qty = Math.min(qty, countOwned(character, itemId));
        if (qty <= 0) return { ok: false as const, reason: 'item-not-owned' as const };
        next = removeOwned(character, itemId, qty);
        // A collar or PvP pet gear copy is an unlock every pet shares: the last
        // one stays while a pet wears it (2026-10 item-use pass).
        if (petUnlockLeftWithoutCopy(next, itemId)) return { ok: false as const, reason: 'pet-unlock-worn' as const };
    }
    // The same unit price /inventory/sell credits (gear steps, named gear, hunt
    // materials, crafted-goods caps), so no re-price can be bypassed through this door.
    const unitValue = unitSaleValue({ ...item, cost: whole(item.cost) } as SettlementItem);
    return { ok: true as const, character: { ...next, ryo: whole(next.ryo) + unitValue * qty }, sale: { itemId, qty, unitValue, totalValue: unitValue * qty } };
}
