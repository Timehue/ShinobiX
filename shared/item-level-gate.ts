/*
 * Gear level ladder — the single source of truth for "what level must I be to
 * use this item?" (owner ruling 2026-08-17).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `levelReq` was already a field on every item, but it was populated by hand and
 * had drifted badly: 17 epic, 21 legendary and 11 mythic items carried NO
 * requirement at all, while the ones that did ran 40-for-most-legendaries next
 * to a 55 mythic — a lower gate on the rarer tier. Worse, the field was enforced
 * in exactly ONE place (api/craft/_forge.ts), so buying and equipping ignored it
 * entirely and a level-1 character could wear mythic gear.
 *
 * This module replaces the per-item guesswork with a rarity ladder pinned to the
 * rank bands players already feel (statCapForLevel: Academy 1 / Genin 15 /
 * Chunin 30 / Jonin 50 / Special Jonin 80):
 *
 *     common     1    Academy — the starting kit
 *     uncommon  15    Genin
 *     rare      30    Chunin
 *     epic      50    Jonin
 *     legendary 65    mid-Jonin, the last tier before the endgame
 *     mythic    80    Special Jonin
 *     named     90    forged one-offs — owner-set; the final gear you earn
 *
 * ── Floor, not override ─────────────────────────────────────────────────────
 * An item's own `levelReq` is kept when it is HIGHER than its tier floor, so a
 * designer can still gate one specific piece later than its rarity implies (the
 * Lv58+ Reckoning relics and the 70/75 legendaries rely on this). The ladder
 * only ever raises a too-low or missing value — it can never make a piece
 * available earlier than its author intended.
 */

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'named';

/** Minimum character level per rarity tier. */
export const RARITY_LEVEL_FLOOR: Readonly<Record<ItemRarity, number>> = {
    common: 1,
    uncommon: 15,
    rare: 30,
    epic: 50,
    legendary: 65,
    mythic: 80,
    named: 90,
};

/** Forged "named-*" gear is its own tier above mythic. Mirrors api/craft/_named.ts. */
export const NAMED_ITEM_LEVEL_REQ = RARITY_LEVEL_FLOOR.named;

function floorFor(rarity: unknown): number {
    const key = typeof rarity === 'string' ? rarity.toLowerCase() : '';
    return Object.prototype.hasOwnProperty.call(RARITY_LEVEL_FLOOR, key)
        ? RARITY_LEVEL_FLOOR[key as ItemRarity]
        : RARITY_LEVEL_FLOOR.common;
}

type GatedItem = { rarity?: unknown; levelReq?: unknown; cost?: unknown };

/**
 * The level actually required to buy or equip `item`.
 *
 * ── The ladder applies to PRICED gear only ──────────────────────────────────
 * Rarity is a good proxy for power but a bad one for AVAILABILITY. 28 catalog
 * items are high-rarity yet cost 0 because content hands them over: the Aura
 * Sphere is a legendary granted by a level-9 event, `hunt-ancient-beast-core`
 * is an epic crafting MATERIAL, dungeon fragments and elemental cores are drops.
 * Floor-by-rarity would have locked the Aura Sphere — a keystone whose perks key
 * off being equipped — behind level 65 for 56 levels, and made hunt materials
 * unusable by the hunters who farm them.
 *
 * So: an item you can BUY or CRAFT toward (cost > 0) is governed by the ladder,
 * because the ladder is about when you may spend on a tier. An item the game
 * GAVE you keeps only its authored `levelReq`, because the content that granted
 * it already decided when you get it.
 *
 * Forged `named` gear is the exception that is always floored — it is minted at
 * runtime with cost 0, and 90 is the whole point of the tier.
 */
export function effectiveItemLevelReq(item: GatedItem | null | undefined): number {
    if (!item || typeof item !== 'object') return RARITY_LEVEL_FLOOR.common;
    const declaredRaw = Math.floor(Number(item.levelReq));
    const declared = Number.isFinite(declaredRaw) && declaredRaw > 0 ? declaredRaw : 0;

    const rarity = typeof item.rarity === 'string' ? item.rarity.toLowerCase() : '';
    if (rarity === 'named') return Math.max(declared, RARITY_LEVEL_FLOOR.named);

    const cost = Number(item.cost);
    const priced = Number.isFinite(cost) && cost > 0;
    if (!priced) return declared > 0 ? declared : RARITY_LEVEL_FLOOR.common;

    return Math.max(declared, floorFor(rarity));
}

/** True when `level` may use `item`. */
export function meetsItemLevelReq(item: GatedItem | null | undefined, level: unknown): boolean {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    return lvl >= effectiveItemLevelReq(item);
}
