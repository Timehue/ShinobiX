import { isStepItemId } from "../../../shared/gear-steps";

/** One announcement: a single gear step item, or a summary of `extra` more when a lot arrive at once. */
export type GearDrop = { key: number; itemId: string; extra?: number };

/** At most this many cards appear for one change; the rest fold into a single summary card. */
export const MAX_DROP_CARDS = 3;

/** How many copies of each gear step item the player holds, in the bag or equipped. */
export function stepCounts(inventory: unknown, equipment: unknown): Map<string, number> {
    const counts = new Map<string, number>();
    // A legacy save can hold one equipped item under two slot names (hand and weapon,
    // body and armor), so each id is counted once however many slots name it.
    const equipped = equipment && typeof equipment === "object" ? [...new Set(Object.values(equipment))] : [];
    const ids: unknown[] = [...(Array.isArray(inventory) ? inventory : []), ...equipped];
    for (const id of ids) {
        if (typeof id === "string" && isStepItemId(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}

/** The step items held now that were not held before, one entry per extra copy. */
export function gainedGearDrops(before: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>, firstKey: number): GearDrop[] {
    const gained: GearDrop[] = [];
    for (const [itemId, count] of now) {
        for (let i = before.get(itemId) ?? 0; i < count; i += 1) gained.push({ key: firstKey + gained.length, itemId });
    }
    return gained;
}

/**
 * Keeps a long absence from burying the screen. A player who comes back after
 * earning many drops elsewhere sees the first few and one summary, not a queue
 * that runs for minutes. Every item is in the bag either way.
 */
export function collapseGearDrops(gained: GearDrop[], max = MAX_DROP_CARDS): GearDrop[] {
    if (gained.length <= max) return gained;
    const shown = gained.slice(0, max - 1);
    return [...shown, { key: gained[max - 1].key, itemId: "", extra: gained.length - shown.length }];
}
