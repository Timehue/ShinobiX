"use strict";
/*
 * P0.1 sub-5 — server budget for CUSTOM item bonuses (flag ITEM_BONUS_BUDGET).
 *
 * Built-in items (api/pvp/_item-catalog.ts ITEM_CATALOG) are authoritative and
 * EXEMPT — callers only ever pass player/admin-authored creatorItems here. Those
 * are clamped to the built-in legendary baseline so a forged item can't out-scale
 * real gear (the uniform-endgame-gear ceiling, per the balanced-PvP pillar).
 *
 * Live impact today is small/defense-in-depth: only the passive %s + shield flow
 * into authoritative PvP (api/pvp/_multipliers.ts sumEquippedBonus). Specialty-stat
 * bonuses are NOT folded into server combat, so their budget is storage hygiene +
 * future-proofing. Flag-off keeps the legacy per-field [0,1000] clamp (byte-identical).
 *
 * Baselines (see _item-catalog.ts legendary tiers):
 *   passive %s (damage/absorb/reflect/lifesteal) ≤ 1   (built-ins grant at most 1%)
 *   shield ≤ 100                                        (legendary shield piece)
 *   vitals (maxHp/maxChakra/maxStamina) ≤ 150           (chakra-ring maxChakra)
 *   specialty-stat TOTAL per slot: armor 240 (8×30), hand 420 (gloves 4×75+4×30)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.budgetItemBonuses = budgetItemBonuses;
const PASSIVE_PCT_FIELDS = new Set(['damagePercent', 'absorbPercent', 'reflectPercent', 'lifeStealPercent']);
const VITAL_FIELDS = new Set(['maxHp', 'maxChakra', 'maxStamina']);
const MAX_PASSIVE_PCT = 1;
const MAX_SHIELD = 100;
const MAX_VITAL = 150;
const ARMOR_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'armor']);
// Specialty-stat (offense/defense) total budget per slot. Unknown slot → loosest
// (hand) so a legit item of an unanticipated slot is never clipped.
function specialtyBudgetForSlot(slot) {
    return ARMOR_SLOTS.has(String(slot)) ? 240 : 420;
}
/**
 * Return a copy of `item` whose `bonuses` are clamped to the built-in baseline.
 * Passive %s / shield / vitals get hard per-field caps; the positive specialty-stat
 * TOTAL is scaled proportionally down to the per-slot budget (negatives preserved).
 * No-op for an item without an object `bonuses`.
 */
function budgetItemBonuses(item) {
    if (!item || typeof item !== 'object')
        return item;
    const bonuses = item.bonuses;
    if (!bonuses || typeof bonuses !== 'object')
        return item;
    const out = {};
    for (const [k, v] of Object.entries(bonuses)) {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : 0;
    }
    for (const f of PASSIVE_PCT_FIELDS)
        if (f in out)
            out[f] = Math.max(0, Math.min(MAX_PASSIVE_PCT, out[f]));
    if ('shield' in out)
        out.shield = Math.max(0, Math.min(MAX_SHIELD, out.shield));
    for (const f of VITAL_FIELDS)
        if (f in out)
            out[f] = Math.max(0, Math.min(MAX_VITAL, out[f]));
    // Everything else = a specialty stat (ninjutsuOffense, …). Scale the positive
    // total down to the per-slot budget; leave negatives (self-penalties) intact.
    const specialtyKeys = Object.keys(out).filter((k) => !PASSIVE_PCT_FIELDS.has(k) && k !== 'shield' && !VITAL_FIELDS.has(k));
    let total = 0;
    for (const k of specialtyKeys)
        if (out[k] > 0)
            total += out[k];
    const budget = specialtyBudgetForSlot(item.slot);
    if (total > budget && total > 0) {
        const scale = budget / total;
        for (const k of specialtyKeys)
            if (out[k] > 0)
                out[k] = Math.floor(out[k] * scale);
    }
    return { ...item, bonuses: out };
}
