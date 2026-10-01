/*
 * Slim player saves: stop storing copies of SHARED admin content in every
 * ordinary player's `save:<name>` row.
 *
 * Measured 2026-10-01 on production: the character itself averaged ~10 KB of a
 * ~280 KB median save; ~97% of the bytes were copies of admin-authored content
 * (the pet catalog alone 139 KB, only 29 distinct versions across 168 saves).
 * Those copies inflate every autosave, the owner GET, the nightly snapshots, the
 * roster read and the compare-and-set commit, and they serve no fight:
 *
 *   - editablePets / creatorAis / creatorEvents / creatorCards: no server code
 *     reads a PLAYER's copy. Combat, rewards and shops read the admin slots
 *     (api/_admin-*-catalog.ts); the client pulls them at login (App.tsx
 *     pullSharedAdminContent) and caches them on the device.
 *   - creatorItems: combat resolves an id as ITEM_CATALOG ?? admin catalog ??
 *     the player's own copy (api/pvp/_multipliers.ts buildItemLookup). So a copy
 *     whose id the built-in or admin catalog already defines can never be read —
 *     only those are dropped. Forged named gear (the save is its only home),
 *     anything neither catalog knows, and admin-deleted ids are KEPT, so item
 *     resolution is unchanged BY CONSTRUCTION. A copy of an ADMIN item the
 *     player holds is kept too: the Admin Panel deletes custom items without a
 *     tombstone, and after such a delete that copy is the item's only
 *     definition. Only copies of items the player does not hold are dropped.
 *   - creatorJutsus is deliberately untouched: PvP still resolves a player's
 *     stored copy over the admin one (api/pvp/session.ts), and the owner chose
 *     zero PvP change (2026-10-01).
 *
 * Gated by SLIM_PLAYER_SAVES=1 so it can be verified on real data first
 * (api/admin/slim-player-saves.ts dry run) and switched off instantly.
 */
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { FORGED_ITEM_ID } from './_forged-items.js';

/** Top-level shared-content copies that are removed outright. */
export const SLIMMED_SHARED_FIELDS = ['editablePets', 'creatorAis', 'creatorEvents', 'creatorCards'] as const;

export type SlimAdminItems = ReadonlyMap<string, unknown> & { readonly deletedIds?: ReadonlySet<string> };

export function slimPlayerSavesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.SLIM_PLAYER_SAVES === '1';
}

/**
 * True when a player's copy of this item can never be read by combat: the
 * built-in or live admin catalog defines the id first. Forged ids are never
 * shadowed (the admin catalog refuses them), and a deleted id is kept so the
 * slim never depends on tombstone semantics.
 */
export function isShadowedItemCopy(id: string, adminItems: SlimAdminItems | null | undefined): boolean {
    if (!id || FORGED_ITEM_ID.test(id)) return false;
    if (Object.prototype.hasOwnProperty.call(ITEM_CATALOG, id)) return true;
    if (adminItems?.deletedIds?.has(id)) return false;
    return Boolean(adminItems?.has(id));
}

/**
 * Every string anywhere in the record outside the item copies themselves and
 * the fields being removed — an over-approximation of "item ids this player
 * holds" (inventory, equipment, itemStacks, bank, pet gear, receipts...).
 */
function referencedStrings(record: Record<string, unknown>): Set<string> {
    const seen = new Set<string>();
    const skip = new Set<string>(['creatorItems', ...SLIMMED_SHARED_FIELDS]);
    const stack: unknown[] = Object.entries(record).filter(([key]) => !skip.has(key)).map(([, value]) => value);
    while (stack.length > 0) {
        const value = stack.pop();
        if (typeof value === 'string') seen.add(value);
        else if (Array.isArray(value)) stack.push(...value);
        else if (value && typeof value === 'object') stack.push(...Object.values(value as Record<string, unknown>));
    }
    return seen;
}

export type SlimResult<T> = { record: T; changed: boolean; removedFields: string[]; droppedItemCopies: number };

/**
 * Remove shared-content copies from an ordinary player's save record. Pure:
 * returns a new object and never mutates `record` (callers commit with
 * compare-and-set against it). With `adminItems` unavailable (null/empty) only
 * copies of BUILT-IN items are dropped — the safe direction.
 */
export function slimPlayerSaveRecord<T extends Record<string, unknown>>(
    record: T,
    adminItems: SlimAdminItems | null | undefined,
): SlimResult<T> {
    const next: Record<string, unknown> = { ...record };
    const removedFields: string[] = [];
    for (const field of SLIMMED_SHARED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
            delete next[field];
            removedFields.push(field);
        }
    }
    let droppedItemCopies = 0;
    if (Array.isArray(record.creatorItems)) {
        // An admin item the player HOLDS keeps its copy: the Admin Panel deletes
        // a custom item without a tombstone, and this copy is then the only
        // definition left for gear the player still owns. Built-in items cannot
        // be deleted, so their copies go regardless.
        let held: Set<string> | null = null;
        const kept = (record.creatorItems as unknown[]).filter((item) => {
            const id = item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined;
            let shadowed = typeof id === 'string' && isShadowedItemCopy(id, adminItems);
            if (shadowed && !Object.prototype.hasOwnProperty.call(ITEM_CATALOG, id as string)) {
                held ??= referencedStrings(record);
                if (held.has(id as string)) shadowed = false;
            }
            if (shadowed) droppedItemCopies += 1;
            return !shadowed;
        });
        if (droppedItemCopies > 0) next.creatorItems = kept;
    }
    const changed = removedFields.length > 0 || droppedItemCopies > 0;
    return { record: (changed ? next : record) as T, changed, removedFields, droppedItemCopies };
}
