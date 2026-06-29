/*
 * AI opponent stat scaling — derives an NPC's stat block, HP and armor factor
 * from its level (and jutsu loadout / authored overrides), so creator AIs and
 * built-in mobs scale consistently with player progression.
 *
 * Pure functions depending only on lib/stats, lib/utils, constants/game and the
 * type modules. Extracted from App.tsx (Region A, character cluster).
 */

import { scaleStat, maxHpForLevel, statBudgetAtLevel, STAT_KEYS } from "./stats";
import { clampNumber } from "./utils";
import { MAX_LEVEL, MAX_STAT } from "../constants/game";
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

// Per-stat ceiling above the base-10 floor (2490). 12 × this == the full L100 budget.
const STAT_CAP_OVER_BASE = MAX_STAT - 10;

// Archetype weights (need not sum to 1 — normalized at distribute time). Generals
// and defenses are favored over raw offense; the AI's primary jutsu type lifts its
// OWN offense + the relevant generals, so a Ninjutsu mob reads as a caster, a
// Taijutsu mob as a bruiser, etc. (the old per-type lifts, expressed as weights).
function aiArchetypeWeights(primary?: JutsuType): Record<keyof Stats, number> {
    const w: Record<keyof Stats, number> = {
        strength: 1.1, speed: 1.1, intelligence: 1.1, willpower: 1.1,
        bukijutsuOffense: 1.0, taijutsuOffense: 1.0, genjutsuOffense: 1.0, ninjutsuOffense: 1.0,
        bukijutsuDefense: 1.25, taijutsuDefense: 1.25, genjutsuDefense: 1.25, ninjutsuDefense: 1.25,
    };
    if (primary && primary !== "Any") {
        const stem = `${primary[0].toLowerCase()}${primary.slice(1)}`;
        w[`${stem}Offense` as keyof Stats] = 2.2;
        w[`${stem}Defense` as keyof Stats] = 1.5;
        if (primary === "Ninjutsu" || primary === "Genjutsu") { w.intelligence = 1.7; w.willpower = 1.7; }
        else { w.strength = 1.7; w.speed = 1.7; } // Taijutsu / Bukijutsu
    }
    return w;
}

// Distribute a total stat-point budget across the 12 stats by weight, capping each
// at the per-stat ceiling and re-spreading overflow to non-capped stats so the
// WHOLE budget is spent (up to 12×cap). At L100 (budget == 12×cap) every stat
// reaches MAX_STAT, so a level-100 AI mirrors a fully-maxed player.
function distributeStatBudget(budget: number, weights: Record<keyof Stats, number>): Stats {
    const over: Record<string, number> = {};
    for (const k of STAT_KEYS) over[k] = 0;
    let remaining = Math.max(0, Math.floor(budget));
    let active = STAT_KEYS.filter((k) => weights[k] > 0);
    for (let iter = 0; iter < 24 && remaining > 0 && active.length > 0; iter++) {
        const wsum = active.reduce((s, k) => s + weights[k], 0);
        let handed = 0;
        for (const k of active) {
            const give = Math.min(STAT_CAP_OVER_BASE - over[k], Math.floor((remaining * weights[k]) / wsum));
            if (give > 0) { over[k] += give; handed += give; }
        }
        remaining -= handed;
        if (handed === 0) {
            // rounding stall — hand out the last few points one at a time
            for (const k of active) { if (remaining <= 0) break; if (over[k] < STAT_CAP_OVER_BASE) { over[k]++; remaining--; } }
        }
        active = active.filter((k) => over[k] < STAT_CAP_OVER_BASE);
    }
    return STAT_KEYS.reduce((s, k) => { s[k] = scaleStat(10 + over[k]); return s; }, {} as Stats);
}

// An AI's 12-stat block is the SAME level-budget a player gets (statBudgetAtLevel),
// distributed by archetype — so a level-L AI equals a level-L fully-allocated
// player. The PvE difficulty band multiplier (lib/pve-difficulty.ts) is applied
// SEPARATELY by the encounter; this returns the raw, parity-with-player block.
export function aiStatsForLevel(level: number, jutsus: Jutsu[] = []): Stats {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1)));
    const budget = statBudgetAtLevel(safeLevel);
    const weights = aiArchetypeWeights(aiPrimaryJutsuType(jutsus));
    return distributeStatBudget(budget, weights);
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
