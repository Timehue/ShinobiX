"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POISON_SPEND_FACTOR = exports.COMBAT_RESOURCES_V2 = void 0;
exports.v2JutsuResourceCost = v2JutsuResourceCost;
exports.v2ResourceRegen = v2ResourceRegen;
exports.v2PoisonOnSpend = v2PoisonOnSpend;
exports.resolveJutsuDiscipline = resolveJutsuDiscipline;
exports.v2JutsuCosts = v2JutsuCosts;
// Server port of the combatResourcesV2 cost / regen / discipline-routing math.
// VERBATIM mirror of the v2 block in shinobij.client/src/lib/jutsu-scaling.ts —
// keep the two in lock-step (pinned by api/_xp-engine.test.ts). Pure, IO-free, so
// PvP (session/move), Battle Towers, and PvE all compute identical costs.
// See docs/chakra-stamina-redesign-plan.md.
const _xp_engine_js_1 = require("./_xp-engine.js");
Object.defineProperty(exports, "COMBAT_RESOURCES_V2", { enumerable: true, get: function () { return _xp_engine_js_1.COMBAT_RESOURCES_V2; } });
// Concrete per-jutsu cost by AP tier, scaling LINEARLY with caster level from a
// base@L1 to a cap@L100 (slightly slower than the pool → endurance grows ~20→~30
// rounds). Charged to ONE bar by discipline.
const V2_COST_TIERS = [
    { minAp: 60, base: 50, cap: 350 },
    { minAp: 40, base: 25, cap: 175 },
    { minAp: 1, base: 12, cap: 90 },
];
const V2_REGEN_BASE = 25; // per bar, per turn, at L1
const V2_REGEN_CAP = 175; // per bar, per turn, at L100
const V2_CHAKRA_DISCIPLINES = new Set(['Ninjutsu', 'Genjutsu']);
const V2_DISCIPLINES = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];
function v2Lerp(base, cap, level) {
    const L = Math.max(1, Math.min(_xp_engine_js_1.MAX_LEVEL, Math.floor(Number(level) || 1)));
    return Math.round(base + (cap - base) * (L - 1) / (_xp_engine_js_1.MAX_LEVEL - 1));
}
/** v2 concrete per-jutsu resource cost (one bar's worth) for an AP tier + caster level. */
function v2JutsuResourceCost(ap, level) {
    const tier = V2_COST_TIERS.find((t) => (Number(ap) || 0) >= t.minAp);
    return tier ? v2Lerp(tier.base, tier.cap, level) : 0;
}
/** v2 per-turn regen for each bar, scaling with level. */
function v2ResourceRegen(level) {
    return v2Lerp(V2_REGEN_BASE, V2_REGEN_CAP, level);
}
// v2 Poison ticks off EXERTION, not the pool: while poisoned, spending chakra/
// stamina to cast a jutsu deals HP damage scaled by what you spent. Cast big → hurt
// more; turtle → poison barely bites. Factor tuned so a normally-active fighter's
// poison ≈ the legacy pool-based poison (sim-tunable). Mirrored in jutsu-scaling.ts.
exports.POISON_SPEND_FACTOR = 12;
function v2PoisonOnSpend(spend, poisonPct) {
    const pct = poisonPct > 0 ? poisonPct : 6;
    const s = Math.max(0, Number(spend) || 0);
    if (s <= 0)
        return 0;
    return Math.max(1, Math.round(s * (pct / 100) * exports.POISON_SPEND_FACTOR));
}
/** Which bar a jutsu draws from under v2. Concrete type → its bar; "Any"/unknown →
 *  the caster's trained specialty (fallback Taijutsu/stamina), matching the
 *  stampLegacyJutsuType convention. */
function resolveJutsuDiscipline(type, specialty) {
    let t = type ?? '';
    if (t === 'Any' || !V2_DISCIPLINES.includes(t)) {
        t = V2_DISCIPLINES.includes(String(specialty)) ? String(specialty) : 'Taijutsu';
    }
    return V2_CHAKRA_DISCIPLINES.has(t) ? 'chakra' : 'stamina';
}
/** v2 one-bar costs: exactly one of chakra/stamina is nonzero (the discipline bar);
 *  a jutsu with no stored resource cost (free action) stays free. */
function v2JutsuCosts(jutsu, level, specialty) {
    const hasCost = (jutsu.chakraCost ?? 0) > 0 || (jutsu.staminaCost ?? 0) > 0;
    if (!hasCost)
        return { chakraCost: 0, staminaCost: 0 };
    const amount = v2JutsuResourceCost(jutsu.ap ?? 0, level);
    const bar = resolveJutsuDiscipline(jutsu.type, specialty);
    return {
        chakraCost: bar === 'chakra' ? amount : 0,
        staminaCost: bar === 'stamina' ? amount : 0,
    };
}
