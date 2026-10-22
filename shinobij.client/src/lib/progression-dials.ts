/*
 * Progression dials the server publishes on the game-state frame
 * (api/game-state.ts `progressionDials`): the era dial STAT_GAIN_MULTIPLIER, the
 * TRAINING_RATE_TABLE kill switch, the one shared daily stat-point budget
 * (DAILY_STAT_POINT_CAP) and the hunt drop chances (HUNT_FS_CHANCE /
 * HUNT_AS_CHANCE). The server applies every one of them; this copy only keeps
 * previews and card text honest. Before the first frame (or on a malformed one)
 * each falls back to the server's own default, so the preview is never worse
 * than the code default.
 */
import { DAILY_STAT_POINT_CAP } from "../../../shared/combat-growth-rules";
import { HUNT_AS_MIN_LEVEL, HUNT_DROP_CHANCE_DEFAULTS, HUNT_FS_MIN_LEVEL } from "../constants/game";
import { MAX_AGGREGATE_STAT_BOOST, type TrainingRateTable } from "./training-config";
import { sharedDailyStatBudget, sharedProgressionDialsPayload } from "./progression-dials-store";
import { currentDateKey } from "./utils";

/** Mirror of api/_stat-growth.ts DAILY_STAT_POINT_CAP_MAX (the dial's range). */
export const DAILY_STAT_POINT_CAP_MAX = 300;

export interface ProgressionDials {
    statGainMultiplier: number;
    trainingRateTable: TrainingRateTable;
    dailyStatPointCap: number;
    huntDropChances: { fateShards: number; auraStones: number };
}

function chance(raw: unknown, fallback: number): number {
    const n = Number(raw);
    return raw !== null && raw !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Validate a frame's `progressionDials` with the same ranges the server reads. */
export function normalizeProgressionDials(raw: unknown): ProgressionDials {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const dial = Number(r.statGainMultiplier);
    const cap = Number(r.dailyStatPointCap);
    const drops = r.huntDropChances && typeof r.huntDropChances === "object" && !Array.isArray(r.huntDropChances)
        ? r.huntDropChances as Record<string, unknown>
        : {};
    return {
        statGainMultiplier: Number.isFinite(dial) && dial > 0 ? Math.min(MAX_AGGREGATE_STAT_BOOST, dial) : 1,
        trainingRateTable: r.trainingRateTable === "legacy" ? "legacy" : "v2",
        dailyStatPointCap: Number.isInteger(cap) && cap >= 0 && cap <= DAILY_STAT_POINT_CAP_MAX ? cap : DAILY_STAT_POINT_CAP,
        huntDropChances: {
            fateShards: chance(drops.fateShards, HUNT_DROP_CHANCE_DEFAULTS.fateShards),
            auraStones: chance(drops.auraStones, HUNT_DROP_CHANCE_DEFAULTS.auraStones),
        },
    };
}

/** The dials from the latest game-state frame, normalized. */
export function sharedProgressionDials(): ProgressionDials {
    return normalizeProgressionDials(sharedProgressionDialsPayload());
}

export type DailyStatBudget = { day: string; spent: number; cap: number };

/** Today's shared stat-point budget as the last server reply reported it, or
 *  null before any reply today (a reply from an earlier UTC day is stale). */
export function dailyStatBudgetToday(playerName: string): DailyStatBudget | null {
    const raw = sharedDailyStatBudget(playerName);
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const spent = Number(r.spent);
    const cap = Number(r.cap);
    if (r.day !== currentDateKey() || !Number.isInteger(spent) || !Number.isInteger(cap) || spent < 0 || cap < 0) return null;
    return { day: r.day, spent: Math.min(spent, cap), cap };
}

/** Whether the next hunt / field claim can still pay stat points (the server
 *  decides; this only picks the card text). Unknown counts as available. */
export function dailyStatPointsAvailable(playerName: string): boolean {
    const budget = dailyStatBudgetToday(playerName);
    if (budget) return budget.spent < budget.cap;
    return sharedProgressionDials().dailyStatPointCap > 0;
}

/** "Stat points today: 41 / 60" once a reply today has reported the budget. */
export function dailyStatBudgetLine(playerName: string): string | null {
    const budget = dailyStatBudgetToday(playerName);
    return budget ? `Stat points today: ${budget.spent} / ${budget.cap}` : null;
}

/** The mission card's stat text: the per-claim grant, or the spent budget. */
export function missionStatPointText(playerName: string, points: number): string {
    if (dailyStatPointsAvailable(playerName)) return `+${points} Stat Pts`;
    const budget = dailyStatBudgetToday(playerName);
    return budget ? `Daily stat points reached (${budget.cap} / ${budget.cap})` : "Daily stat points reached";
}

/** The chance drops a claim of this kind can roll at the character's level,
 *  e.g. "25% Fate Shard · 20% Aura Stone", or null when none apply. */
export function missionDropChanceText(level: number, kind: "hunt" | "fetch-s"): string | null {
    const { fateShards, auraStones } = sharedProgressionDials().huntDropChances;
    const parts: string[] = [];
    if (level >= HUNT_FS_MIN_LEVEL && fateShards > 0) parts.push(`${Math.round(fateShards * 100)}% Fate Shard`);
    if (kind === "hunt" && level >= HUNT_AS_MIN_LEVEL && auraStones > 0) parts.push(`${Math.round(auraStones * 100)}% Aura Stone`);
    return parts.length ? parts.join(" · ") : null;
}
