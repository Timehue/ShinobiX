// Server port of the combatResourcesV2 cost / regen / discipline-routing math.
// VERBATIM mirror of the v2 block in shinobij.client/src/lib/jutsu-scaling.ts —
// keep the two in lock-step (pinned by api/_xp-engine.test.ts). Pure, IO-free, so
// PvP (session/move), Battle Towers, and PvE all compute identical costs.
// See docs/chakra-stamina-redesign-plan.md.
import { MAX_LEVEL, COMBAT_RESOURCES_V2 } from './_xp-engine.js';

export { COMBAT_RESOURCES_V2 };

// Concrete per-jutsu cost by AP tier, scaling LINEARLY with caster level from a
// base@L1 to a cap@L100 (slightly slower than the pool → endurance grows ~20→~30
// rounds). Charged to ONE bar by discipline.
const V2_COST_TIERS: Array<{ minAp: number; base: number; cap: number }> = [
    { minAp: 60, base: 50, cap: 350 },
    { minAp: 40, base: 25, cap: 175 },
    { minAp: 1, base: 12, cap: 90 },
];
const V2_REGEN_BASE = 25; // per bar, per turn, at L1
const V2_REGEN_CAP = 175; // per bar, per turn, at L100
const V2_CHAKRA_DISCIPLINES = new Set(['Ninjutsu', 'Genjutsu']);
const V2_DISCIPLINES = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];

function v2Lerp(base: number, cap: number, level: number): number {
    const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
    return Math.round(base + (cap - base) * (L - 1) / (MAX_LEVEL - 1));
}

/** v2 concrete per-jutsu resource cost (one bar's worth) for an AP tier + caster level. */
export function v2JutsuResourceCost(ap: number, level: number): number {
    const tier = V2_COST_TIERS.find((t) => (Number(ap) || 0) >= t.minAp);
    return tier ? v2Lerp(tier.base, tier.cap, level) : 0;
}

/** v2 per-turn regen for each bar, scaling with level. */
export function v2ResourceRegen(level: number): number {
    return v2Lerp(V2_REGEN_BASE, V2_REGEN_CAP, level);
}

// v2 Poison ticks off EXERTION, not the pool: while poisoned, spending chakra/
// stamina to cast a jutsu deals HP damage scaled by what you spent. Cast big → hurt
// more; turtle → poison barely bites. Factor tuned so a normally-active fighter's
// poison ≈ the legacy pool-based poison (sim-tunable). Mirrored in jutsu-scaling.ts.
export const POISON_SPEND_FACTOR = 12;
export function v2PoisonOnSpend(spend: number, poisonPct: number): number {
    const pct = poisonPct > 0 ? poisonPct : 6;
    const s = Math.max(0, Number(spend) || 0);
    if (s <= 0) return 0;
    return Math.max(1, Math.round(s * (pct / 100) * POISON_SPEND_FACTOR));
}

/** Which bar a jutsu draws from under v2. Concrete type → its bar; "Any"/unknown →
 *  the caster's trained specialty (fallback Taijutsu/stamina), matching the
 *  stampLegacyJutsuType convention. */
export function resolveJutsuDiscipline(type: string | undefined | null, specialty: string | undefined | null): 'chakra' | 'stamina' {
    let t = type ?? '';
    if (t === 'Any' || !V2_DISCIPLINES.includes(t)) {
        t = V2_DISCIPLINES.includes(String(specialty)) ? String(specialty) : 'Taijutsu';
    }
    return V2_CHAKRA_DISCIPLINES.has(t) ? 'chakra' : 'stamina';
}

/** v2 one-bar costs: exactly one of chakra/stamina is nonzero (the discipline bar);
 *  a jutsu with no stored resource cost (free action) stays free. */
export function v2JutsuCosts(
    jutsu: { ap?: number; type?: string; chakraCost?: number; staminaCost?: number },
    level: number,
    specialty: string | undefined | null,
): { chakraCost: number; staminaCost: number } {
    const hasCost = (jutsu.chakraCost ?? 0) > 0 || (jutsu.staminaCost ?? 0) > 0;
    if (!hasCost) return { chakraCost: 0, staminaCost: 0 };
    const amount = v2JutsuResourceCost(jutsu.ap ?? 0, level);
    const bar = resolveJutsuDiscipline(jutsu.type, specialty);
    return {
        chakraCost: bar === 'chakra' ? amount : 0,
        staminaCost: bar === 'stamina' ? amount : 0,
    };
}
