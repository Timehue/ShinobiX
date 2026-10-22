/** Missing versions always retain deployed legacy rules, including after cutover. */
export type ClanBossRulesVersion = 1 | 2;
export const CLAN_BOSS_V2_START = Date.UTC(2026, 9, 26);
export function clanBossRules(version?: ClanBossRulesVersion) {
    return version === 2
        ? { version: 2 as const, basePool: 48000, perMember: 24000, assaultHp: 72000, participantAttempts: true }
        : { version: 1 as const, basePool: 14000, perMember: 8000, assaultHp: 24000, participantAttempts: false };
}
export function clanBossWeekStart(now: number): number {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7);
}
export function newClanBossWeekTiming(now: number) {
    const start = clanBossWeekStart(now);
    return start >= CLAN_BOSS_V2_START
        ? { rulesVersion: 2 as const, spawnedAt: start, endsAt: start + 7 * 86400000 }
        : { spawnedAt: now, endsAt: now + 7 * 86400000 };
}
