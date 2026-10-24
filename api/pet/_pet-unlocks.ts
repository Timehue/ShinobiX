import { isPetUnlockItem, PET_UNLOCK_SLOTS } from '../_pet-sim/pet-config.js';

/*
 * Collars and PvP pet gear are unlocks (shinobij.client/src/data/pet-config.ts):
 * one backpack copy equips on every pet, and equipping leaves the copy in the
 * backpack. So the last copy must not leave the backpack while a pet still wears
 * it. Before this guard it could be sold, listed on the Exchange or donated, and
 * every pet kept the effect of an item the player no longer owned (2026-10
 * item-use pass). Each outflow checks this after it has removed the units.
 */

export const PET_UNLOCK_WORN_ERROR = 'A companion is wearing this. Unequip it in the Pet Yard before it leaves your backpack.';

type Obj = Record<string, unknown>;
const objects = (value: unknown): Obj[] => Array.isArray(value)
    ? value.filter((entry): entry is Obj => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];

function heldCount(character: Obj, itemId: string): number {
    const inline = Array.isArray(character.inventory) ? character.inventory.filter((id) => id === itemId).length : 0;
    const stacked = objects(character.itemStacks)
        .filter((stack) => stack.itemId === itemId)
        .reduce((sum, stack) => sum + Math.max(0, Math.floor(Number(stack.count) || 0)), 0);
    return inline + stacked;
}

/** Whether any carried pet wears `itemId` in a collar or PvP slot. */
export function petWearsUnlock(character: Obj, itemId: string): boolean {
    return objects(character.pets).some((pet) => {
        const loadout = pet.loadout && typeof pet.loadout === 'object' ? pet.loadout as Obj : {};
        return PET_UNLOCK_SLOTS.some((slot) => loadout[slot] === itemId);
    });
}

/**
 * True when `after` (the character once an outflow removed its units) holds no
 * copy of a pet unlock that one of its pets still wears. The outflow refuses then.
 */
export function petUnlockLeftWithoutCopy(after: Obj, itemId: string): boolean {
    return isPetUnlockItem(itemId) && heldCount(after, itemId) <= 0 && petWearsUnlock(after, itemId);
}

/**
 * Drop collar and PvP slot entries the backpack no longer backs. For a pet coming
 * back from the Sanctuary, which is outside the roster the outflows check.
 */
export function withoutUnbackedPetUnlocks(pet: Obj, character: Obj): Obj {
    const loadout = pet.loadout && typeof pet.loadout === 'object' ? { ...(pet.loadout as Obj) } : null;
    if (!loadout) return pet;
    let changed = false;
    for (const slot of PET_UNLOCK_SLOTS) {
        const id = loadout[slot];
        if (typeof id === 'string' && isPetUnlockItem(id) && heldCount(character, id) <= 0) {
            delete loadout[slot];
            changed = true;
        }
    }
    return changed ? { ...pet, loadout } : pet;
}
