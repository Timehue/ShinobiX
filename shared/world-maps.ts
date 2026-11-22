/*
 * Which world a sector number belongs to.
 *
 * The game has two maps. The home map is sectors 1-74 plus Death's Gate (99),
 * described by shared/sector-geo.ts. The Unmapped Coast is sectors 101-150,
 * described by shared/coast-world.ts. The two never share a table: home systems
 * that pick or scan sectors (world boss, NPC roam, rifts, tracker trails, clan
 * shrines, village wars) read only the home tables, so they stay off the coast
 * unless one is opened to it on purpose.
 *
 * This file is id arithmetic only. It imports no data, so any module on either
 * side, including the client's startup code, can use it for free.
 */
import { MAX_WILD_SECTOR, isPlayableWildSector, sectorRewardTier } from './sector-geo.js';

export type WorldMapId = 'home' | 'coast';

/** The coast's own block of sector numbers. Fixed: saves store these numbers. */
export const COAST_SECTOR_MIN = 101;
export const COAST_SECTOR_MAX = 150;
/** The sector the boat lands in. */
export const COAST_LANDING_SECTOR = 101;
/** The home-map sector the boat sails from and returns to: Western Piers, in Stormveil Harbor. */
export const HOME_HARBOR_SECTOR = 7;
/** Ten sectors to a region, five regions. */
export const COAST_REGION_SIZE = 10;
export const COAST_REGION_COUNT = 5;

/**
 * The level the coast opens at, and the level band of each region, region 1
 * first. Owner ruling 2026-11-21: "increase the level to come to this map from
 * 50 to 75 and rescale everything accordingly". It was 50, with uneven bands up
 * to 100; it is 75 with five levels a region. Everything that reads a coast
 * level reads it from here: the crossing, the boat on the home map, every
 * quest's gate (api/quests/_catalog.test.ts holds each gate to its region's
 * band), the patrols, the garrisons and the right to contest land.
 */
export const COAST_MIN_LEVEL = 75;
export const COAST_REGION_LEVELS: readonly (readonly [low: number, high: number])[] = [[75, 80], [80, 85], [85, 90], [90, 95], [95, 100]];

export const COAST_SECTOR_IDS: readonly number[] =
    Array.from({ length: COAST_SECTOR_MAX - COAST_SECTOR_MIN + 1 }, (_, index) => COAST_SECTOR_MIN + index);

/** True for a sector number in the coast's block, whether or not it is open yet. */
export function isCoastSector(sector: number): boolean {
    return Number.isInteger(sector) && sector >= COAST_SECTOR_MIN && sector <= COAST_SECTOR_MAX;
}

/** The coast region (1-5) a coast sector sits in, or 0 for any other number. */
export function coastRegionOf(sector: number): number {
    return isCoastSector(sector) ? Math.floor((sector - COAST_SECTOR_MIN) / COAST_REGION_SIZE) + 1 : 0;
}

/**
 * The map a sector number is on, or null for a number on neither. Sector 0
 * (inside a village) and Death's Gate (99) are home-map places.
 */
export function sectorMapOf(sector: number): WorldMapId | null {
    if (!Number.isInteger(sector)) return null;
    if (isCoastSector(sector)) return 'coast';
    if (sector === 0 || sector === 99 || (sector >= 1 && sector <= MAX_WILD_SECTOR)) return 'home';
    return null;
}

/**
 * The home reward tiers the coast pays at (owner ruling 2026-11-19): its last
 * sector pays as home sector 66, the top tier at home, so the coast is never
 * richer ground than the best of the home map. Its first sector paid as home
 * sector 32 while the coast opened at level 50, about half way up. The coast
 * opens at level 75 now (COAST_MIN_LEVEL), so its first sector pays as home
 * sector 50, three quarters of the way up, by the same rule.
 */
export const COAST_REWARD_TIER_MIN = 50;
export const COAST_REWARD_TIER_MAX = 66;

/**
 * The number to feed into any reward or level formula that scales with the
 * sector, on either map. Home sectors read exactly as sectorRewardTier does.
 */
export function worldRewardTier(sector: number): number {
    const s = Math.floor(sector);
    if (!isCoastSector(s)) return sectorRewardTier(s);
    const span = COAST_REWARD_TIER_MAX - COAST_REWARD_TIER_MIN;
    return COAST_REWARD_TIER_MIN + Math.round(((s - COAST_SECTOR_MIN) * span) / (COAST_SECTOR_MAX - COAST_SECTOR_MIN));
}

/** A sector whose tiles can be explored: a walkable home board, or the coast. */
export function isExplorableSector(sector: number): boolean {
    return isPlayableWildSector(sector) || isCoastSector(sector);
}

/** True when two sector numbers are on the same map. Travel between maps is by boat only. */
export function sameWorldMap(a: number, b: number): boolean {
    const map = sectorMapOf(a);
    return map !== null && map === sectorMapOf(b);
}
