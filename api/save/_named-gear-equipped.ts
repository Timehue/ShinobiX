import { REFERENCE_EQUIPMENT_SLOTS, resolvedEquipmentEntries } from '../_equipment-ownership.js';
import { isNamedGearId } from '../../shared/named-gear-rules.js';

export const EQUIPPED_NAMED_GEAR_FIELD = 'equippedNamedGear';

function ids(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && isNamedGearId(id)).map((id) => id.toLowerCase()) : [];
}

/**
 * Remember every named weapon or armor piece that has been equipped even once.
 *
 * A generic save cannot clear or edit this list: it is rebuilt here from the
 * STORED list plus whatever the (already ownership-checked) equipment holds now.
 * A piece that has left the player's hands is dropped from the list so it cannot
 * grow without bound. A worn piece cannot move to another player through the
 * Exchange (the list is what blocks that), so a dropped id never comes back.
 *
 * Known limit: only the state at each save is seen, so equipping and unequipping
 * between two autosaves is not recorded. That window costs the player nothing
 * they could not do by simply not listing the piece, so it is accepted.
 */
export function recordEquippedNamedGear(char: Record<string, unknown>, stored: Record<string, unknown>): void {
    const wornNow: string[] = [];
    for (const [slot, id] of resolvedEquipmentEntries(char.equipment)) {
        if (REFERENCE_EQUIPMENT_SLOTS.has(slot) || !isNamedGearId(id)) continue;
        wornNow.push(id.toLowerCase());
    }
    const owned = new Set<string>(wornNow);
    for (const id of Array.isArray(char.inventory) ? char.inventory : []) if (typeof id === 'string') owned.add(id.toLowerCase());
    for (const stack of Array.isArray(char.itemStacks) ? char.itemStacks as Array<Record<string, unknown>> : []) {
        if (stack && typeof stack.itemId === 'string') owned.add(stack.itemId.toLowerCase());
    }
    const before = ids(stored[EQUIPPED_NAMED_GEAR_FIELD]);
    const next = [...new Set([...before, ...wornNow])].filter((id) => owned.has(id));
    // An empty list is written, not deleted, when the last recorded piece has left:
    // the save merge keeps a stored value for a field that is merely absent.
    if (next.length > 0 || before.length > 0) char[EQUIPPED_NAMED_GEAR_FIELD] = next;
    else delete char[EQUIPPED_NAMED_GEAR_FIELD];
}

/** True when this named piece has been equipped before, according to the stored save. */
export function wasEverEquipped(character: Record<string, unknown>, itemId: string): boolean {
    return isNamedGearId(itemId) && ids(character[EQUIPPED_NAMED_GEAR_FIELD]).includes(itemId.toLowerCase());
}
