import { isWalkableTile, nearestWalkableTile } from '../shared/sector-walk-mask.js';
import { sectorObstaclesEnabled } from './_release-flags.js';

export function serverWalkableTile(sector: number, tile: number): boolean {
    return isWalkableTile(sector, tile, sectorObstaclesEnabled());
}

export function serverWalkTile(sector: number, tile: number | undefined): number | undefined {
    return tile === undefined ? undefined : nearestWalkableTile(sector, tile, sectorObstaclesEnabled());
}
