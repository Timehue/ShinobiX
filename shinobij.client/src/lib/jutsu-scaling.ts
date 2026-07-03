/*
 * Jutsu mastery, resource-cost and level-scaling math.
 *
 *   • jutsu XP / mastery   — jutsuXpNeeded, getJutsuMastery, gainJutsuXp
 *   • resource costs       — AP→% table, per-character chakra/stamina costs
 *   • level scaling        — effect-power + cost scaling, tag-percent display
 *
 * Pure functions depending only on lib/tags, constants/game and the type
 * modules. Extracted from App.tsx (Region A, jutsu cluster).
 */

import { effectiveTagPercent } from "./tags";
import { JUTSU_MAX_LEVEL, MASTERY_MIN_DAMAGE_FRAC, jutsuLevelCapForLevel, MAX_LEVEL, COMBAT_RESOURCES_V2 } from "../constants/game";
import { isLegacyJutsuId, legacySignatureMasteryLevel, LEGACY_SIGNATURE_MIN_STAGE } from "./legacy-jutsu-slot";
import type { Jutsu, JutsuMastery } from "../types/combat";
import type { Character } from "../types/character";

const jutsuResourceCostPercentByAp: Record<number, number> = {
    20: 2,
    40: 3,
    60: 5,
};

export function cappedPostDamage(damage: number, percent: number) {
    return Math.floor(Math.min(damage * (percent / 100), damage * 0.6));
}

export function jutsuXpNeeded(level: number) {
    if (level >= JUTSU_MAX_LEVEL) return 0;
    return Math.max(1, level) * 50;
}

export function getJutsuMastery(character: Character, jutsuId: string): JutsuMastery {
    // Legacy signatures: mastery is DERIVED from the server-owned Legacy stage
    // (Bound 3→30, Proven 4→40, Mythic 5→50), never from stored entries — so it
    // can't be trained, spoofed, or sit at level 0 when the signature unlocks.
    // Mirrors the server's stage-scaled injection in api/pvp/session.ts.
    if (isLegacyJutsuId(jutsuId)) {
        const stage = character.legacy?.stage ?? 0;
        return { jutsuId, level: stage >= LEGACY_SIGNATURE_MIN_STAGE ? legacySignatureMasteryLevel(stage) : 0, xp: 0 };
    }
    return character.jutsuMastery?.find((j) => j.jutsuId === jutsuId) ?? { jutsuId, level: 0, xp: 0 };
}

export function gainJutsuXp(character: Character, jutsuId: string, amount: number, maxLevelAllowed: number): Character {
    // Legacy signatures never gain XP — their mastery IS the Legacy stage (see
    // getJutsuMastery above); writing entries would only add dead rows to the save.
    if (isLegacyJutsuId(jutsuId)) return character;
    const existing = character.jutsuMastery?.length ? character.jutsuMastery : [];
    const mastery = existing.find((j) => j.jutsuId === jutsuId) ?? { jutsuId, level: 1, xp: 0 };
    let level = mastery.level;
    let xp = mastery.xp + amount;
    while (level < maxLevelAllowed && level < JUTSU_MAX_LEVEL && xp >= jutsuXpNeeded(level)) {
        xp -= jutsuXpNeeded(level);
        level++;
    }
    if (level >= maxLevelAllowed || level >= JUTSU_MAX_LEVEL) {
        level = Math.min(maxLevelAllowed, JUTSU_MAX_LEVEL);
        xp = 0;
    }
    return { ...character, jutsuMastery: [...existing.filter((j) => j.jutsuId !== jutsuId), { jutsuId, level, xp }] };
}

// Rank-capped XP gain. Stops accruing once the jutsu reaches the player's rank
// jutsu-level cap, and NEVER downgrades a jutsu already above the cap (saves from
// before the cap existed are grandfathered — it just stops adding). Save-safe.
export function gainJutsuXpForRank(character: Character, jutsuId: string, amount: number): Character {
    const cap = jutsuLevelCapForLevel(Number(character.level) || 1);
    if (getJutsuMastery(character, jutsuId).level >= cap) return character;
    return gainJutsuXp(character, jutsuId, amount, cap);
}

