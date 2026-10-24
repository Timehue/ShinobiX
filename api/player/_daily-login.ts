/*
 * Pure core for the daily login-streak reward (api/player/daily-login.ts).
 * Split out from the IO handler so the streak + payout math is unit-testable on
 * its own (same pattern as the _*-validate.ts cores).
 *
 * Server is authoritative: the handler runs computeLoginReward INSIDE the
 * save lock with failClosed, then persists. The CLIENT mirrors the ryo curve
 * and the shard schedule below (shinobij.client/src/lib/daily-login-preview.ts)
 * for a pre-claim preview; scripts/daily-login-preview-parity.test.ts pins the
 * two together.
 */

// Reward curve — "modest, level-scaled". L5 ≈ 1,000 · L50 ≈ 5,500 · capped at L75+.
export const LOGIN_RYO_BASE = 500;
export const LOGIN_RYO_PER_LEVEL = 100;
export const LOGIN_RYO_CAP = 8000;
// The streak counts CLAIM DAYS and never resets (2026-10 rebalance, framework
// #21): a player who claims five days a week still reaches every 7th claim day.
// Every Nth claim day grants the shard bonus.
export const STREAK_SHARD_INTERVAL = 7;
export const STREAK_SHARD_REWARD = 5;
// Claim days 2 and 3 add a small one-time return bonus for a new character.
export const STREAK_EARLY_SHARD_DAYS: readonly number[] = [2, 3];
export const STREAK_EARLY_SHARD_REWARD = 2;

export function dailyLoginRyo(level: number): number {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(LOGIN_RYO_CAP, LOGIN_RYO_BASE + LOGIN_RYO_PER_LEVEL * lv);
}

/** Fate Shards paid on the Nth claim day. */
export function loginShardsForClaimDay(claimDay: number): number {
    const day = cleanStreak(claimDay);
    if (day === 0) return 0;
    return (day % STREAK_SHARD_INTERVAL === 0 ? STREAK_SHARD_REWARD : 0)
        + (STREAK_EARLY_SHARD_DAYS.includes(day) ? STREAK_EARLY_SHARD_REWARD : 0);
}

export interface LoginRewardInput {
    /** char.lastLoginRewardDate (UTC YYYY-MM-DD) — '' if never claimed. */
    lastDate: string;
    /** char.loginStreak before this claim: the claim days so far. */
    prevStreak: number;
    level: number;
    /** UTC date strings; injected so the math is deterministic in tests. */
    today: string;
    /** No longer read (the streak never resets); kept for caller compatibility. */
    yesterday: string;
}

export interface LoginReward {
    alreadyClaimed: boolean;
    streak: number;
    ryo: number;
    fateShards: number;
}

function cleanStreak(v: number): number {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Decide today's login reward. Idempotent per UTC day: if lastDate is today,
 * nothing is granted and the existing streak is echoed back. Any other day is
 * one more claim day: the streak never resets on a gap.
 */
export function computeLoginReward(i: LoginRewardInput): LoginReward {
    if (i.lastDate === i.today) {
        return { alreadyClaimed: true, streak: cleanStreak(i.prevStreak), ryo: 0, fateShards: 0 };
    }
    const streak = cleanStreak(i.prevStreak) + 1;
    const ryo = dailyLoginRyo(i.level);
    const fateShards = loginShardsForClaimDay(streak);
    return { alreadyClaimed: false, streak, ryo, fateShards };
}

/** Whole days until the next shard milestone (0 when today's claim hits one). */
export function daysUntilShardBonus(streak: number): number {
    const s = cleanStreak(streak);
    return (STREAK_SHARD_INTERVAL - (s % STREAK_SHARD_INTERVAL)) % STREAK_SHARD_INTERVAL;
}
