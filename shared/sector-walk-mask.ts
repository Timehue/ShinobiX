import { sectorArtKey } from './sector-geo';
import { FLOOR_WALK_MASKS } from './sector-floor-layouts';

export type WalkMask = readonly string[];
export { FLOOR_ART_SHA256 } from './sector-floor-layouts';
export const SECTOR_GRID_WIDTH = 12;
const TILE_COUNT = 144;
const validTile = (tile: number) => Number.isInteger(tile) && tile >= 0 && tile < TILE_COUNT;

export function sectorWalkMask(sector: number, enabled = true): WalkMask | undefined {
    return enabled ? FLOOR_WALK_MASKS[sectorArtKey(sector)] : undefined;
}

export function walkableInMask(mask: WalkMask | undefined, tile: number): boolean {
    return validTile(tile) && (!mask || '.='.includes(mask[Math.floor(tile / 12)]?.[tile % 12] ?? '#'));
}

export function isWalkableTile(sector: number, tile: number, enabled = true): boolean {
    return walkableInMask(sectorWalkMask(sector, enabled), tile);
}

export function tileNeighbors(tile: number): number[] {
    if (!validTile(tile)) return [];
    return [tile - 12, tile % 12 > 0 ? tile - 1 : -1,
        tile % 12 < 11 ? tile + 1 : -1, tile + 12].filter(validTile);
}

/** Manhattan distance, then lowest tile id: stable across client and server. */
export function nearestInMask(mask: WalkMask | undefined, tile: number): number {
    const origin = Math.max(0, Math.min(143, Math.floor(Number.isFinite(tile) ? tile : 78)));
    if (walkableInMask(mask, origin)) return origin;
    const x = origin % 12, y = Math.floor(origin / 12);
    let best = origin, distance = Infinity;
    for (let candidate = 0; candidate < TILE_COUNT; candidate++) {
        if (!walkableInMask(mask, candidate)) continue;
        const d = Math.abs(candidate % 12 - x) + Math.abs(Math.floor(candidate / 12) - y);
        if (d < distance) { best = candidate; distance = d; }
    }
    return best;
}

export function nearestWalkableTile(sector: number, tile: number, enabled = true): number {
    return nearestInMask(sectorWalkMask(sector, enabled), tile);
}

export function pathInMask(mask: WalkMask | undefined, from: number, to: number): number[] | null {
    if (!walkableInMask(mask, from) || !walkableInMask(mask, to)) return null;
    const previous = new Map<number, number | null>([[from, null]]), queue = [from];
    for (let index = 0; index < queue.length; index++) {
        const tile = queue[index]!;
        if (tile === to) {
            const path: number[] = [];
            for (let step: number | null = tile; step !== null; step = previous.get(step) ?? null) path.push(step);
            return path.reverse();
        }
        for (const next of tileNeighbors(tile)) {
            if (!walkableInMask(mask, next) || previous.has(next)) continue;
            previous.set(next, tile); queue.push(next);
        }
    }
    return null;
}

export function walkPath(sector: number, from: number, to: number, enabled = true): number[] | null {
    return pathInMask(sectorWalkMask(sector, enabled), from, to);
}

export function walkableTiles(sector: number, enabled = true): number[] {
    return Array.from({ length: TILE_COUNT }, (_, tile) => tile).filter(tile => isWalkableTile(sector, tile, enabled));
}
