"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSellableItem = isSellableItem;
exports.applyInventorySale = applyInventorySale;
const _settlement_receipts_js_1 = require("../_settlement-receipts.js");
const MAX_STACK = 9999;
const EQUIPMENT_KEYS = new Set(['aura', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head', 'item', 'item1', 'item2', 'item3', 'thrown', 'potion', 'weapon', 'armor', 'accessory']);
const SELLABLE_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'hand', 'gloves', 'thrown', 'item', 'aura']);
function whole(raw) {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}
function normalizeSlot(slot) {
    if (slot === 'weapon')
        return 'hand';
    if (slot === 'armor')
        return 'body';
    if (slot === 'accessory')
        return 'aura';
    return slot;
}
function isSellableItem(item) {
    return item.cost > 0 && (item.armorQuality != null || SELLABLE_SLOTS.has(normalizeSlot(item.slot)));
}
function replayValue(receipt) {
    const value = receipt.value;
    if (value.kind !== 'inventory-sale' || typeof value.itemId !== 'string')
        return null;
    if (whole(value.quantity) === null || whole(value.ryo) === null)
        return null;
    if (value.source !== 'backpack' && value.source !== 'equipped')
        return null;
    return value;
}
function applyInventorySale(character, item, source, quantityRaw, equipmentSlotRaw, requestId, now) {
    const requested = whole(quantityRaw);
    if (requested === null || requested < 1 || requested > MAX_STACK)
        return { ok: false, status: 400, error: 'Sale quantity is invalid.' };
    const slot = equipmentSlotRaw == null ? '' : String(equipmentSlotRaw);
    const fingerprint = `inventory:sale:${item.id}:${source}:${requested}:${slot}`;
    const prior = (0, _settlement_receipts_js_1.inspectSettlementReceipt)(character, requestId, fingerprint);
    if (prior.status === 'invalid')
        return { ok: false, status: 409, error: 'Stored settlement receipts are invalid. Contact support.' };
    if (prior.status === 'conflict')
        return { ok: false, status: 409, error: 'That settlement request ID was already used for another action.' };
    if (prior.status === 'replay') {
        const value = replayValue(prior.receipt);
        if (!value)
            return { ok: false, status: 409, error: 'Stored settlement receipt is invalid. Contact support.' };
        return { ok: true, character, value, replayed: true };
    }
    if (!isSellableItem(item))
        return { ok: false, status: 400, error: 'This item cannot be sold.' };
    const ryo = whole(character.ryo);
    if (ryo === null)
        return { ok: false, status: 409, error: 'Stored ryo balance is invalid. Contact support.' };
    const quantity = source === 'equipped' ? 1 : requested;
    const unitValue = Math.floor(item.cost / 2);
    const saleRyo = unitValue * quantity;
    if (unitValue <= 0 || !Number.isSafeInteger(saleRyo) || !Number.isSafeInteger(ryo + saleRyo)) {
        return { ok: false, status: 409, error: 'Sale value is invalid.' };
    }
    let next;
    if (source === 'equipped') {
        if (!EQUIPMENT_KEYS.has(slot) || !character.equipment || typeof character.equipment !== 'object' || Array.isArray(character.equipment)) {
            return { ok: false, status: 400, error: 'Equipped item slot is invalid.' };
        }
        const equipment = { ...character.equipment };
        if (equipment[slot] !== item.id)
            return { ok: false, status: 400, error: 'That item is not equipped in the selected slot.' };
        const normalized = normalizeSlot(slot);
        const aliases = normalized === 'hand' ? ['hand', 'weapon'] : normalized === 'body' ? ['body', 'armor'] : normalized === 'aura' ? ['aura', 'accessory'] : [normalized];
        for (const key of aliases)
            if (equipment[key] === item.id)
                delete equipment[key];
        next = { ...character, equipment, ryo: ryo + saleRyo };
    }
    else {
        const rawStacks = character.itemStacks ?? [];
        if (!Array.isArray(character.inventory) || !Array.isArray(rawStacks)) {
            return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
        }
        const inventory = [...character.inventory];
        if (!inventory.every((entry) => typeof entry === 'string'))
            return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
        const stacks = new Map();
        for (const raw of rawStacks) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
            const entry = raw;
            const id = typeof entry.itemId === 'string' ? entry.itemId : '';
            const count = whole(entry.count);
            if (!id || count === null || count <= 0 || count > MAX_STACK)
                return { ok: false, status: 409, error: 'Stored inventory is invalid. Contact support.' };
            stacks.set(id, (stacks.get(id) ?? 0) + count);
        }
        const totalOwned = (stacks.get(item.id) ?? 0) + inventory.filter((id) => id === item.id).length;
        if (totalOwned < quantity)
            return { ok: false, status: 400, error: 'You do not own enough of that item.' };
        let remaining = quantity;
        const stackCount = stacks.get(item.id) ?? 0;
        const fromStack = Math.min(stackCount, remaining);
        if (fromStack > 0) {
            if (stackCount === fromStack)
                stacks.delete(item.id);
            else
                stacks.set(item.id, stackCount - fromStack);
            remaining -= fromStack;
        }
        const kept = [];
        for (const id of inventory) {
            if (id === item.id && remaining > 0) {
                remaining -= 1;
                continue;
            }
            kept.push(id);
        }
        next = {
            ...character,
            inventory: kept,
            itemStacks: [...stacks.entries()].map(([itemId, count]) => ({ itemId, count })),
            ryo: ryo + saleRyo,
        };
    }
    const value = { kind: 'inventory-sale', itemId: item.id, quantity, ryo: saleRyo, source };
    return {
        ok: true,
        value,
        replayed: false,
        character: (0, _settlement_receipts_js_1.appendSettlementReceipt)(next, prior.receipts, { requestId, fingerprint, value, settledAt: now }),
    };
}
