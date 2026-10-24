import { INVENTORY_CAP as BASE_INVENTORY_CAP } from '../_inventory-capacity.js';
import { preserveOwnedItems } from './_entitlement-guard.js';
import { countEquippedItems } from '../_equipment-ownership.js';
import { ITEM_STACK_KEY_CAP, ITEM_STACK_MAX, foldStackedMaterials } from '../../shared/stacked-materials.js';

/**
 * Fold `inventory[]` copies of hunt materials and the Weekly Boss Core into
 * `itemStacks` (owner ruling A12, 2026-10 rebalance). Runs on the FINAL
 * character of every save write, after the ledger boundary has settled what the
 * player owns, so it only ever moves units between the two stores: per id,
 * inventory copies plus stack count are unchanged, and a second pass is a no-op.
 * A unit that does not fit (full stack, no free stack key) stays where it was.
 */
export function foldStackedMaterialsOnSave(char: Record<string, unknown>): void {
    const folded = foldStackedMaterials(char);
    if (folded === char) return;
    char.inventory = folded.inventory;
    char.itemStacks = folded.itemStacks;
}

export function sanitizeInventory(char: Record<string, unknown>, exChar: Record<string, unknown>) {

    // Inventory + tile-card collection size caps. A tampered client could
    // submit thousands of items, both bloating KV and inflating foreign-read
    // payloads. 500 is well above any realistic veteran's working inventory
    // and matches what the client UI can scroll through cleanly.
    //
    // NON-DESTRUCTIVE, exactly like PET_CAP: the ceiling never falls below what
    // the server already stores, so persistence can only stop the inventory
    // GROWING past the cap — it can never delete items a player already holds.
    // Before this, a player at the cap who claimed a war crate, forged a weapon
    // or finished an event simply lost the reward here, silently. Acquisition
    // now refuses up front (api/_inventory-capacity.ts) so the player is told
    // while they still hold whatever would have produced the item; the save
    // layer must never be the thing that eats one.
    const existingInventoryCount = Array.isArray(exChar.inventory) ? (exChar.inventory as unknown[]).length : 0;
    const equippedCount = [...countEquippedItems(exChar.equipment).values()].reduce((sum, count) => sum + count, 0);
    const INVENTORY_CAP = Math.max(BASE_INVENTORY_CAP, existingInventoryCount + equippedCount);
    if (Array.isArray(char.inventory) && (char.inventory as unknown[]).length > INVENTORY_CAP) {
        char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP);
    }
    // Counted stacks for bulk consumables (client lib/inventory.ts moves
    // stackable ids out of inventory[] into here, which is what keeps the cap
    // above from overflowing for hoarders). Validate structurally so a tampered
    // client can't bloat the save: dedupe by id, floor + clamp each count, drop
    // non-positive entries, and cap the number of distinct stack keys
    // (ITEM_STACK_MAX / ITEM_STACK_KEY_CAP, shared/stacked-materials.ts).
    if (Array.isArray(char.itemStacks)) {
        const counts = new Map<string, number>();
        for (const s of char.itemStacks as unknown[]) {
            if (!s || typeof s !== 'object') continue;
            const itemId = String((s as Record<string, unknown>).itemId ?? '');
            if (!itemId) continue;
            const n = Math.max(0, Math.floor(Number((s as Record<string, unknown>).count ?? 0)));
            if (n <= 0) continue;
            counts.set(itemId, Math.min(ITEM_STACK_MAX, (counts.get(itemId) ?? 0) + n));
        }
        // Hollow Gate Keys are forged/crafted client-side (Key Forge 80 shards, or
        // the Crafter recipe). Cap the per-save GAIN so a forged save can't mint a
        // huge stack with no shard/material spend (a legit full run yields ~3). The
        // 'hollow-gate-key' literal mirrors HOLLOW_GATE_KEY_ID in
        // shinobij.client/src/constants/game.ts.
        const HG_KEY_ID = 'hollow-gate-key';
        const HG_KEY_PER_SAVE_GAIN = 10;
        if (counts.has(HG_KEY_ID)) {
            const exKeys = Array.isArray(exChar.itemStacks)
                ? Math.max(0, Number((exChar.itemStacks as Array<Record<string, unknown>>)
                    .find(s => s?.itemId === HG_KEY_ID)?.count ?? 0))
                : 0;
            counts.set(HG_KEY_ID, Math.min(counts.get(HG_KEY_ID)!, exKeys + HG_KEY_PER_SAVE_GAIN));
        }
        char.itemStacks = [...counts.entries()]
            .slice(0, ITEM_STACK_KEY_CAP)
            .map(([itemId, count]) => ({ itemId, count }));
    }
    // Include units being returned by unequip/swap. The final equipment boundary
    // reserves any units kept equipped, so a backpack copy cannot duplicate them.
    const ownedItems = preserveOwnedItems(char.inventory, char.itemStacks, exChar.inventory, exChar.itemStacks, exChar.equipment);
    char.inventory = ownedItems.inventory;
    char.itemStacks = ownedItems.itemStacks;
}
