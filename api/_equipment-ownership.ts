/** Selection slots refer to units still held in the backpack, not extra items. */
export const REFERENCE_EQUIPMENT_SLOTS = new Set(['item', 'item1', 'item2', 'item3', 'thrown', 'potion']);

export const EQUIPMENT_SLOTS = new Set([
    'aura', 'relic', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head',
    ...REFERENCE_EQUIPMENT_SLOTS,
    'weapon', 'armor', 'accessory',
]);

export function canonicalEquipmentSlot(slot: string): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    if (slot === 'item') return 'item1';
    return slot;
}

/** Resolve aliases like the client: a populated canonical slot wins, regardless of key order. */
export function resolvedEquipmentEntries(raw: unknown): Array<[string, string]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const equipment = raw as Record<string, unknown>;
    const entries: Array<[string, string]> = [];
    for (const [slot, value] of Object.entries(equipment)) {
        if (!EQUIPMENT_SLOTS.has(slot) || typeof value !== 'string' || !value.trim()) continue;
        const canonicalSlot = canonicalEquipmentSlot(slot);
        const canonicalValue = equipment[canonicalSlot];
        if (slot !== canonicalSlot && typeof canonicalValue === 'string' && canonicalValue.trim()) continue;
        entries.push([slot, value.trim()]);
    }
    return entries;
}

/** Count ordinary equipped units once per physical slot, including legacy aliases. */
export function countEquippedItems(raw: unknown): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [slot, id] of resolvedEquipmentEntries(raw)) {
        if (REFERENCE_EQUIPMENT_SLOTS.has(slot)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}
