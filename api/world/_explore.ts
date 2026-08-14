import { gainXp } from '../_xp-engine.js';
import { isWildSector } from '../../shared/sector-geo.js';

export const DAILY_SECTOR_EXPLORE_LIMIT = 150;

export type SectorExploreOutcome =
    | { kind: 'chest'; reservationDate?: string; reservationOrdinal?: number }
    | { kind: 'battle' }
    | { kind: 'external'; source: 'dungeon' | 'pet' }
    | { kind: 'none' };

/**
 * The exploration result is authority, not presentation.  Keep the authored
 * World Map odds here so a caller cannot turn every paid tile into its most
 * profitable branch.  Pet and dungeon discovery are resolved before this
 * endpoint; this is the final chest -> battle -> quiet-tile sequence.
 */
export function rollSectorExploreOutcome(
    random: () => number,
    chestAvailable = true,
): SectorExploreOutcome {
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    const chestRoll = unit();
    if (chestAvailable && chestRoll < 0.15) return { kind: 'chest' };
    if (unit() <= 0.80) return { kind: 'battle' };
    return { kind: 'none' };
}

export function sectorExploreReward(sectorRaw: unknown): { sector: number; xp: number; ryo: number } | null {
    const sector = Math.floor(Number(sectorRaw));
    // Bounds come from the shared world registry, not a literal: the 2026-07
    // renumbering widened the world past 60, and a stale ceiling here would
    // refuse to settle the outermost sectors — which now fails the explore
    // outright rather than silently paying nothing.
    if (!isWildSector(sector)) return null;
    // Character XP is retired (leveling-without-xp map): explore is an
    // unlimited-ish repeat channel, so the old xp line (20 + sector/5) folds
    // into ryo instead — the discovery/loot layer stays the draw. `xp` stays in
    // the shape as 0 for old clients.
    return { sector, xp: 0, ryo: 10 + Math.floor(sector / 4) + 10 + Math.floor(sector / 10) };
}

/**
 * Settle one explored tile.
 *
 * `credit` mirrors what the world map actually pays out. Only a tile that
 * produced NO other outcome pays the explore ryo — a tile that opened a chest,
 * turned up a wild pet, revealed the dungeon, or dropped the player into an
 * ambush has always counted toward the explore total without paying the ryo
 * line on top. 'tile' is that case: same daily accounting, no ryo.
 */
export function applySectorExploreReward(
    character: Record<string, unknown>,
    sectorRaw: unknown,
    today: string,
    credit: 'full' | 'tile' = 'full',
) {
    const reward = sectorExploreReward(sectorRaw);
    if (!reward) return { ok: false as const, reason: 'invalid-sector' as const };
    const storedDate = typeof character.serverExploreDate === 'string' ? character.serverExploreDate : '';
    const count = storedDate === today ? Math.max(0, Math.floor(Number(character.serverExploresToday) || 0)) : 0;
    if (count >= DAILY_SECTOR_EXPLORE_LIMIT) return { ok: false as const, reason: 'daily-limit' as const };
    const paid = credit === 'tile' ? { ...reward, ryo: 0 } : reward;
    const leveled = gainXp(character, paid.xp) as Record<string, unknown>;
    return {
        ok: true as const,
        reward: paid,
        character: {
            ...leveled,
            ryo: Math.max(0, Number(leveled.ryo) || 0) + paid.ryo,
            totalTilesExplored: Math.max(0, Math.floor(Number(leveled.totalTilesExplored) || 0)) + 1,
            dailyTilesExplored: count + 1,
            serverExploreDate: today,
            serverExploresToday: count + 1,
        },
    };
}
