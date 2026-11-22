import { isWalkableTile, nearestWalkableTile } from '../shared/sector-walk-mask.js';
import { coastLayout, coastNearestWalkableTile } from '../shared/coast-world.js';
import { coastTileWalkable } from '../shared/coast-world-rules.js';
import { isCoastSector } from '../shared/world-maps.js';
import { sectorObstaclesEnabled } from './_release-flags.js';

/*
 * The coast has its own floors (shared/coast-world.json). The home walk masks
 * know nothing about a coast sector, and a sector with no mask reads as open
 * ground everywhere, so the coast is answered from its own masks here. Server
 * only: the client must not carry the coast's data in its startup bundle.
 */

export function serverWalkableTile(sector: number, tile: number): boolean {
    if (isCoastSector(sector)) {
        const mask = coastLayout(sector)?.mask;
        return !!mask && coastTileWalkable(mask, tile);
    }
    return isWalkableTile(sector, tile, sectorObstaclesEnabled());
}

export function serverWalkTile(sector: number, tile: number | undefined): number | undefined {
    if (tile === undefined) return undefined;
    if (isCoastSector(sector)) return coastNearestWalkableTile(sector, tile);
    return nearestWalkableTile(sector, tile, sectorObstaclesEnabled());
}
