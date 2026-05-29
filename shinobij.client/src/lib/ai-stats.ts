/*
 * AI opponent stat scaling — derives an NPC's stat block, HP and armor factor
 * from its level (and jutsu loadout / authored overrides), so creator AIs and
 * built-in mobs scale consistently with player progression.
 *
 * Pure functions depending only on lib/stats, lib/utils, constants/game and the
 * type modules. Extracted from App.tsx (Region A, character cluster).
 */

import { scaleStat, maxHpForLevel } from "./stats";
import { clampNumber } from "./utils";
import { MAX_LEVEL } from "../constants/game";
import type { Jutsu, Stats } from "../types/combat";
import type { JutsuType } from "../types/core";
import type { CreatorAi } from "../types/creator-ai";

export function aiPrimaryJutsuType(jutsus: Jutsu[] = []): JutsuType | undefined {
    const counts = jutsus.reduce<Record<JutsuType, number>>((acc, jutsu) => {
        acc[jutsu.type] = (acc[jutsu.type] ?? 0) + 1;
        return acc;
    }, { Any: 0, Ninjutsu: 0, Taijutsu: 0, Genjutsu: 0, Bukijutsu: 0 });
    const sorted = (Object.entries(counts) as [JutsuType, number][])
        .filter(([type]) => type !== "Any")
        .sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[1] ? sorted[0][0] : undefined;
}

export function aiStatsForLevel(level: number, jutsus: Jutsu[] = []): Stats {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    const base = 30 + safeLevel * 16;
    const defenseLift = safeLevel * 5;
    const primaryLift = safeLevel * 9;
    const stats: Stats = {
        strength: scaleStat(base + safeLevel * 3),
        speed: scaleStat(base + safeLevel * 3),
        intelligence: scaleStat(base + safeLevel * 3),
        willpower: scaleStat(base + safeLevel * 3),
        bukijutsuOffense: scaleStat(base),
        bukijutsuDefense: scaleStat(base + defenseLift),
        taijutsuOffense: scaleStat(base),
        taijutsuDefense: scaleStat(base + defenseLift),
        genjutsuOffense: scaleStat(base),
        genjutsuDefense: scaleStat(base + defenseLift),
        ninjutsuOffense: scaleStat(base),
        ninjutsuDefense: scaleStat(base + defenseLift),
    };
    const primary = aiPrimaryJutsuType(jutsus);
    if (primary === "Bukijutsu") {
        stats.bukijutsuOffense = scaleStat(stats.bukijutsuOffense + primaryLift);
        stats.bukijutsuDefense = scaleStat(stats.bukijutsuDefense + safeLevel * 3);
        stats.strength = scaleStat(stats.strength + safeLevel * 4);
        stats.speed = scaleStat(stats.speed + safeLevel * 3);
    } else if (primary === "Taijutsu") {
        stats.taijutsuOffense = scaleStat(stats.taijutsuOffense + primaryLift);
        stats.taijutsuDefense = scaleStat(stats.taijutsuDefense + safeLevel * 3);
        stats.strength = scaleStat(stats.strength + safeLevel * 4);
        stats.speed = scaleStat(stats.speed + safeLevel * 4);
    } else if (primary === "Genjutsu") {
        stats.genjutsuOffense = scaleStat(stats.genjutsuOffense + primaryLift);
        stats.genjutsuDefense = scaleStat(stats.genjutsuDefense + safeLevel * 3);
        stats.intelligence = scaleStat(stats.intelligence + safeLevel * 4);
        stats.willpower = scaleStat(stats.willpower + safeLevel * 4);
    } else if (primary === "Ninjutsu") {
        stats.ninjutsuOffense = scaleStat(stats.ninjutsuOffense + primaryLift);
        stats.ninjutsuDefense = scaleStat(stats.ninjutsuDefense + safeLevel * 3);
        stats.intelligence = scaleStat(stats.intelligence + safeLevel * 4);
        stats.willpower = scaleStat(stats.willpower + safeLevel * 3);
    }
    return stats;
}

export function aiHpForLevel(level: number, toughness = 0) {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    const levelScale = safeLevel / MAX_LEVEL;
    return Math.floor(maxHpForLevel(safeLevel) * (1.12 + levelScale * 0.35 + toughness * 1.5));
}

export function aiRawDamageReductionForLevel(level: number, toughness = 0) {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    return clampNumber(0.06 + safeLevel * 0.005 + toughness * 0.28, 0.08, 0.62);
}

export function aiArmorFactorFromRaw(rawDR: number) {
    return clampNumber(1 - rawDR, 0.45, 0.97);
}

export function aiArmorFactorForLevel(level: number, toughness = 0) {
    return aiArmorFactorFromRaw(aiRawDamageReductionForLevel(level, toughness));
}

export function aiArmorFactorForProfile(ai?: Pick<CreatorAi, "level" | "armorRawDR" | "armorFactor"> | null) {
    if (!ai) return 1.0;
    if (typeof ai.armorFactor === "number") return clampNumber(ai.armorFactor, 0.45, 1.0);
    if (typeof ai.armorRawDR === "number") return aiArmorFactorFromRaw(ai.armorRawDR);
    return aiArmorFactorForLevel(ai.level);
}