export function scaleJutsuByLevel(jutsu: Jutsu, level: number) {
    // EP at the jutsu's current mastery — MUST mirror the dealt-damage formula in
    // combat-math.ts / api/pvp/move.ts so the inspect card shows what actually
    // lands. epAtMax is the fully-mastered value (base + JUTSU_MAX_LEVEL×0.2); an
    // untrained jutsu shows MASTERY_MIN_DAMAGE_FRAC of it, ramping to 100% at max.
    const epAtMax = jutsu.effectPower + JUTSU_MAX_LEVEL * 0.2;
    const masteryFrac = MASTERY_MIN_DAMAGE_FRAC + (1 - MASTERY_MIN_DAMAGE_FRAC) * (Math.max(0, Math.min(JUTSU_MAX_LEVEL, level)) / JUTSU_MAX_LEVEL);
    const scaledEffectPower = Math.max(1, Math.floor(epAtMax * masteryFrac));
    const costMultiplier = Math.max(0.8, 1 - Math.max(0, level - 1) * 0.004);
    const chakraCostPercent = jutsu.chakraCost > 0 ? jutsuResourceCostPercent(jutsu, level) : 0;
    const staminaCostPercent = jutsu.staminaCost > 0 ? jutsuResourceCostPercent(jutsu, level) : 0;
    return {
        scaledEffectPower,
        healthCost: Math.max(0, Math.floor((jutsu.healthCost - jutsu.healthCostReducePerLvl * level) * costMultiplier)),
        chakraCost: chakraCostPercent,
        staminaCost: staminaCostPercent,
        chakraCostPercent,
        staminaCostPercent,
    };
}
function jutsuResourceCostPercent(jutsu: Pick<Jutsu, "ap">, masteryLevel = 0) {
    const masteryReduction = masteryLevel >= JUTSU_MAX_LEVEL ? 1 : 0;
    let percent = 0;
    if (jutsu.ap && jutsuResourceCostPercentByAp[jutsu.ap] !== undefined) {
        percent = jutsuResourceCostPercentByAp[jutsu.ap];
    } else if ((jutsu.ap ?? 0) >= 60) {
        percent = 5;
    } else if ((jutsu.ap ?? 0) >= 40) {
        percent = 3;
    } else if ((jutsu.ap ?? 0) > 0) {
        percent = 2;
    }
    return percent > 0 ? Math.max(1, percent - masteryReduction) : 0;
}
function jutsuResourceCost(maxResource: number, jutsu: Pick<Jutsu, "ap" | "chakraCost" | "staminaCost">, resource: "chakra" | "stamina", masteryLevel = 0) {
    const originalCost = resource === "chakra" ? jutsu.chakraCost : jutsu.staminaCost;
    if (!originalCost || originalCost <= 0) return 0;
    return Math.max(1, Math.floor(maxResource * (jutsuResourceCostPercent(jutsu, masteryLevel) / 100)));
}
export function formatJutsuResourcePercent(jutsu: Pick<Jutsu, "ap" | "chakraCost" | "staminaCost">, resource: "chakra" | "stamina", masteryLevel = 0) {
    const originalCost = resource === "chakra" ? jutsu.chakraCost : jutsu.staminaCost;
    return originalCost && originalCost > 0 ? `${jutsuResourceCostPercent(jutsu, masteryLevel)}%` : "0%";
}
export function jutsuResourceBackingCost(jutsu: Pick<Jutsu, "ap">) {
    return jutsuResourceCostPercent(jutsu) > 0 ? 100 : 0;
}
export function lockJutsuResourceCosts<T extends Pick<Jutsu, "ap"> & Partial<Pick<Jutsu, "chakraCost" | "staminaCost" | "chakraCostReducePerLvl" | "staminaCostReducePerLvl">>>(jutsu: T): T {
    const backingCost = jutsuResourceBackingCost(jutsu);
    return {
        ...jutsu,
        chakraCost: backingCost,
        staminaCost: backingCost,
        chakraCostReducePerLvl: 0,
        staminaCostReducePerLvl: 0,
    };
}
// ── combatResourcesV2 — concrete cost / regen / discipline routing ──────────────
// When COMBAT_RESOURCES_V2 is on, a jutsu's resource cost is a concrete number that
// scales with caster level (base@L1 → cap@L100, per AP tier) and is charged to ONE
// bar chosen by discipline — NOT a percentage of max. Costs scale slightly slower
// than the (bigger) pool, so endurance grows ~20 rounds early → ~30 near cap. These
// constants + functions are mirrored VERBATIM in api/_combat-resources.ts and pinned
// by api/_xp-engine.test.ts. Keep the two in lock-step. See
// docs/chakra-stamina-redesign-plan.md.
const V2_COST_TIERS: Array<{ minAp: number; base: number; cap: number }> = [
    { minAp: 60, base: 50, cap: 350 },
    { minAp: 40, base: 25, cap: 175 },
    { minAp: 1, base: 12, cap: 90 },
];
const V2_REGEN_BASE = 25; // per bar, per turn, at L1
const V2_REGEN_CAP = 175; // per bar, per turn, at L100
const V2_CHAKRA_DISCIPLINES = new Set(["Ninjutsu", "Genjutsu"]);
const V2_DISCIPLINES = ["Taijutsu", "Bukijutsu", "Genjutsu", "Ninjutsu"];

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
// stamina to cast a jutsu deals HP damage scaled by what you spent. Factor tuned so
// a normally-active fighter's poison ≈ the legacy pool-based poison (sim-tunable).
// Mirrored in api/_combat-resources.ts (parity-pinned).
export const POISON_SPEND_FACTOR = 12;
export function v2PoisonOnSpend(spend: number, poisonPct: number): number {
    const pct = poisonPct > 0 ? poisonPct : 6;
    const s = Math.max(0, Number(spend) || 0);
    if (s <= 0) return 0;
    return Math.max(1, Math.round(s * (pct / 100) * POISON_SPEND_FACTOR));
}

