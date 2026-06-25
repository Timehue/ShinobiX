"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildItemLookup = buildItemLookup;
exports.deriveBloodlineMultiplier = deriveBloodlineMultiplier;
exports.deriveCombatMultipliers = deriveCombatMultipliers;
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
const _item_catalog_js_1 = require("./_item-catalog.js");
// Armor damage-reduction per quality tier — mirrors armorQualityTiers in
// shinobij.client/src/lib/equipment.ts. Keep in sync with that table.
const ARMOR_REDUCTION = {
    Standard: 0.01,
    Reinforced: 0.03,
    Rare: 0.05,
    Elite: 0.06,
    Legendary: 0.07,
    Mythic: 0.08,
};
function armorReductionForQuality(quality) {
    return ARMOR_REDUCTION[String(quality)] ?? 0;
}
// Armor occupies these slots (mirrors getCharacterArmorRawDR). The dedicated
// "armor" slot is included for legacy/custom armor authored there.
const ARMOR_SLOTS = ['head', 'body', 'armor', 'waist', 'legs', 'feet'];
/**
 * id → item lookup honoring the same priority as the client's getAllItems:
 * built-in ITEM_CATALOG wins for built-in ids; a player's custom creatorItems
 * supply everything else. Custom items are raw save objects (read defensively).
 */
function buildItemLookup(creatorItems) {
    const custom = new Map();
    if (Array.isArray(creatorItems)) {
        for (const it of creatorItems) {
            if (it && typeof it === 'object' && typeof it.id === 'string') {
                custom.set(String(it.id), it);
            }
        }
    }
    return (id) => _item_catalog_js_1.ITEM_CATALOG[id] ?? custom.get(id);
}
function equipmentIds(equipment) {
    if (!equipment || typeof equipment !== 'object')
        return [];
    return Object.values(equipment).filter((v) => typeof v === 'string');
}
// Sum of per-piece armor reductions across the armor slots — NO pet Guardian
// bonus (pets do not affect PvP, matching getCharacterArmorRawDR).
function sumArmorReduction(equipment, getItem) {
    if (!equipment || typeof equipment !== 'object')
        return 0;
    const eq = equipment;
    let total = 0;
    for (const slot of ARMOR_SLOTS) {
        const id = eq[slot];
        if (typeof id !== 'string')
            continue;
        const item = getItem(id);
        if (item && item.armorQuality != null)
            total += armorReductionForQuality(item.armorQuality);
    }
    return total;
}
// Sum a named bonus field across ALL equipped items (mirrors getEquippedItemBonus).
function sumEquippedBonus(equipment, getItem, field) {
    let total = 0;
    for (const id of equipmentIds(equipment)) {
        const item = getItem(id);
        const bonuses = item && typeof item === 'object' ? item.bonuses : undefined;
        if (bonuses && typeof bonuses === 'object')
            total += Number(bonuses[field]) || 0;
    }
    return total;
}
/**
 * Bloodline offense multiplier — mirrors getBloodlineMultiplier. Custom/admin
 * bloodlines (found in the player's savedBloodlines) are rank-based; a built-in
 * starter bloodline equipped but not present in savedBloodlines is a flat 1.08;
 * no/unknown bloodline is 1.0.
 */
function deriveBloodlineMultiplier(equippedBloodlineId, savedBloodlines) {
    if (typeof equippedBloodlineId !== 'string' || !equippedBloodlineId)
        return 1.0;
    if (Array.isArray(savedBloodlines)) {
        const bl = savedBloodlines.find((b) => b && typeof b === 'object' && b.id === equippedBloodlineId);
        if (bl) {
            const rank = String(bl.rank ?? '');
            return rank === 'S Rank' ? 1.20 : rank === 'A Rank' ? 1.15 : 1.10;
        }
    }
    if (_item_catalog_js_1.BUILTIN_BLOODLINE_IDS.includes(equippedBloodlineId))
        return 1.08;
    return 1.0;
}
/**
 * Derive the full multiplier layer for a fighter from their authoritative save.
 * `saveCharacter` supplies equippedBloodlineId + equipment; `save` supplies the
 * top-level savedBloodlines + creatorItems. Clamping is applied by the caller.
 */
function deriveCombatMultipliers(saveCharacter, save) {
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
