/*
 * P0.1 sub-5 — always-on server budget for CUSTOM item bonuses.
 *
 * Scope, narrowed 2026-07-31: this budget applies ONLY to a PLAYER's own
 * `creatorItems` — the array that is client-written on the normal save path, and
 * therefore the actual forge surface. Those are clamped to the built-in legendary
 * baseline so a forged item can't out-scale real gear (the uniform-endgame-gear
 * ceiling, per the balanced-PvP pillar).
 *
 * EXEMPT: built-in items (api/pvp/_item-catalog.ts ITEM_CATALOG), and
 * ADMIN-AUTHORED items from save:admin1/save:admin2 (api/_admin-item-catalog.ts).
 * The latter are owner content from the admin-only Item Maker and are SUPPOSED to
 * exceed built-in gear — the owner's explicit ruling. An admin save already skips
 * sanitizeCharacterSave, so they are stored unclamped; api/pvp/_multipliers.ts
 * buildItemLookup no longer clamps them at load either. Do not re-apply this to
 * them without owner sign-off: it clamps LEGITIMATE content, unlike the bloodline
 * rank/point budgets, which clamp forged power and are correctly permanent.
 *
 * This budget is LOAD-BEARING for authoritative combat: the passive %s + shield
 * flow into PvP via api/pvp/_multipliers.ts sumEquippedBonus, and — owner ruling
 * 2026-07-31 — the specialty-stat bonuses now fold into server combat too
 * (deriveEquipmentStatBonuses → hydrateCharacterFromSave), matching the client's
 * Arena characterCombatStats build. The owner has confirmed this scoped clamp
 * (2026-07-31): a player's own creatorItems are budgeted to the built-in
 * legendary baseline in every server fight; admin-authored gear stays exempt as
 * above. The ceiling includes both built-in legendary gear and the legitimate
 * Named Armor forge ranges.
 *
 * Baselines (see _item-catalog.ts legendary tiers):
 *   passive %s (damage/absorb/reflect/lifesteal) ≤ 2   (Named Armor rolls up to 2%)
 *   shield ≤ 150                                        (Named Armor rolls up to 150)
 *   vitals (maxHp/maxChakra/maxStamina) ≤ 150           (no built-in grants these
 *     any more — pools come from LEVEL alone, so a vitals bonus is inert; the
 *     clamp stays only so a custom/admin item can't author an absurd one)
 *   specialty-stat TOTAL per slot: armor 280 (8×35 Named Armor), hand 420 (gloves 4×75+4×30)
 */

const PASSIVE_PCT_FIELDS = new Set(['damagePercent', 'absorbPercent', 'reflectPercent', 'lifeStealPercent']);
// PvE-only relic power (see api/pvp/_multipliers.ts derivePveBonuses). These sit
// OUTSIDE the per-rank stat cap, so an authored item must not be able to mint an
// arbitrary one — the built-in ceiling is 10 (legendary wild relic).
const PVE_PCT_FIELDS = new Set(['pveDamagePercent', 'pveDamageTakenPercent']);
const MAX_PVE_PCT = 10;
const VITAL_FIELDS = new Set(['maxHp', 'maxChakra', 'maxStamina']);
const MAX_PASSIVE_PCT = 2;
const MAX_SHIELD = 150;
const MAX_VITAL = 150;

const ARMOR_SLOTS = new Set(['head', 'body', 'waist', 'legs', 'feet', 'armor']);
// Specialty-stat (offense/defense) total budget per slot. Unknown slot → loosest
// (hand) so a legit item of an unanticipated slot is never clipped.
function specialtyBudgetForSlot(slot: unknown): number {
    return ARMOR_SLOTS.has(String(slot)) ? 280 : 420;
}

/**
 * Return a copy of `item` whose `bonuses` are clamped to the built-in baseline.
 * Passive %s / shield / vitals get hard per-field caps; the positive specialty-stat
 * TOTAL is scaled proportionally down to the per-slot budget (negatives preserved).
 * No-op for an item without an object `bonuses`.
 */
export function budgetItemBonuses<T extends Record<string, unknown>>(item: T): T {
    if (!item || typeof item !== 'object') return item;
    const bonuses = item.bonuses;
    if (!bonuses || typeof bonuses !== 'object') return item;

    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(bonuses as Record<string, unknown>)) {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : 0;
    }

    for (const f of PASSIVE_PCT_FIELDS) if (f in out) out[f] = Math.max(0, Math.min(MAX_PASSIVE_PCT, out[f]));
    if ('shield' in out) out.shield = Math.max(0, Math.min(MAX_SHIELD, out.shield));
    for (const f of VITAL_FIELDS) if (f in out) out[f] = Math.max(0, Math.min(MAX_VITAL, out[f]));
    for (const f of PVE_PCT_FIELDS) if (f in out) out[f] = Math.max(0, Math.min(MAX_PVE_PCT, out[f]));

    // Everything else = a specialty stat (ninjutsuOffense, …). Scale the positive
    // total down to the per-slot budget; leave negatives (self-penalties) intact.
    const specialtyKeys = Object.keys(out).filter(
        (k) => !PASSIVE_PCT_FIELDS.has(k) && k !== 'shield' && !VITAL_FIELDS.has(k) && !PVE_PCT_FIELDS.has(k),
    );
    let total = 0;
    for (const k of specialtyKeys) if (out[k] > 0) total += out[k];
    const budget = specialtyBudgetForSlot(item.slot);
    if (total > budget && total > 0) {
        const scale = budget / total;
        for (const k of specialtyKeys) if (out[k] > 0) out[k] = Math.floor(out[k] * scale);
    }

    return { ...item, bonuses: out };
}
