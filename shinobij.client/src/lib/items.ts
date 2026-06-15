/*
 * Item catalog + treasury/inventory helpers.
 *
 *   • getAllItems        — merge starter catalog with creator items, honoring
 *                          admin image overrides + admin/legacy deletions
 *   • getItemById / itemDisplayName — id → item / display-name lookups
 *   • armor sanitizers   — strip maxHp/strength bonuses off armor & gloves
 *   • treasury helpers   — clean/add/remove stacked treasury item entries
 *   • inventory helpers  — add/remove items, group into named stacks
 *
 * Pure functions depending only on the type/constant modules + the starter
 * item catalog. Extracted from App.tsx (Region A).
 */

import { ADMIN_DELETED_ITEM_MARKER } from "../constants/game";
import { starterItems } from "../data/starter-items";
import type { GameItem, EquipmentSlot } from "../types/combat";
import type { Character } from "../types/character";
import { addItems, unifiedItemStacks } from "./inventory";

export function isArmorOrGloveItem(item: GameItem) {
    const armorSlots: EquipmentSlot[] = ["head", "body", "armor", "waist", "legs", "feet"];
    // Gloves ride the "hand" slot (named with glove/gauntlet) or the dedicated
    // "gloves" slot — both are armour for sanitization purposes.
    const isGlove = (item.slot === "hand" || item.slot === "gloves") && /glove|gauntlet/i.test(item.name);
    return Boolean(item.armorQuality) || armorSlots.includes(item.slot) || isGlove;
}

export function sanitizeArmorAndGloveItem(item: GameItem): GameItem {
    if (!isArmorOrGloveItem(item)) return item;
    const { maxHp: _maxHp, strength: _strength, ...bonuses } = item.bonuses;
    return { ...item, bonuses };
}

// IDs that were deleted from starterItems — purge them from any save file that still has them.
const DELETED_ITEM_IDS = new Set([
    "wooden-katana",
    "leg-weapon-earth", "leg-weapon-wind", "leg-weapon-lightning", "leg-weapon-fire", "leg-weapon-water",
    "myth-weapon-earth", "myth-weapon-wind", "myth-weapon-lightning", "myth-weapon-fire", "myth-weapon-water",
]);

function isAdminDeletedItemMarker(item: GameItem) {
    return item.name === ADMIN_DELETED_ITEM_MARKER;
}

export function deletedItemMarker(id: string): GameItem {
    return {
        id,
        name: ADMIN_DELETED_ITEM_MARKER,
        slot: "item",
        rarity: "common",
        cost: 0,
        description: "Admin-deleted item marker.",
        bonuses: {},
    };
}

export function getAllItems(creatorItems: GameItem[]) {
    // starterItems always win for built-in stats so code updates aren't overridden by stale save data.
    // Exception: admin-generated images on starter items ARE respected — only the image field is merged.
    // Deleted items are stripped out entirely even if present in an old save file.
    const starterIds = new Set(starterItems.map((s) => s.id));
    const adminDeletedIds = new Set(creatorItems.filter(isAdminDeletedItemMarker).map((item) => item.id));
    const customOnly = creatorItems.filter((c) =>
        !starterIds.has(c.id) &&
        !DELETED_ITEM_IDS.has(c.id) &&
        !adminDeletedIds.has(c.id) &&
        !isAdminDeletedItemMarker(c)
    );
    // Build a map of image overrides for starter items from creator entries
    const imageOverrides = new Map(
        creatorItems
            .filter(c => starterIds.has(c.id) && c.image && !adminDeletedIds.has(c.id) && !isAdminDeletedItemMarker(c))
            .map(c => [c.id, c.image as string])
    );
    const starterWithImages = starterItems
        .filter(s => !adminDeletedIds.has(s.id))
        .map(s => imageOverrides.has(s.id) ? { ...s, image: imageOverrides.get(s.id) } : s);
    return [...customOnly, ...starterWithImages].map(sanitizeArmorAndGloveItem);
}

export function getItemById(items: GameItem[], id?: string) {
    return items.find((item) => item.id === id);
}

export function itemDisplayName(itemId: string, allItems: GameItem[]) {
    return getItemById(allItems, itemId)?.name ?? itemId;
}

export type TreasuryItemStack = { itemId: string; count: number };

export function cleanTreasuryItems(items?: TreasuryItemStack[]): TreasuryItemStack[] {
    const counts = new Map<string, number>();
    for (const stack of items ?? []) {
        if (!stack?.itemId) continue;
        counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + Math.max(0, Math.floor(Number(stack.count ?? 0))));
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => ({ itemId, count }));
}

export function addTreasuryItem(items: TreasuryItemStack[] | undefined, itemId: string, count = 1) {
    return cleanTreasuryItems([...(items ?? []), { itemId, count }]);
}

export function removeTreasuryItem(items: TreasuryItemStack[] | undefined, itemId: string, count = 1) {
    let remaining = Math.max(1, Math.floor(count));
    return cleanTreasuryItems(items)
        .map((stack) => {
            if (stack.itemId !== itemId || remaining <= 0) return stack;
            const removed = Math.min(stack.count, remaining);
            remaining -= removed;
            return { ...stack, count: stack.count - removed };
        })
        .filter((stack) => stack.count > 0);
}

// Add items, routing each id to the correct store (uniques → inventory[],
// stackables → itemStacks). Thin wrapper over lib/inventory `addItems`.
export function addInventoryItems(character: Character, itemIds: string[]) {
    return addItems(character, itemIds);
}

// LEGACY array-only remover — kept for any caller that only has the raw
// inventory[] and is removing NON-stackable ids. For stackable-aware removal
// (the common case) use `removeItem` / `removeItems` from lib/inventory, which
// also drains itemStacks.
export function removeInventoryItems(inventory: string[], requirements: Record<string, number>) {
    const remaining = { ...requirements };
    return inventory.filter((itemId) => {
        if (!remaining[itemId]) return true;
        remaining[itemId] -= 1;
        return false;
    });
}

// Display stacks across BOTH stores (inventory[] + itemStacks), named + sorted.
export function inventoryItemStacks(character: Character, allItems: GameItem[]) {
    return unifiedItemStacks(character)
        .map(({ itemId, count }) => ({ itemId, count, name: itemDisplayName(itemId, allItems) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
