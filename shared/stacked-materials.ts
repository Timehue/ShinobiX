/*
 * Hunt materials and the Weekly Boss Core are counted stacks (owner ruling A12,
 * 2026-10 economy rebalance). They used to land as one `inventory[]` entry per
 * unit, so a 20-hunt day added 60-100 entries against the 500-slot cap and
 * pushed the surplus toward the NPC. They now live in the existing `itemStacks`
 * array (`{ itemId, count }`), which is not an inventory slot.
 *
 * One list for both sides. The client stores them through lib/inventory.ts
 * (data/pet-config.ts `stackableItemIds` includes this list) and folds a loaded
 * save with normalizeInventory. The server folds every save write
 * (api/save/[name].ts) and every grant it makes through grantItemIds below.
 *
 * The fold moves units, it never creates or drops one: a unit that does not fit
 * (a full 9,999 stack, or no free stack key) stays in `inventory[]`, where every
 * reader already counts it.
 */
import { HUNT_MATERIAL_SELL_RYO } from './hunt-material-sale.js';

export const WEEKLY_BOSS_CORE_ID = 'weekly-boss-core';

/** Every hunt-* material (the NPC sale table names all of them) plus the Weekly Boss Core. */
export const STACKED_MATERIAL_IDS: readonly string[] = Object.freeze([...Object.keys(HUNT_MATERIAL_SELL_RYO), WEEKLY_BOSS_CORE_ID]);
const STACKED = new Set(STACKED_MATERIAL_IDS);

export function isStackedMaterialId(id: unknown): id is string {
    return typeof id === 'string' && STACKED.has(id);
}

/** Units one stack holds, and distinct stacks one save holds. The save validator
 *  (api/save/_sanitize-inventory.ts) clamps to both. */
export const ITEM_STACK_MAX = 9999;
export const ITEM_STACK_KEY_CAP = 200;

type Holder = { inventory?: unknown; itemStacks?: unknown };
type Row = Record<string, unknown>;

const whole = (raw: unknown) => Math.max(0, Math.floor(Number(raw) || 0));

/**
 * Move every `inventory[]` copy of a stacked material into its `itemStacks`
 * entry. Idempotent and unit-conserving: for every id, inventory copies plus
 * stack count are the same before and after. Returns the character itself when
 * nothing moves, and leaves a malformed store (not an array) untouched.
 */
export function foldStackedMaterials<T extends Holder>(character: T): T {
    if (!Array.isArray(character.inventory)) return character;
    if (character.itemStacks !== undefined && !Array.isArray(character.itemStacks)) return character;
    const copies = new Map<string, number>();
    for (const entry of character.inventory as unknown[]) {
        if (isStackedMaterialId(entry)) copies.set(entry, (copies.get(entry) ?? 0) + 1);
    }
    if (copies.size === 0) return character;

    const stacks: Row[] = ((character.itemStacks as unknown[] | undefined) ?? []).map((row) =>
        row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Row) } : row as Row);
    const keys = new Set(stacks.flatMap((row) => typeof row?.itemId === 'string' && row.itemId ? [row.itemId] : []));
    const moving = new Map<string, number>();
    for (const [id, held] of copies) {
        let index = stacks.findIndex((row) => row?.itemId === id);
        if (index < 0) {
            if (keys.size >= ITEM_STACK_KEY_CAP) continue;
            stacks.push({ itemId: id, count: 0 });
            keys.add(id);
            index = stacks.length - 1;
        }
        const current = whole(stacks[index].count);
        const move = Math.min(held, Math.max(0, ITEM_STACK_MAX - current));
        if (move <= 0) continue;
        stacks[index] = { ...stacks[index], count: current + move };
        moving.set(id, move);
    }
    if (moving.size === 0) return character;

    const inventory = (character.inventory as unknown[]).filter((entry) => {
        if (!isStackedMaterialId(entry)) return true;
        const left = moving.get(entry) ?? 0;
        if (left <= 0) return true;
        moving.set(entry, left - 1);
        return false;
    });
    return { ...character, inventory, itemStacks: stacks } as T;
}

/**
 * Grant item ids: a stacked material joins its stack, anything else is appended
 * to `inventory[]` as before. Legacy `inventory[]` copies of stacked materials
 * fold in the same step. Blank and non-string ids are dropped. Never refuses and
 * never loses a unit, so a settlement credit may call it after its debit.
 */
export function grantItemIds<T extends Holder>(character: T, ids: readonly unknown[] | undefined): T {
    const add = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!id) : [];
    const inventory = Array.isArray(character.inventory) ? character.inventory as unknown[] : [];
    if (add.length === 0 && !Array.isArray(character.inventory)) return character;
    return foldStackedMaterials({ ...character, inventory: [...inventory, ...add] } as T);
}

/** Units of `itemId` held across both stores (inventory[] copies + stack counts). */
export function heldUnits(character: Holder, itemId: string): number {
    let n = 0;
    if (Array.isArray(character.inventory)) for (const entry of character.inventory) if (entry === itemId) n += 1;
    if (Array.isArray(character.itemStacks)) {
        for (const row of character.itemStacks as unknown[]) {
            if (row && typeof row === 'object' && (row as Row).itemId === itemId) n += whole((row as Row).count);
        }
    }
    return n;
}
