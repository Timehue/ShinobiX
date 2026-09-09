/*
 * The ONE inventory capacity rule, and the refusal every grant path returns.
 *
 * Two numbers used to say this: `MAX_INVENTORY` in api/shop/_settlement.ts and
 * `INVENTORY_CAP` in api/save/[name].ts. Both were 500, and only the shop ever
 * refused on it — every other grant path appended freely and let the save
 * validator truncate the overflow away, silently destroying the item (MMORPG
 * behavior audit F7).
 *
 * The two halves of the fix are deliberately NOT the same check:
 *
 *   • ACQUISITION (this file) refuses hard, at the moment the player would gain
 *     the item, so they are told "Your inventory is full." while they still have
 *     the thing that would have produced it.
 *   • PERSISTENCE (api/save/[name].ts) is non-destructive: its ceiling is
 *     `max(500, what is already stored)`, so a save can never delete items a
 *     player already holds — including a legacy roster that is already over.
 *
 * So an over-cap veteran keeps everything they have and is simply refused new
 * items until they make room. That asymmetry is the point: the save layer must
 * never be the thing that eats an item, and the grant must never be the thing
 * that silently succeeds into nothing.
 */

/** Distinct non-stackable entries a character may hold. Stackables live in `itemStacks`. */
export const INVENTORY_CAP = 500;

/** The single refusal string, so every path says the same thing to the player. */
export const INVENTORY_FULL_ERROR = 'Your inventory is full.';

export function inventoryCount(character: unknown): number {
    if (!character || typeof character !== 'object') return 0;
    const inventory = (character as Record<string, unknown>).inventory;
    return Array.isArray(inventory) ? inventory.length : 0;
}

/** Room for `incoming` more distinct items without crossing the cap. */
export function hasInventoryRoom(character: unknown, incoming = 1): boolean {
    const wanted = Math.max(0, Math.floor(Number(incoming) || 0));
    if (wanted <= 0) return true;
    return inventoryCount(character) + wanted <= INVENTORY_CAP;
}

/** How many more distinct items fit right now (0 when full or over). */
export function inventoryRoomLeft(character: unknown): number {
    return Math.max(0, INVENTORY_CAP - inventoryCount(character));
}

/**
 * The 409 a grant path should return, or null when there is room.
 *
 * Callers must check this BEFORE consuming whatever produced the item — a token,
 * a claim latch, a daily counter, a treasury debit. Refusing after the spend
 * turns "your bag is full" into "your bag is full and the reward is gone", which
 * is worse than the silent truncation this replaces.
 */
export function inventoryFullBlock(
    character: unknown,
    incoming = 1,
): { status: 409; error: string; reason: 'inventory-full'; roomLeft: number } | null {
    if (hasInventoryRoom(character, incoming)) return null;
    return {
        status: 409,
        error: INVENTORY_FULL_ERROR,
        reason: 'inventory-full',
        roomLeft: inventoryRoomLeft(character),
    };
}

/**
 * Refuse only when an action would actually GROW an already-full inventory.
 *
 * The plain `inventoryFullBlock` is wrong for anything that consumes inventory
 * entries to produce one — crafting is the clearest case: a rare weapon burns
 * 150-800 craft points drawn from `hunt-*` materials, none of which are
 * stackable, so it removes roughly 30-50 individual entries and adds 1. A bag
 * full of hunt materials is exactly how a bag reaches the cap, and crafting is
 * the designed way out of it, so a naive check blocks the escape hatch.
 *
 * Pass the character the action WOULD produce. The action is refused only if it
 * both ends over the cap AND ends with more entries than it started with, so a
 * net-negative or net-neutral action always goes through. Callers compute the
 * result first and discard it on refusal, which keeps the "refuse before the
 * spend" property: nothing is committed either way.
 */
export function inventoryGrowthBlock(
    before: unknown,
    after: unknown,
): { status: 409; error: string; reason: 'inventory-full'; roomLeft: number } | null {
    const afterCount = inventoryCount(after);
    if (afterCount <= INVENTORY_CAP) return null;
    if (afterCount <= inventoryCount(before)) return null;
    return { status: 409, error: INVENTORY_FULL_ERROR, reason: 'inventory-full', roomLeft: 0 };
}
