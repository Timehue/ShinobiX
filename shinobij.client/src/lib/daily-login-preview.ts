// The server remains authoritative (api/player/_daily-login.ts). These small
// helpers only let the briefing preview the next claim without loading the
// retired client recommendation engine and mission catalog.
const LOGIN_RYO_BASE = 500;
const LOGIN_RYO_PER_LEVEL = 100;
const LOGIN_RYO_CAP = 8000;

export const STREAK_SHARD_INTERVAL = 7;
export const STREAK_SHARD_REWARD = 5;

export function dailyLoginRyo(level: number): number {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(LOGIN_RYO_CAP, LOGIN_RYO_BASE + LOGIN_RYO_PER_LEVEL * lv);
}
