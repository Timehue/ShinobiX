/*
 * Character stat + level math.
 *
 *   • stat helpers   — STAT_KEYS, capStat/scaleStat, baseStats/maxedStats,
 *                      normalizeStats, allocatedStatPoints, addToAllStats,
 *                      formatStatName
 *   • level/XP math  — xpNeeded, total-XP curves, maxHp/Chakra/Stamina for level,
 *                      rankFromLevel
 *   • stat budget    — XP→stat-point budget, progressAfterXp, reconcile
 *
 * Pure functions depending only on constants/game + the type modules.
 * Extracted from App.tsx (Region A, character cluster). statPointsEarnedFromXp
 * stays in App.tsx because it pulls effectiveCharacterXpGain from lib/progression.
 */

import { MAX_STAT, MAX_LEVEL, HP_CAP, CHAKRA_CAP, STAMINA_CAP, STARTING_STAT_POINTS } from "../constants/game";
import type { Stats } from "../types/combat";
import type { Character } from "../types/character";

export const STAT_KEYS: Array<keyof Stats> = [
    "strength",
    "speed",
    "intelligence",
    "willpower",
    "bukijutsuOffense",
    "bukijutsuDefense",
    "taijutsuOffense",
    "taijutsuDefense",
    "genjutsuOffense",
    "genjutsuDefense",
    "ninjutsuOffense",
    "ninjutsuDefense",
];

export function capStat(value: number) {
    return Math.min(MAX_STAT, Math.max(0, Math.floor(value)));
}

export function scaleStat(value: number) {
    return capStat(Math.floor(value));
}

export function baseStats(): Stats {
    return {
        strength: 10,
        speed: 10,
        intelligence: 10,
        willpower: 10,
        bukijutsuOffense: 10,
        bukijutsuDefense: 10,
        taijutsuOffense: 10,
        taijutsuDefense: 10,
        genjutsuOffense: 10,
        genjutsuDefense: 10,
        ninjutsuOffense: 10,
        ninjutsuDefense: 10,
    };
}

export function normalizeStats(stats?: Partial<Stats>): Stats {
    const base = baseStats();
    return STAT_KEYS.reduce((normalized, key) => {
        normalized[key] = capStat(stats?.[key] ?? base[key]);
        return normalized;
    }, { ...base });
}

export function allocatedStatPoints(stats: Stats) {
    const base = baseStats();
    return STAT_KEYS.reduce((total, key) => total + Math.max(0, capStat(stats[key]) - base[key]), 0);
}

export function addToAllStats(stats: Stats, amount: number): Stats {
    return {
        strength: capStat(stats.strength + amount),
        speed: capStat(stats.speed + amount),
        intelligence: capStat(stats.intelligence + amount),
        willpower: capStat(stats.willpower + amount),
        bukijutsuOffense: capStat(stats.bukijutsuOffense + amount),
        bukijutsuDefense: capStat(stats.bukijutsuDefense + amount),
        taijutsuOffense: capStat(stats.taijutsuOffense + amount),
        taijutsuDefense: capStat(stats.taijutsuDefense + amount),
        genjutsuOffense: capStat(stats.genjutsuOffense + amount),
        genjutsuDefense: capStat(stats.genjutsuDefense + amount),
        ninjutsuOffense: capStat(stats.ninjutsuOffense + amount),
        ninjutsuDefense: capStat(stats.ninjutsuDefense + amount),
    };
}

export function maxedStats(): Stats {
    return addToAllStats(baseStats(), MAX_STAT);
}

export function formatStatName(name: string) {
    return name
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase());
}

export function xpNeeded(level: number) {
    if (level >= MAX_LEVEL) return 0;
    return level * 100;
}

const TOTAL_XP_TO_MAX_LEVEL = ((MAX_LEVEL - 1) * MAX_LEVEL / 2) * 100;

function totalXpBeforeLevel(level: number) {
    const clampedLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    return ((clampedLevel - 1) * clampedLevel / 2) * 100;
}

function totalXpForProgress(level: number, xp: number) {
    if (level >= MAX_LEVEL) return TOTAL_XP_TO_MAX_LEVEL;
    const currentLevelXp = Math.max(0, Math.min(xpNeeded(level), Math.floor(xp)));
    return Math.min(TOTAL_XP_TO_MAX_LEVEL, totalXpBeforeLevel(level) + currentLevelXp);
}

export function maxHpForLevel(level: number) {
    // Base HP at level 1 is 500 (starter HP); +100 per level thereafter, up to
    // HP_CAP. Shifting only the base keeps the curve balance-neutral — players and
    // same-level AI (aiHpForLevel multiplies this) both gain the +400 base.
    // Keep this in lock-step with api/_xp-engine.ts maxHpForLevel (parity test).
    return Math.min(HP_CAP, 500 + (Math.max(1, level) - 1) * 100);
}

export function maxChakraForLevel(level: number) {
    return Math.min(CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((CHAKRA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function maxStaminaForLevel(level: number) {
    return Math.min(STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((STAMINA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function rankFromLevel(level: number) {
    if (level >= 80) return "Special Jonin";
    if (level >= 50) return "Jonin";
    if (level >= 30) return "Chunin";
    if (level >= 15) return "Genin";
    return "Academy Student";
}

const TOTAL_STAT_POINTS_TO_CAP = STAT_KEYS.reduce((total, key) => total + (MAX_STAT - baseStats()[key]), 0);
const STAT_POINTS_FROM_XP_TO_CAP = TOTAL_STAT_POINTS_TO_CAP - STARTING_STAT_POINTS;

export function statPointBudgetForProgress(level: number, xp: number) {
    const progressXp = totalXpForProgress(level, xp);
    const earnedFromXp = Math.floor((progressXp / TOTAL_XP_TO_MAX_LEVEL) * STAT_POINTS_FROM_XP_TO_CAP);
    return Math.min(TOTAL_STAT_POINTS_TO_CAP, STARTING_STAT_POINTS + earnedFromXp);
}

export function progressAfterXp(level: number, xp: number, amount: number) {
    let nextLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    let nextXp = nextLevel >= MAX_LEVEL ? 0 : Math.max(0, Math.floor(xp)) + Math.max(0, Math.floor(amount));
    while (nextLevel < MAX_LEVEL && nextXp >= xpNeeded(nextLevel)) {
        nextXp -= xpNeeded(nextLevel);
        nextLevel += 1;
    }
    if (nextLevel >= MAX_LEVEL) return { level: MAX_LEVEL, xp: 0 };
    return { level: nextLevel, xp: nextXp };
}

export function reconcileCharacterStatBudget(character: Character): Character {
    const stats = normalizeStats(character.stats);
    const earnedBudget = statPointBudgetForProgress(character.level, character.xp);
    const available = Math.max(0, earnedBudget - allocatedStatPoints(stats));
    return { ...character, stats, unspentStats: available };
}
