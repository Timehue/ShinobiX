// The server remains authoritative (api/player/_daily-login.ts). These small
// helpers only let the briefing preview the next claim without loading the
// retired client recommendation engine and mission catalog. Pinned to the
// server by scripts/daily-login-preview-parity.test.ts.
const LOGIN_RYO_BASE = 500;
const LOGIN_RYO_PER_LEVEL = 100;
const LOGIN_RYO_CAP = 8000;

// The streak counts claim days and never resets on a gap.
export const STREAK_SHARD_INTERVAL = 7;
export const STREAK_SHARD_REWARD = 5;
export const STREAK_EARLY_SHARD_DAYS: readonly number[] = [2, 3];
export const STREAK_EARLY_SHARD_REWARD = 2;

export function dailyLoginRyo(level: number): number {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(LOGIN_RYO_CAP, LOGIN_RYO_BASE + LOGIN_RYO_PER_LEVEL * lv);
}

/** Fate Shards paid on the Nth claim day (mirror of loginShardsForClaimDay). */
export function loginShardsForClaimDay(claimDay: number): number {
    const day = Math.floor(Number(claimDay));
    if (!Number.isFinite(day) || day <= 0) return 0;
    return (day % STREAK_SHARD_INTERVAL === 0 ? STREAK_SHARD_REWARD : 0)
        + (STREAK_EARLY_SHARD_DAYS.includes(day) ? STREAK_EARLY_SHARD_REWARD : 0);
}
