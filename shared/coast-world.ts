/*
 * The Unmapped Coast's geography: the second map, sectors 101-150.
 *
 * shared/coast-world.json is the single source, written only by
 * scripts/admit-coast-world.mts from the art delivery. This file is the way to
 * read it. It carries the data with it, so client code must load it lazily and
 * never from a startup module; use shared/world-maps.ts there for id checks.
 *
 * A sector is OPEN once its floor has been painted and admitted. Pins, roads
 * and exits exist for all fifty from the start, so an exit never moves when a
 * later region's floors arrive.
 */
import data from './coast-world.json';
import { COAST_GRID, COAST_TILE_COUNT, coastTileWalkable, type CoastExit, type CoastLayout, type CoastSite, type CoastWorldData } from './coast-world-rules.js';
import { COAST_LANDING_SECTOR, isCoastSector } from './world-maps.js';

export const COAST_WORLD = data as unknown as CoastWorldData;

/** The graph version saved walk cursors on the coast name. */
export const COAST_WORLD_VERSION: string = COAST_WORLD.version;

export function coastLayout(sector: number): CoastLayout | null {
    return isCoastSector(sector) ? COAST_WORLD.layouts[String(sector)] ?? null : null;
}

/** True once the sector's floor is in the game and it can be walked. */
export function isCoastSectorOpen(sector: number): boolean {
    return coastLayout(sector) !== null;
}

export const OPEN_COAST_SECTOR_IDS: readonly number[] =
    Object.keys(COAST_WORLD.layouts).map(Number).sort((a, b) => a - b);

export function coastSectorName(sector: number): string | undefined {
    return coastLayout(sector)?.name;
}

/** The gameplay biome of an open coast sector. */
export function coastBiomeOf(sector: number): string | undefined {
    return coastLayout(sector)?.biome;
}

export function coastRegionName(region: number): string | undefined {
    return COAST_WORLD.regions[region - 1];
}

/** Trails out of a sector. Only trails whose far end is open can be walked. */
export function coastExits(sector: number): readonly CoastExit[] {
    return isCoastSector(sector) ? COAST_WORLD.exits[String(sector)] ?? [] : [];
}

const EXIT_BY_ID: ReadonlyMap<string, CoastExit> =
    new Map(Object.values(COAST_WORLD.exits).flat().map(exit => [exit.id, exit]));

export function coastExitById(id: string): CoastExit | undefined {
    return EXIT_BY_ID.get(id);
}

/** A trail can be walked only when both of its sectors are open. */
export function coastExitWalkable(exit: CoastExit): boolean {
    return isCoastSectorOpen(exit.sector) && isCoastSectorOpen(exit.destinationSector);
}

export type CoastSiteRef = CoastSite & { sector: number };

const SITE_BY_ID: ReadonlyMap<string, CoastSiteRef> = new Map(
    Object.entries(COAST_WORLD.layouts).flatMap(([sector, layout]) =>
        Object.values(layout.sites).map(site => [site.id, { ...site, sector: Number(sector) }] as const)),
);

/** A named place on the coast a quest step or a clan can use, with its sector. */
export function coastSite(siteId: string): CoastSiteRef | undefined {
    return SITE_BY_ID.get(siteId);
}

export function coastSitesInSector(sector: number): readonly CoastSiteRef[] {
    return Object.values(coastLayout(sector)?.sites ?? {}).map(site => SITE_BY_ID.get(site.id)!);
}

/** The walkable tile of an open coast sector nearest to `tile` (the tile itself when it can be stood on). */
export function coastNearestWalkableTile(sector: number, tile: number): number {
    const mask = coastLayout(sector)?.mask;
    if (!mask) return tile;
    if (coastTileWalkable(mask, tile)) return tile;
    const x = tile % COAST_GRID, y = Math.floor(tile / COAST_GRID);
    let best = tile, bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < COAST_TILE_COUNT; candidate++) {
        if (!coastTileWalkable(mask, candidate)) continue;
        const distance = Math.max(Math.abs((candidate % COAST_GRID) - x), Math.abs(Math.floor(candidate / COAST_GRID) - y));
        if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    return best;
}

/**
 * Where a traveller arriving in a coast sector is put down. Coming by a trail
 * from the neighbouring sector, it is that trail's own arrival tile. Coming from
 * anywhere else on the coast, it is the middle of the sector. Coming from the
 * home map, it is always the dock.
 */
export function coastArrivalTile(origin: number, destination: number): number | null {
    if (!isCoastSectorOpen(destination)) return null;
    if (!isCoastSector(origin)) return destination === COAST_DOCK.sector ? COAST_DOCK.tile : null;
    const trail = coastExits(origin).find(exit => exit.destinationSector === destination);
    return coastNearestWalkableTile(destination, trail ? trail.destinationTile : Math.floor(COAST_TILE_COUNT / 2) + COAST_GRID / 2);
}

/** Sectors where a clan may found a Landing. */
export const COAST_CONTESTABLE_SECTORS: readonly number[] =
    OPEN_COAST_SECTOR_IDS.filter(sector => COAST_WORLD.layouts[String(sector)].contestable);

/**
 * Where the boat puts you down: the slip in the landing sector. Fixed here,
 * because an arrival tile worked out from the two maps' pins would join two
 * unrelated paintings.
 */
export const COAST_DOCK: { sector: number; tile: number; siteId: string } = (() => {
    const dock = coastSitesInSector(COAST_LANDING_SECTOR).find(site => site.actions.includes('boat-crossing'));
    if (!dock) throw new Error('The coast has no boat landing in its arrival sector.');
    return { sector: COAST_LANDING_SECTOR, tile: dock.returnTile, siteId: dock.id };
})();
