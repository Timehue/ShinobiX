import { sectorFloorLayout } from "./sector-floor-layout";

const GRID = 12;
// The board's middle: the camera follows a player who usually stands near the
// centre or an edge road, and a figure rising three tiles from a high row had
// its head above the visible board.
const HOME_COL = 5.5;
const HOME_ROW = 6;

const ORDER = Array.from({ length: GRID * GRID }, (_, tile) => tile).sort((a, b) => {
    const da = Math.hypot(a % GRID - HOME_COL, Math.floor(a / GRID) - HOME_ROW);
    const db = Math.hypot(b % GRID - HOME_COL, Math.floor(b / GRID) - HOME_ROW);
    return da - db || a - b;
});

/** Tiles a painted structure, its approach, or a road exit already claims. */
function claimedTiles(sector: number): Set<number> {
    const claimed = new Set<number>();
    const layout = sectorFloorLayout(sector);
    if (!layout) return claimed;
    for (const site of Object.values(layout.sites)) {
        if (!site) continue;
        claimed.add(site.approach);
        const [left, top, size] = site.footprint;
        if (left === undefined || top === undefined || !size) continue;
        for (let k = 0; k < size * size; k += 1) claimed.add((top + Math.floor(k / size)) * GRID + left + (k % size));
    }
    if (layout.village) {
        const col = Math.min(GRID - 1, Math.floor(layout.village.left / 100 * GRID));
        const row = Math.min(GRID - 1, Math.floor(layout.village.top / 100 * GRID));
        for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
            const c = col + dc, r = row + dr;
            if (c >= 0 && c < GRID && r >= 0 && r < GRID) claimed.add(r * GRID + c);
        }
        claimed.add(layout.village.approach);
    }
    for (const exit of layout.exits ?? []) claimed.add(exit.tile);
    return claimed;
}

/** The figure is ~3 tiles tall: keep its head on the board. */
const MIN_ROW = 3;

/**
 * Where the roaming world boss stands in its current sector, deterministic per
 * sector so every player sees it in the same place. The figure is about three
 * tiles tall and two and a half wide, with its name under its feet, so the
 * first choice is open ground for all of it: a walkable tile whose neighbours
 * left, right and below and the two tiles its body rises into are walkable too,
 * clear of structures, village gates and road exits. Nearest the board's
 * centre wins. A cramped sector relaxes to its feet alone, then to any
 * walkable tile.
 */
export function worldBossSectorTile(sector: number, isWalkable: (tile: number) => boolean): number {
    const claimed = claimedTiles(sector);
    const open = (tile: number) => tile >= 0 && tile < GRID * GRID && isWalkable(tile) && !claimed.has(tile);
    const row = (tile: number) => Math.floor(tile / GRID);
    const roomy = (tile: number) => row(tile) >= MIN_ROW && row(tile) < GRID - 1
        && open(tile) && open(tile - GRID) && open(tile - 2 * GRID) && open(tile + GRID)
        && tile % GRID > 0 && open(tile - 1) && tile % GRID < GRID - 1 && open(tile + 1);
    return ORDER.find(roomy)
        ?? ORDER.find(tile => row(tile) >= MIN_ROW && open(tile))
        ?? ORDER.find(tile => isWalkable(tile))
        ?? ORDER[0]!;
}
