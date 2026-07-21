import {
    appendSettlementReceipt,
    inspectSettlementReceipt,
    type ServerSettlementReceipt,
} from '../_settlement-receipts.js';
import type { SettlementItem } from '../shop/_catalog.js';

export type InventorySaleSource = 'backpack' | 'equipped';
export type InventorySaleValue = { kind: 'inventory-sale'; itemId: string; quantity: number; ryo: number; source: InventorySaleSource };
export type InventorySaleResult =
    | { ok: true; character: Record<string, unknown>; value: InventorySaleValue; replayed: boolean }
    | { ok: false; status: 400 | 409; error: string };

const MAX_STACK = 9999;
const EQUIPMENT_KEYS = new Set(['aura', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head', 'item', 'item1', 'item2', 'item3', 'thrown', 'potion', 'weapon', 'armor', 'accessory']);
const SELLABLE_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'hand', 'gloves', 'thrown', 'item', 'aura']);

// Hunt drop materials are cost:0 (deliberately un-buyable) but should still be
// worth something so they aren't dead clutter. A rarity-tiered ryo value, keyed by
// id, gives every drop a purpose and finally makes rarity read as rarity. Roughly
// tracks each material's forge craft-point worth (~×10). Keep in sync with the
// client mirror in shinobij.client/src/screens/Inventory.tsx (huntMaterialSellRyo).
export const HUNT_MATERIAL_SELL_RYO: Record<string, number> = {
    'hunt-torn-hide': 12, 'hunt-wild-feather': 12, 'hunt-small-fang': 12, 'hunt-cracked-horn': 12,
    'hunt-beast-meat': 15, 'hunt-frost-pelt': 40, 'hunt-shadow-claw': 40, 'hunt-wolf-fang': 55,
    'hunt-ash-scale': 80, 'hunt-ember-scale': 180, 'hunt-shadow-pelt': 220,
    'hunt-ancient-beast-core': 450, 'hunt-titan-bone': 450, 'hunt-legendary-material': 600,
};

function whole(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function normalizeSlot(slot: string): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    return slot;
}

/** Ryo a single unit of this item sells for. Hunt materials use the rarity-tiered
 *  table (they're cost:0); everything else is the standard half-cost. */
function unitSaleValue(item: SettlementItem): number {
    if (item.cost <= 0 && item.id in HUNT_MATERIAL_SELL_RYO) return HUNT_MATERIAL_SELL_RYO[item.id];
    return Math.floor(item.cost / 2);
}

export function isSellableItem(item: SettlementItem): boolean {
    if (item.id in HUNT_MATERIAL_SELL_RYO) return true;
    return item.cost > 0 && (item.armorQuality != null || SELLABLE_SLOTS.has(normalizeSlot(item.slot)));
}

function replayValue(receipt: ServerSettlementReceipt): InventorySaleValue | null {
    const value = receipt.value;
    if (value.kind !== 'inventory-sale' || typeof value.itemId !== 'string') return null;
    if (whole(value.quantity) === null || whole(value.ryo) === null) return null;
    if (value.source !== 'backpack' && value.source !== 'equipped') return null;
    return value as InventorySaleValue;
}

