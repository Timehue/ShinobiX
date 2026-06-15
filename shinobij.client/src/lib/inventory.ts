/*
 * Inventory helpers — the single access path for player items.
 *
 * Items live in TWO stores on the Character:
 *   • `inventory: string[]`            — unique / equippable gear (weapons,
 *                                        armor, accessories, named forge items,
 *                                        the Aura Sphere, evolution stones …).
 *                                        One array entry per item.
 *   • `itemStacks: {itemId,count}[]`   — counted stacks for non-unique bulk
 *                                        items (consumables, throwables, scrolls,
 *                                        pet food/gear, dungeon shards). One
 *                                        entry per distinct id with a quantity.
 *
 * `stackableItemIds` decides which store an id belongs in. Routing everything
 * through these helpers means callers never have to know — and the counts they
 * read are correct even mid-migration when a stackable id still happens to sit
 * in `inventory[]` (every reader sums BOTH stores).
 *
 * Why a separate store at all: bulk consumables used to live as N duplicate
 * strings in `inventory[]`, so a hoarder blew past the server's 500-entry cap
 * and newly-picked-up items were silently sliced away ("into the void"). Counted
 * stacks keep the array small and the save payload bounded.
 */

import type { Character } from "../types/character";
import { stackableItemIds } from "../data/pet-config";

export type ItemStack = { itemId: string; count: number };

/** Hard ceiling on a single stack's count — tamper / overflow backstop. */
export const MAX_ITEM_STACK = 9999;

export function isStackableId(id: string): boolean {
    return stackableItemIds.has(id);
}

/** Dedupe, floor, drop non-positive, and clamp counts. */
export function cleanItemStacks(stacks?: ItemStack[]): ItemStack[] {
    const counts = new Map<string, number>();
    for (const s of stacks ?? []) {
        if (!s?.itemId) continue;
        const n = Math.max(0, Math.floor(Number(s.count ?? 0)));
        counts.set(s.itemId, (counts.get(s.itemId) ?? 0) + n);
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => ({ itemId, count: Math.min(MAX_ITEM_STACK, count) }));
}

function stacksOf(character: Character): ItemStack[] {
    return cleanItemStacks(character.itemStacks);
}

/** How many of `id` the player owns, summed across BOTH stores. */
export function countItem(character: Character, id: string): number {
    const inv = character.inventory ?? [];
    let n = 0;
    for (const e of inv) if (e === id) n += 1;
    for (const s of stacksOf(character)) if (s.itemId === id) n += s.count;
    return n;
}

export function ownsItem(character: Character, id: string): boolean {
    return countItem(character, id) > 0;
}

/** Total item count across both stores (e.g. for the Packrat achievement). */
export function totalItemCount(character: Character): number {
    const inv = character.inventory ?? [];
    return inv.length + stacksOf(character).reduce((sum, s) => sum + s.count, 0);
}

/** Add `n` of `id`, routed to the correct store. Returns a new Character. */
export function addItem(character: Character, id: string, n = 1): Character {
    const add = Math.floor(n);
    if (!id || add <= 0) return character;
    if (isStackableId(id)) {
        return { ...character, itemStacks: cleanItemStacks([...(character.itemStacks ?? []), { itemId: id, count: add }]) };
    }
    const extra = Array.from({ length: add }, () => id);
    return { ...character, inventory: [...(character.inventory ?? []), ...extra] };
}

export function addItems(character: Character, ids: string[]): Character {
    let next = character;
    for (const id of ids) next = addItem(next, id, 1);
    return next;
}

/**
 * Remove up to `n` of `id`. Drains the counted stack first, then the
 * inventory[] array (handles ids that straddle both stores mid-migration).
 * Returns a new Character; removing more than owned simply removes all owned.
 */
export function removeItem(character: Character, id: string, n = 1): Character {
    let remaining = Math.max(0, Math.floor(n));
    if (!id || remaining <= 0) return character;

    let stacks = stacksOf(character);
    const idx = stacks.findIndex((s) => s.itemId === id);
    if (idx >= 0) {
        const take = Math.min(stacks[idx].count, remaining);
        stacks = stacks
            .map((s, i) => (i === idx ? { ...s, count: s.count - take } : s))
            .filter((s) => s.count > 0);
        remaining -= take;
    }

    let inventory = character.inventory ?? [];
    if (remaining > 0 && inventory.some((e) => e === id)) {
        const next: string[] = [];
        for (const e of inventory) {
            if (e === id && remaining > 0) { remaining -= 1; continue; }
            next.push(e);
        }
        inventory = next;
    }

    return { ...character, inventory, itemStacks: stacks };
}

/** Remove a map of id → quantity (e.g. crafting / mission requirements). */
export function removeItems(character: Character, requirements: Record<string, number>): Character {
    let next = character;
    for (const [id, n] of Object.entries(requirements)) next = removeItem(next, id, n);
    return next;
}

/** Unified {id,count} view across both stores — for display / selling. */
export function unifiedItemStacks(character: Character): ItemStack[] {
    const counts = new Map<string, number>();
    for (const e of character.inventory ?? []) counts.set(e, (counts.get(e) ?? 0) + 1);
    for (const s of stacksOf(character)) counts.set(s.itemId, (counts.get(s.itemId) ?? 0) + s.count);
    return [...counts.entries()].map(([itemId, count]) => ({ itemId, count }));
}

/**
 * MIGRATION (idempotent, lossless): split a legacy combined `inventory[]` —
 * which had stackable ids inline as duplicate strings — into uniques left in
 * `inventory[]` plus counted `itemStacks`. Run on save load (client) so the
 * rest of the app sees the normalized shape. Running twice is a no-op.
 */
export function normalizeInventory(character: Character): Character {
    const inv = Array.isArray(character.inventory) ? character.inventory : [];
    const uniques: string[] = [];
    const counts = new Map<string, number>();
    for (const s of stacksOf(character)) counts.set(s.itemId, s.count);
    for (const entry of inv) {
        if (typeof entry === "string" && isStackableId(entry)) {
            counts.set(entry, (counts.get(entry) ?? 0) + 1);
        } else {
            uniques.push(entry);
        }
    }
    const itemStacks = [...counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => ({ itemId, count: Math.min(MAX_ITEM_STACK, count) }));
    return { ...character, inventory: uniques, itemStacks };
}
