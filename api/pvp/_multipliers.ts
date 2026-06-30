/*
 * Server-side derivation of the PvP combat MULTIPLIER layer.
 *
 * These values (bloodlineMult, armorFactor/armorRawDR, item*Pct, itemShield)
 * were historically computed on the client and shipped in the session-create
 * body — never persisted — so hydrateCharacterFromSave fell through to the
 * (clamped but client-trusted) value for BOTH fighters. This module recomputes
 * them from the AUTHORITATIVE save: the equipped bloodline's rank +
 * save.savedBloodlines, and the equipped armor/items resolved against the
 * generated built-in ITEM_CATALOG ∪ the player's own creatorItems.
 *
 * The math mirrors the client helpers verbatim so honest fighters get the exact
 * same numbers:
 *   - getBloodlineMultiplier   (shinobij.client/src/lib/combat-math.ts)
 *   - getCharacterArmorRawDR / getCharacterArmorFactor / getEquippedItemBonus
 *     (shinobij.client/src/lib/equipment-stats.ts)
 *   - armorReductionForQuality (shinobij.client/src/lib/equipment.ts)
 *
 * Pure functions; no I/O. session.ts applies the existing clamps on top as a
 * final ceiling.
 */
import { ITEM_CATALOG, BUILTIN_BLOODLINE_IDS, type CatalogItem } from './_item-catalog.js';
import { budgetItemBonuses } from '../_item-budget.js';

// Armor damage-reduction per quality tier — mirrors armorQualityTiers in
// shinobij.client/src/lib/equipment.ts. Keep in sync with that table.
const ARMOR_REDUCTION: Record<string, number> = {
    Standard: 0.01,
    Reinforced: 0.03,
    Rare: 0.05,
    Elite: 0.06,
    Legendary: 0.07,
    Mythic: 0.08,
};

function armorReductionForQuality(quality: unknown): number {
    return ARMOR_REDUCTION[String(quality)] ?? 0;
}

// Armor occupies these slots (mirrors getCharacterArmorRawDR). The dedicated
// "armor" slot is included for legacy/custom armor authored there.
const ARMOR_SLOTS = ['head', 'body', 'armor', 'waist', 'legs', 'feet'] as const;

type ItemLike = CatalogItem | Record<string, unknown>;

/**
 * id → item lookup honoring the same priority as the client's getAllItems:
 * built-in ITEM_CATALOG wins for built-in ids; a player's custom creatorItems
 * supply everything else. Custom items are raw save objects (read defensively).
 */
export function buildItemLookup(creatorItems: unknown): (id: string) => ItemLike | undefined {
    const custom = new Map<string, Record<string, unknown>>();
    const budgetOn = process.env.ITEM_BONUS_BUDGET === '1';
    if (Array.isArray(creatorItems)) {
        for (const it of creatorItems) {
            if (it && typeof it === 'object' && typeof (it as Record<string, unknown>).id === 'string') {
                // sub-5 defense-in-depth: budget a pre-existing custom item's bonuses
                // when it loads into combat, so an item saved before ITEM_BONUS_BUDGET
                // was enabled still can't out-scale built-in gear.
                const entry = budgetOn ? budgetItemBonuses(it as Record<string, unknown>) : (it as Record<string, unknown>);
                custom.set(String(entry.id), entry);
            }
        }
    }
    return (id: string) => ITEM_CATALOG[id] ?? custom.get(id);
}

function equipmentIds(equipment: unknown): string[] {
    if (!equipment || typeof equipment !== 'object') return [];
    return Object.values(equipment as Record<string, unknown>).filter(
        (v): v is string => typeof v === 'string',
    );
}