export function applyInventorySale(
    character: Record<string, unknown>,
    item: SettlementItem,
    source: InventorySaleSource,
    quantityRaw: number,
    equipmentSlotRaw: string | undefined,
    requestId: string,
    now: number,
): InventorySaleResult {
    const requested = whole(quantityRaw);
    if (requested === null || requested < 1 || requested > MAX_STACK) return { ok: false, status: 400, error: 'Sale quantity is invalid.' };
    const slot = equipmentSlotRaw == null ? '' : String(equipmentSlotRaw);
    const fingerprint = `inventory:sale:${item.id}:${source}:${requested}:${slot}`;
    const prior = inspectSettlementReceipt(character, requestId, fingerprint);
    if (prior.status === 'invalid') return { ok: false, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' };
    if (prior.status === 'conflict') return { ok: false, status: 409, error: 'That settlement request ID was already used for another action.' };
    if (prior.status === 'replay') {
        const value = replayValue(prior.receipt);
        if (!value) return { ok: false, status: 409, error: 'Stored settlement receipt is invalid. Contact support.' };
        return { ok: true, character, value, replayed: true };
    }
    if (!isSellableItem(item)) return { ok: false, status: 400, error: 'This item cannot be sold.' };

    const ryo = whole(character.ryo);
    if (ryo === null) return { ok: false, status: 409, error: 'Stored ryo balance is invalid. Contact support.' };
    const quantity = source === 'equipped' ? 1 : requested;
    const unitValue = unitSaleValue(item);
    const saleRyo = unitValue * quantity;
    if (unitValue <= 0 || !Number.isSafeInteger(saleRyo) || !Number.isSafeInteger(ryo + saleRyo)) {
        return { ok: false, status: 409, error: 'Sale value is invalid.' };
    }

    let next: Record<string, unknown>;
    if (source === 'equipped') {
        if (!EQUIPMENT_KEYS.has(slot) || !character.equipment || typeof character.equipment !== 'object' || Array.isArray(character.equipment)) {
            return { ok: false, status: 400, error: 'Equipped item slot is invalid.' };
        }
        const equipment = { ...character.equipment as Record<string, unknown> };
        if (equipment[slot] !== item.id) return { ok: false, status: 400, error: 'That item is not equipped in the selected slot.' };
        const normalized = normalizeSlot(slot);
        const aliases = normalized === 'hand' ? ['hand', 'weapon'] : normalized === 'body' ? ['body', 'armor'] : normalized === 'aura' ? ['aura', 'accessory'] : [normalized];
        for (const key of aliases) if (equipment[key] === item.id) delete equipment[key];
        next = { ...character, equipment, ryo: ryo + saleRyo };
    } else {
        const rawStacks = character.itemStacks ?? [];
        if (!Array.isArray(character.inventory) || !Array.isArray(rawStacks)) {
            return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
        }
        const inventory = [...character.inventory as unknown[]];
        if (!inventory.every((entry) => typeof entry === 'string')) return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
        const stacks = new Map<string, number>();
        for (const raw of rawStacks) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
            const entry = raw as Record<string, unknown>;
            const id = typeof entry.itemId === 'string' ? entry.itemId : '';
            const count = whole(entry.count);
            if (!id || count === null || count <= 0 || count > MAX_STACK) return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
            stacks.set(id, (stacks.get(id) ?? 0) + count);
        }
        const totalOwned = (stacks.get(item.id) ?? 0) + inventory.filter((id) => id === item.id).length;
        if (totalOwned < quantity) return { ok: false, status: 400, error: 'You do not own enough of that item.' };
        let remaining = quantity;
        const stackCount = stacks.get(item.id) ?? 0;
        const fromStack = Math.min(stackCount, remaining);
        if (fromStack > 0) {
            if (stackCount === fromStack) stacks.delete(item.id);
            else stacks.set(item.id, stackCount - fromStack);
            remaining -= fromStack;
        }
        const kept: string[] = [];
        for (const id of inventory as string[]) {
            if (id === item.id && remaining > 0) { remaining -= 1; continue; }
            kept.push(id);
        }
        next = {
            ...character,
            inventory: kept,
            itemStacks: [...stacks.entries()].map(([itemId, count]) => ({ itemId, count })),
            ryo: ryo + saleRyo,
        };
    }

    const value: InventorySaleValue = { kind: 'inventory-sale', itemId: item.id, quantity, ryo: saleRyo, source };
    return {
        ok: true,
        value,
        replayed: false,
        character: appendSettlementReceipt(next, prior.receipts, { requestId, fingerprint, value, settledAt: now }),
    };
}
