/*
 * Character stat + level math.
 *
 *   • stat helpers   — STAT_KEYS, capStat/scaleStat, baseStats/maxedStats,
 *                      normalizeStats, allocatedStatPoints, addToAllStats,
 *                      formatStatName
 *   • level math     — maxHp/Chakra/Stamina for level, rankFromLevel
 *   • the LEVEL CURVE — LEVEL_EARNED_ANCHORS, earnedForLevel, levelForEarned,
 *                      earnedStatPoints (level is a function of earned stat
 *                      points; character XP is retired — see
 *                      docs/leveling-without-xp-map.md)
 *   • stat pool      — reconcile, applyStatGrowth
 *
 * Pure functions depending only on constants/game + the type modules.
 * Extracted from App.tsx (Region A, character cluster).
 */

import { MAX_STAT, MAX_LEVEL, HP_CAP, CHAKRA_CAP, STAMINA_CAP, COMBAT_RESOURCES_V2, CHAKRA_BASE_V2, CHAKRA_CAP_V2, STAMINA_BASE_V2, STAMINA_CAP_V2 } from "../constants/game";
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

// (Character XP is RETIRED — docs/leveling-without-xp-map.md. The whole XP
// curve is gone with it: xpNeeded, the cumulative-XP helpers, the level→
// stat-BUDGET functions and progressAfterXp all had zero callers once level
// became a function of earned stat points, so they are deleted rather than
// left as decoration. Level now comes from earnedForLevel/levelForEarned
// below. The frozen AI stat curve lives in lib/ai-stats.ts aiStatBudgetForLevel.)

export function maxHpForLevel(level: number) {
    // Base HP at level 1 is 500 (starter HP); +100 per level thereafter, up to
    // HP_CAP. Shifting only the base keeps the curve balance-neutral — players and
    // same-level AI (aiHpForLevel multiplies this) both gain the +400 base.
    // Keep this in lock-step with api/_xp-engine.ts maxHpForLevel (parity test).
    return Math.min(HP_CAP, 500 + (Math.max(1, level) - 1) * 100);
}

// v2 (combatResourcesV2) pool: bigger, level-scaling — base@L1 → cap@L100. The
// legacy curve is 100→5,000; v2 is ~1,000→~10,000. Mirrored in api/_xp-engine.ts.
function v2PoolForLevel(level: number, base: number, cap: number) {
    return Math.min(cap, Math.floor(base + (Math.max(1, level) - 1) * ((cap - base) / (MAX_LEVEL - 1))));
}

export function maxChakraForLevel(level: number) {
    if (COMBAT_RESOURCES_V2) return v2PoolForLevel(level, CHAKRA_BASE_V2, CHAKRA_CAP_V2);
    return Math.min(CHAKRA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((CHAKRA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function maxStaminaForLevel(level: number) {
    if (COMBAT_RESOURCES_V2) return v2PoolForLevel(level, STAMINA_BASE_V2, STAMINA_CAP_V2);
    return Math.min(STAMINA_CAP, Math.floor(100 + (Math.max(1, level) - 1) * ((STAMINA_CAP - 100) / (MAX_LEVEL - 1))));
}

export function rankFromLevel(level: number) {
    if (level >= 80) return "Special Jonin";
    if (level >= 50) return "Jonin";
    if (level >= 30) return "Chunin";
    if (level >= 15) return "Genin";
    return "Academy Student";
}

// Two-axis progression: stat points come from TRAINING (added directly to a
// stat, bounded by the per-rank cap), the DAILY CHECKLIST + one-time content
// grants, and COMBAT (the unspentStats pool) — never from a level budget. So
// `unspentStats` is a STORED pool: reconcile only normalizes the stats and
// clamps the pool ≥ 0. It never rolls back spent stats and never grants points
// on level-up (leveling raises caps + pools + content instead).
export function reconcileCharacterStatBudget(character: Character): Character {
    const stats = normalizeStats(character.stats);
    const unspentStats = Math.max(0, Math.floor(character.unspentStats ?? 0));
    return { ...character, stats, unspentStats };
}

// ── Stat-derived leveling (docs/leveling-without-xp-map.md) ──────────────────
// Level is a pure function of total stat points EARNED: points allocated into
// the 12 stats above base plus the unspent pool — the same conserved sum the
// save sanitizer's preserveStatPointEntitlement guards, so level cannot be
// forged without forging stats. The anchors are FITTED to the per-rank stat
// caps: every rank boundary sits at ~68-78% of the previous band's earnable
// capacity (a straight inversion of the old linear budget would wall at
// L15/L30 — Academy can only produce 4,100 earned but the inverse demanded
// 4,243). Piecewise-linear between anchors, rounded per level. Keep in
// lock-step with api/_xp-engine.ts (parity-pinned by _cross-build-parity).
export const LEVEL_EARNED_ANCHORS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [15, 2800],
    [30, 6200],
    [50, 11600],
    [80, 19600],
    [100, 27500],
];

// Total earned stat points required to BE `level` (0 at L1).
export function earnedForLevel(level: number): number {
    const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    for (let i = 1; i < LEVEL_EARNED_ANCHORS.length; i++) {
        const [aL, aE] = LEVEL_EARNED_ANCHORS[i - 1];
        const [bL, bE] = LEVEL_EARNED_ANCHORS[i];
        if (clamped >= aL && clamped <= bL) {
            return aE + Math.round(((clamped - aL) / (bL - aL)) * (bE - aE));
        }
    }
    return 0;
}

// The raw curve inverse: the level `earned` total points supports. Exam holds
// (examLevelCap) are applied by the caller — this is monotone in `earned`.
export function levelForEarned(earned: number): number {
    const points = Math.max(0, Math.floor(earned));
    for (let level = MAX_LEVEL; level >= 2; level--) {
        if (earnedForLevel(level) <= points) return level;
    }
    return 1;
}

// The conserved earned-points sum: allocated above base + the unspent pool.
// Spending and respec both conserve it; only server-side grants (training,
// combat growth, daily-checklist claims, one-time spine grants) raise it.
export function earnedStatPoints(character: Pick<Character, "stats" | "unspentStats">): number {
    return allocatedStatPoints(normalizeStats(character.stats)) + Math.max(0, Math.floor(character.unspentStats ?? 0));
}

// Apply a server-computed combat-use stat reward (Stage 4): add the per-stat
// auto-growth (cap-clamped) into the stats the player used, plus the free-pool
// points into unspentStats. The server is authoritative for the amounts (daily-
// capped, ranked-excluded); this just mirrors them into the local character.
export function applyStatGrowth(character: Character, allocated: Partial<Record<string, number>>, unspentGain: number): Character {
    const stats = normalizeStats(character.stats);
    let used = 0;
    for (const key of STAT_KEYS) {
        const add = Math.max(0, Math.floor(Number(allocated[key] ?? 0)));
        if (add > 0) {
            const before = stats[key];
            stats[key] = capStat(stats[key] + add);
            used += stats[key] - before;
        }
    }
    const free = Math.max(0, Math.floor(Number(unspentGain) || 0));
    return {
        ...character,
        stats,
        unspentStats: Math.max(0, Math.floor(character.unspentStats ?? 0) + free),
        totalStatsTrained: (character.totalStatsTrained ?? 0) + used,
    };
}
