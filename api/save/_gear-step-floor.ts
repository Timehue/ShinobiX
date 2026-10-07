import { countEquippedItems } from '../_equipment-ownership.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';

function stepUnits(character: Record<string, unknown>): Map<string, number> {
    const units = new Map<string, number>();
    const add = (id: unknown, count: number) => {
        // Only real catalog pieces: an admin or custom item whose id merely ends in -s1 to -s5 stays removable.
        if (typeof id !== 'string' || !isStepItemId(id) || !ITEM_CATALOG[id] || count <= 0) return;
        units.set(id, (units.get(id) ?? 0) + count);
    };
    if (Array.isArray(character.inventory)) for (const id of character.inventory) add(id, 1);
    if (Array.isArray(character.itemStacks)) {
        for (const raw of character.itemStacks as Array<Record<string, unknown>>) {
            if (raw && typeof raw === 'object') add(raw.itemId, Math.max(0, Math.floor(Number(raw.count) || 0)));
        }
    }
    for (const [id, count] of countEquippedItems(character.equipment)) add(id, count);
    return units;
}

/**
 * A generic autosave can never remove an upgrade gear piece the server stored.
 *
 * Step pieces are granted by server endpoints (drops, chest, cache, purchase)
 * that write the stored save and answer with a version bump. A client that sees
 * only the bumped version, not the character, ratchets its version forward and
 * its next autosave then carries an inventory without the piece. The save
 * ownership boundary above only stops a save from ADDING items, so that save
 * would otherwise be accepted and erase the reward.
 *
 * Step pieces leave a save only through endpoints that write the stored record
 * first (sale, trade, marketplace escrow), and the admin editor, which opts out.
 * So a stored unit missing from the incoming save is a stale client, never an
 * intended removal. The deficit is returned to the backpack. This only ever
 * restores up to what is stored, so it cannot mint a piece.
 */
export function preserveGearStepItems(
    char: Record<string, unknown>,
    stored: Record<string, unknown>,
): void {
    const storedUnits = stepUnits(stored);
    if (storedUnits.size === 0) return;
    const keptUnits = stepUnits(char);
    const restored: string[] = [];
    for (const [id, count] of storedUnits) {
        for (let i = keptUnits.get(id) ?? 0; i < count; i++) restored.push(id);
    }
    if (restored.length === 0) return;
    const inventory = Array.isArray(char.inventory) ? [...(char.inventory as unknown[])] : [];
    char.inventory = [...inventory, ...restored];
}
