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
export type AdminItemLookup = ReadonlyMap<string, Record<string, unknown>> & {
    readonly deletedIds?: ReadonlySet<string>;
};

/**
 * id → item lookup honoring the same priority as the client's getAllItems:
 * built-in ITEM_CATALOG wins for built-in ids; the admin-authored catalog
 * (save:admin1 / save:admin2, see api/_admin-item-catalog.ts) is the
 * authoritative definition for shared custom content; a player's own
 * creatorItems supply the rest (their forged `named-weapon-*` pieces, whose
 * definition exists ONLY there). Custom items are raw save objects (read
 * defensively).
 *
 * The admin catalog outranks the player's copy because that copy is a
 * client-written mirror — a stale or tampered POST must not decide what an
 * admin-authored item does. In practice this changes nothing today: every admin
 * item that shadows a built-in id is already shadowed by ITEM_CATALOG above.
 * `adminItems` is optional so save-less / legacy callers behave exactly as before.
 */
export function buildItemLookup(
    creatorItems: unknown,
    adminItems?: AdminItemLookup | null,
): (id: string) => ItemLike | undefined {
    const custom = new Map<string, Record<string, unknown>>();
    if (Array.isArray(creatorItems)) {
        for (const it of creatorItems) {
            if (it && typeof it === 'object' && typeof (it as Record<string, unknown>).id === 'string') {
                // sub-5 defense-in-depth: budget a pre-existing custom item's
                // bonuses whenever it loads into combat. This array is CLIENT-WRITTEN
                // on the normal save path, so it is a genuine forge surface and the
                // budget stays. (See the admin branch below for the contrast.)
                const entry = budgetItemBonuses(it as Record<string, unknown>);
                custom.set(String(entry.id), entry);
            }
        }
    }
    // Admin-authored items are NOT budgeted — deliberately, and this is the whole
    // point of the distinction.
    //
    // Owner ruling (2026-07-11, re-confirmed 2026-07-31): custom items from the
    // Item Maker are SUPPOSED to be better, or potentially better, than built-in
    // gear. They are owner-authored content, not a cheating surface — the Item
    // Maker is admin-only and its output lives solely on save:admin1/save:admin2,
    // which only an admin-authenticated write can touch. The save side already
    // agrees: an admin save skips sanitizeCharacterSave entirely, so these items
    // are stored UNCLAMPED, and clamping them here at load was the last place that
    // still quietly cut them down to the built-in legendary envelope.
    //
    // What still bounds them: hydrateCharacterFromSave clamps the DERIVED combat
    // multipliers regardless of source — itemDamagePct [0,200], absorb/reflect/
    // lifesteal [0,100], itemShield [0,5000], armorRawDR ≤1.5 — so an authored item
    // can be strong without being unbounded.
    //
    // Do NOT "harden" this back without owner sign-off: budgetItemBonuses clamps
    // LEGITIMATE authored content, which is the opposite of the bloodline
    // rank/point budgets (those clamp FORGED power and are correctly permanent).
    const fromAdmin = (id: string): Record<string, unknown> | undefined => adminItems?.get(id);
    return (id: string) => adminItems?.deletedIds?.has(id)
        ? undefined
        : ITEM_CATALOG[id] ?? fromAdmin(id) ?? custom.get(id);
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

// The 12 combat-stat fields gear can grant (mirrors the client's
// characterCombatStats build in Arena.tsx — each stat gets
// `+ getEquippedItemBonus(field)` BEFORE the per-rank cap).
export const EQUIPMENT_STAT_BONUS_FIELDS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;

/**
 * Sum the combat-stat bonuses granted by equipped gear — the server half of the
 * client's characterCombatStats fold (Arena.tsx), so a named weapon's rolled
 * offense / armor's stat grants apply IDENTICALLY in PvP and every tower-engine
 * mode, not just client-run Arena fights. Owner ruling 2026-07-31: gear stats
 * are an even playing field (everyone can obtain them), so they fold into
 * server combat. Uses the same budgeted lookup as every other derivation
 * (custom/admin items pass through budgetItemBonuses), sums across the raw
 * equipment slot values exactly like getEquippedItemBonus, and leaves rank
 * capping to each engine's existing at-use cap — same order as the client
 * (bonus added BEFORE perRankStatCap).
 */
export function deriveEquipmentStatBonuses(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
    adminItems?: AdminItemLookup | null,
): Record<string, number> {
    const getItem = buildItemLookup(save?.creatorItems, adminItems);
    const out: Record<string, number> = {};
    for (const field of EQUIPMENT_STAT_BONUS_FIELDS) {
        const total = sumEquippedBonus(saveCharacter.equipment, getItem, field);
        if (total) out[field] = total;
    }
    return out;
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
 * top-level savedBloodlines + creatorItems; `adminItems` (optional) supplies the
 * admin-authored definitions the player's own array may not carry. Clamping is
 * applied by the caller.
 */
export function deriveCombatMultipliers(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
    adminItems?: AdminItemLookup | null,
): DerivedMultipliers {
    const equipment = saveCharacter.equipment;
    const getItem = buildItemLookup(save?.creatorItems, adminItems);
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
