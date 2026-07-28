import { gainXp } from '../_xp-engine.js';

export const DAILY_SECTOR_EXPLORE_LIMIT = 150;

export function sectorExploreReward(sectorRaw: unknown): { sector: number; xp: number; ryo: number } | null {
    const sector = Math.floor(Number(sectorRaw));
    if (!Number.isFinite(sector) || sector < 1 || sector > 60) return null;
    // Character XP is retired (leveling-without-xp map): explore is an
    // unlimited-ish repeat channel, so the old xp line (20 + sector/5) folds
    // into ryo instead — the discovery/loot layer stays the draw. `xp` stays in
    // the shape as 0 for old clients.
    return { sector, xp: 0, ryo: 10 + Math.floor(sector / 4) + 10 + Math.floor(sector / 10) };
}

export function applySectorExploreReward(character: Record<string, unknown>, sectorRaw: unknown, today: string) {
    const reward = sectorExploreReward(sectorRaw);
    if (!reward) return { ok: false as const, reason: 'invalid-sector' as const };
    const storedDate = typeof character.serverExploreDate === 'string' ? character.serverExploreDate : '';
    const count = storedDate === today ? Math.max(0, Math.floor(Number(character.serverExploresToday) || 0)) : 0;
    if (count >= DAILY_SECTOR_EXPLORE_LIMIT) return { ok: false as const, reason: 'daily-limit' as const };
    const leveled = gainXp(character, reward.xp) as Record<string, unknown>;
    return {
        ok: true as const,
        reward,
        character: {
            ...leveled,
            ryo: Math.max(0, Number(leveled.ryo) || 0) + reward.ryo,
            totalTilesExplored: Math.max(0, Math.floor(Number(leveled.totalTilesExplored) || 0)) + 1,
            dailyTilesExplored: count + 1,
            serverExploreDate: today,
            serverExploresToday: count + 1,
        },
    };
}
