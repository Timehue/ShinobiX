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
import { JUTSU_MAX_LEVEL } from "../constants/game";
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
    return character.jutsuMastery?.find((j) => j.jutsuId === jutsuId) ?? { jutsuId, level: 0, xp: 0 };
}

export function gainJutsuXp(character: Character, jutsuId: string, amount: number, maxLevelAllowed: number): Character {
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

export function scaleJutsuByLevel(jutsu: Jutsu, level: number) {
    // EP scales additively: creator value = level 50 max. Each level below 50 subtracts 0.2 EP.
    // Level 1: maxEP - 49×0.2 ˜ maxEP - 9.8. Level 50: maxEP.
    const scaledEffectPower = Math.max(1, Math.floor(jutsu.effectPower - (50 - level) * 0.2));
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
export function scaleJutsuCostsForCharacter(jutsu: Jutsu, level: number, character: Pick<Character, "maxChakra" | "maxStamina">) {
    const scaled = scaleJutsuByLevel(jutsu, level);
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