/** Which bar a jutsu draws from under v2. Concrete type → its bar; "Any"/unknown →
 *  the caster's trained specialty (fallback Taijutsu/stamina), matching the
 *  stampLegacyJutsuType convention so a single-discipline fighter's damage AND
 *  utility land on the same bar. */
export function resolveJutsuDiscipline(type: string | undefined | null, specialty: string | undefined | null): "chakra" | "stamina" {
    let t = type ?? "";
    if (t === "Any" || !V2_DISCIPLINES.includes(t)) {
        t = V2_DISCIPLINES.includes(String(specialty)) ? String(specialty) : "Taijutsu";
    }
    return V2_CHAKRA_DISCIPLINES.has(t) ? "chakra" : "stamina";
}

/** v2 one-bar costs for a jutsu: exactly one of chakra/stamina is nonzero (the
 *  discipline bar); a jutsu with no stored resource cost (free action) stays free. */
export function v2JutsuCosts(
    jutsu: Pick<Jutsu, "ap" | "type" | "chakraCost" | "staminaCost">,
    level: number,
    specialty: string | undefined | null,
): { chakraCost: number; staminaCost: number } {
    const hasCost = (jutsu.chakraCost ?? 0) > 0 || (jutsu.staminaCost ?? 0) > 0;
    if (!hasCost) return { chakraCost: 0, staminaCost: 0 };
    const amount = v2JutsuResourceCost(jutsu.ap ?? 0, level);
    const bar = resolveJutsuDiscipline(jutsu.type, specialty);
    return {
        chakraCost: bar === "chakra" ? amount : 0,
        staminaCost: bar === "stamina" ? amount : 0,
    };
}

/** Display string for a jutsu's chakra/stamina cost. Under v2: the concrete one-bar
 *  number (e.g. "240" for the discipline bar, "0" for the other). Under v1: legacy "X%". */
export function jutsuResourceDisplay(
    jutsu: Pick<Jutsu, "ap" | "type" | "chakraCost" | "staminaCost">,
    resource: "chakra" | "stamina",
    charLevel: number,
    specialty: string | null | undefined,
    masteryLevel = 0,
): string {
    if (COMBAT_RESOURCES_V2) {
        const c = v2JutsuCosts(jutsu, charLevel, specialty);
        return String(resource === "chakra" ? c.chakraCost : c.staminaCost);
    }
    return formatJutsuResourcePercent(jutsu, resource, masteryLevel);
}

export function scaleJutsuCostsForCharacter(jutsu: Jutsu, level: number, character: Pick<Character, "maxChakra" | "maxStamina"> & { specialty?: string | null }) {
    const scaled = scaleJutsuByLevel(jutsu, level);
    if (COMBAT_RESOURCES_V2) {
        return { ...scaled, ...v2JutsuCosts(jutsu, level, character.specialty) };
    }
    return {
        ...scaled,
        chakraCost: jutsuResourceCost(character.maxChakra, jutsu, "chakra", level),
        staminaCost: jutsuResourceCost(character.maxStamina, jutsu, "stamina", level),
    };
}
// Returns a copy of the jutsu with tag percents scaled to the given mastery level for display.
// The stored percent is the level-50 max; each level below 50 subtracts 0.2 (same rate as EP).
export function scaleJutsuTagsForDisplay(jutsu: Jutsu, level: number): Jutsu {
    return {
        ...jutsu,
        tags: jutsu.tags.map(tag => ({
            ...tag,
            percent: tag.percent > 0
                ? Math.max(0, Math.floor(effectiveTagPercent(tag, jutsu.bloodlineRank ?? null, level)))
                : 0,
        })),
    };
}
