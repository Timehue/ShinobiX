import { gainXp } from '../_xp-engine.js';
import { isWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';

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
 * Relic-survey progress (the `wq-relic-survey` wanderer quest).
 *
 * The sage's errand is to walk one tile in EACH of the five countries, which a
 * flat tile counter cannot express — so we keep the distinct set of biomes
 * walked since the quest was accepted, plus a length mirror the counter-based
 * quest machinery can read unchanged.
 *
 * Maintained on every explore, quest or no quest: keeping it unconditional means
 * this module never has to know whether a quest is active, and accepting the
 * quest simply resets the set (api/sector/wanderer-quest.ts). Both fields are
 * server-mirrored, so a client cannot write its own progress.
 */
export function withRelicSurveyProgress(
    character: Record<string, unknown>,
    sectorRaw: unknown,
): Record<string, unknown> {
    // sectorBiomeOf falls back to 'central' for ANY unrecognised id (0, NaN, an
    // out-of-range sector), so gate on the world registry first — otherwise a bad
    // sector would silently credit a country the player never walked.
    const sector = Math.floor(Number(sectorRaw));
    if (!isWildSector(sector)) return character;
    const biome = sectorBiomeOf(sector);
    if (!biome) return character;
    const seen = Array.isArray(character.relicSurvey)
        ? (character.relicSurvey as unknown[]).filter((b): b is string => typeof b === 'string')
        : [];
    if (seen.includes(biome)) return character;
    const next = [...seen, biome];
    return { ...character, relicSurvey: next, relicSurveyCount: next.length };
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
    const leveled = withRelicSurveyProgress(gainXp(character, paid.xp) as Record<string, unknown>, sectorRaw);
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
