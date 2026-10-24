import { isWalkableTile, nearestWalkableTile } from "../../../shared/sector-walk-mask";
import { lifeStandingTiles } from "../../../shared/sector-life-standing";
import { loiterRouteTiles } from "./wanderer-loiter";

const GRID = 12;

/** An interior encounter area that changes with the sector, not just the NPC.
 *
 * The stride is coprime to the 64 interior tiles, so a recurring character
 * occupies a different tile in every consecutive sector for a full 64-sector
 * cycle. The position is stable within a sector for every render and reload.
 */
export function sectorStrideTile(id: string, sector: number): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const index = (((hash + sector * 13) % 64) + 64) % 64;
    const col = 2 + index % 8;
    const row = 2 + Math.floor(index / 8);
    return row * 12 + col;
}

/** Where a story or service character stands: its stride tile, moved off the
 *  sector's residents when it would stand on or beside one. `walkerId` is the
 *  wanderer id its loiter walk follows, when that differs from the placement key. */
export function sectorWandererHomeTile(id: string, sector: number, walkerId = id): number {
    return clearOfSectorResidents(walkerId, sector, sectorStrideTile(id, sector));
}

const tileGap = (a: number, b: number) =>
    Math.max(Math.abs(a % GRID - b % GRID), Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID)));

/**
 * A stationary NPC's home tile, kept clear of the sector's residents.
 *
 * Sector-life residents and quest givers are drawn by separate systems, so before
 * this a giver could roll a resident's rest stop and the two portraits stacked
 * (Mapless Ojii beside Gen in sector 55). The preferred tile is kept when its
 * whole loiter walk stays at least two tiles from every resident standing tile;
 * otherwise the nearest interior tile whose walk does. Where the sector is too
 * crowded for that (the Midlands field, 42), the actor still stands two tiles
 * clear and never walks onto a resident's tile. Everything here is a pure
 * function of (id, sector, preferred), so every player sees the same spot.
 */
export function clearOfSectorResidents(id: string, sector: number, preferred: number): number {
    const standing = lifeStandingTiles(sector);
    const walkable = (tile: number) => isWalkableTile(sector, tile);
    const gap = (tile: number) => standing.reduce((least, other) => Math.min(least, tileGap(tile, other)), Infinity);
    // 0: the whole walk keeps a free tile between it and a resident. 1: it never
    // steps onto one and the home tile is not beside one. 2: home is not on one.
    const rank = (home: number) => {
        if (!walkable(home)) return 4;
        const walk = Math.min(...loiterRouteTiles(id, home, walkable).map(gap));
        return walk >= 2 ? 0 : walk >= 1 && gap(home) >= 2 ? 1 : gap(home) >= 1 ? 2 : 3;
    };
    const start = nearestWalkableTile(sector, preferred);
    let best = start, bestRank = rank(start);
    if (bestRank === 0) return start;
    const distance = (tile: number) => Math.abs(tile % GRID - start % GRID) + Math.abs(Math.floor(tile / GRID) - Math.floor(start / GRID));
    const interior = Array.from({ length: 64 }, (_, i) => (2 + Math.floor(i / 8)) * GRID + 2 + i % 8)
        .sort((a, b) => distance(a) - distance(b) || a - b);
    for (const tile of interior) {
        const tileRank = rank(tile);
        if (tileRank < bestRank) { best = tile; bestRank = tileRank; }
        if (bestRank === 0) break;
    }
    return best;
}
