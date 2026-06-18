/*
 * Pure math for the village-war losing penalty (settled in api/world-state.ts
 * when a war ends with a winner). Split out so the spoils % + standing bump are
 * unit-testable and the magnitudes live in one reviewable place.
 *
 * Spoils: the winner village siphons a slice of the loser village's treasury.
 * No cap (it's a % of CURRENT holdings, so it always leaves the rest and can't
 * go below zero). Draws / timeouts award nothing (no winner → settle skipped).
 */

export const SPOILS_CURRENCY_PCT = 0.15; // ryo + honor seals
export const SPOILS_FATE_PCT = 0.10;     // fate shards

function n(v: unknown): number {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x > 0 ? x : 0;
}

export type SpoilsTreasury = { ryo?: number; honorSeals?: number; fateShards?: number };
export type Spoils = { ryo: number; honorSeals: number; fateShards: number };

/** Amount the winner takes from the loser's CURRENT treasury (floored, >= 0). */
export function computeSpoils(loserTreasury: SpoilsTreasury): Spoils {
    return {
        ryo: Math.floor(n(loserTreasury.ryo) * SPOILS_CURRENCY_PCT),
        honorSeals: Math.floor(n(loserTreasury.honorSeals) * SPOILS_CURRENCY_PCT),
        fateShards: Math.floor(n(loserTreasury.fateShards) * SPOILS_FATE_PCT),
    };
}

export type WarStanding = { wins: number; losses: number; lastResult?: "win" | "loss"; updatedAt: number };

/** Increment a village's win/loss record. */
export function bumpStanding(rec: WarStanding | null | undefined, result: "win" | "loss", now: number): WarStanding {
    const base = rec ?? { wins: 0, losses: 0, updatedAt: 0 };
    return {
        wins: n(base.wins) + (result === "win" ? 1 : 0),
        losses: n(base.losses) + (result === "loss" ? 1 : 0),
        lastResult: result,
        updatedAt: now,
    };
}
