/*
 * Pure core for the daily login-streak reward (api/player/daily-login.ts).
 * Split out from the IO handler so the streak + payout math is unit-testable on
 * its own (same pattern as the _*-validate.ts cores).
 *
 * Server is authoritative: the handler runs computeLoginReward INSIDE the
 * save lock with failClosed, then persists. The CLIENT mirrors only the ryo
 * curve below (shinobij.client/src/lib/daily-briefing.ts) for a pre-claim
 * preview — keep dailyLoginRyo() in sync across the two.
 */

// Reward curve — "modest, level-scaled". L5 ≈ 1,000 · L50 ≈ 5,500 · capped at L75+.
export const LOGIN_RYO_BASE = 500;
export const LOGIN_RYO_PER_LEVEL = 100;
export const LOGIN_RYO_CAP = 8000;
// Every Nth consecutive day grants the shard bonus.
export const STREAK_SHARD_INTERVAL = 7;
export const STREAK_SHARD_REWARD = 5;

export function dailyLoginRyo(level: number): number {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(LOGIN_RYO_CAP, LOGIN_RYO_BASE + LOGIN_RYO_PER_LEVEL * lv);
}

export interface LoginRewardInput {
    /** char.lastLoginRewardDate (UTC YYYY-MM-DD) — '' if never claimed. */
    lastDate: string;
    /** char.loginStreak before this claim. */
    prevStreak: number;
    level: number;
    /** UTC date strings; injected so the math is deterministic in tests. */
    today: string;
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
 * nothing is granted and the existing streak is echoed back. A consecutive day
 * (lastDate === yesterday) extends the streak; any gap resets it to 1.
 */
export function computeLoginReward(i: LoginRewardInput): LoginReward {
    if (i.lastDate === i.today) {
        return { alreadyClaimed: true, streak: cleanStreak(i.prevStreak), ryo: 0, fateShards: 0 };
    }
    const streak = i.lastDate === i.yesterday ? cleanStreak(i.prevStreak) + 1 : 1;
    const ryo = dailyLoginRyo(i.level);
    const fateShards = streak % STREAK_SHARD_INTERVAL === 0 ? STREAK_SHARD_REWARD : 0;
    return { alreadyClaimed: false, streak, ryo, fateShards };
}

/** Whole days until the next shard milestone (0 when today's claim hits one). */
export function daysUntilShardBonus(streak: number): number {
    const s = cleanStreak(streak);
    return (STREAK_SHARD_INTERVAL - (s % STREAK_SHARD_INTERVAL)) % STREAK_SHARD_INTERVAL;
}