// Sum of per-piece armor reductions across the armor slots — NO pet Guardian
// bonus (pets do not affect PvP, matching getCharacterArmorRawDR).
function sumArmorReduction(equipment: unknown, getItem: (id: string) => ItemLike | undefined): number {
    if (!equipment || typeof equipment !== 'object') return 0;
    const eq = equipment as Record<string, unknown>;
    let total = 0;
    for (const slot of ARMOR_SLOTS) {
        const id = eq[slot];
        if (typeof id !== 'string') continue;
        const item = getItem(id) as Record<string, unknown> | undefined;
        if (item && item.armorQuality != null) total += armorReductionForQuality(item.armorQuality);
    }
    return total;
}

// Sum a named bonus field across ALL equipped items (mirrors getEquippedItemBonus).
function sumEquippedBonus(
    equipment: unknown,
    getItem: (id: string) => ItemLike | undefined,
    field: string,
): number {
    let total = 0;
    for (const id of equipmentIds(equipment)) {
        const item = getItem(id) as Record<string, unknown> | undefined;
        const bonuses = item && typeof item === 'object' ? (item.bonuses as Record<string, unknown> | undefined) : undefined;
        if (bonuses && typeof bonuses === 'object') total += Number(bonuses[field]) || 0;
    }
    return total;
}

/**
 * Bloodline offense multiplier — mirrors getBloodlineMultiplier. Custom/admin
 * bloodlines (found in the player's savedBloodlines) are rank-based; a built-in
 * starter bloodline equipped but not present in savedBloodlines is a flat 1.08;
 * no/unknown bloodline is 1.0.
 */
export function deriveBloodlineMultiplier(equippedBloodlineId: unknown, savedBloodlines: unknown): number {
    if (typeof equippedBloodlineId !== 'string' || !equippedBloodlineId) return 1.0;
    if (Array.isArray(savedBloodlines)) {
        const bl = savedBloodlines.find(
            (b) => b && typeof b === 'object' && (b as Record<string, unknown>).id === equippedBloodlineId,
        ) as Record<string, unknown> | undefined;
        if (bl) {
            const rank = String(bl.rank ?? '');
            return rank === 'S Rank' ? 1.20 : rank === 'A Rank' ? 1.15 : 1.10;
        }
    }
    if (BUILTIN_BLOODLINE_IDS.includes(equippedBloodlineId)) return 1.08;
    return 1.0;
}

export type DerivedMultipliers = {
    bloodlineMult: number;
    armorFactor: number;
    armorRawDR: number;
    itemDamagePct: number;
    itemAbsorbPct: number;
    itemReflectPct: number;
    itemLifeStealPct: number;
    itemShield: number;
};

/**
 * Derive the full multiplier layer for a fighter from their authoritative save.
 * `saveCharacter` supplies equippedBloodlineId + equipment; `save` supplies the
 * top-level savedBloodlines + creatorItems. Clamping is applied by the caller.
 */
export function deriveCombatMultipliers(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
): DerivedMultipliers {
    const equipment = saveCharacter.equipment;
    const getItem = buildItemLookup(save?.creatorItems);
    const armorTotal = sumArmorReduction(equipment, getItem);
    return {
        bloodlineMult: deriveBloodlineMultiplier(saveCharacter.equippedBloodlineId, save?.savedBloodlines),
        // armorRawDR is the PvP DR sum (capped 1.5); armorFactor is the legacy
        // form (only read by move.ts as a fallback when armorRawDR is absent),
        // derived consistently from the same no-pet total.
        armorRawDR: Math.min(1.5, armorTotal),
        armorFactor: Math.max(0.25, 1 - armorTotal),
        itemDamagePct: sumEquippedBonus(equipment, getItem, 'damagePercent'),
        itemAbsorbPct: sumEquippedBonus(equipment, getItem, 'absorbPercent'),
        itemReflectPct: sumEquippedBonus(equipment, getItem, 'reflectPercent'),
        itemLifeStealPct: sumEquippedBonus(equipment, getItem, 'lifeStealPercent'),
        itemShield: sumEquippedBonus(equipment, getItem, 'shield'),
    };
}
