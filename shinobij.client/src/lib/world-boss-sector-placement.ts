import { sectorFloorLayout } from "./sector-floor-layout";
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES } from "../../../shared/resource-nodes";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";

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
    // A gathering spot's approach is where players tap to walk; the boss's
    // footprint would take that tap and open the queue instead.
    for (const node of resourceNodesIn(sector)) claimed.add(node.approach);
    return claimed;
}

function resourceNodesIn(sector: number) {
    return [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(node => node.sector === sector);
}

/** Markers drawn over the board that the boss's body must not cover. */
function markedTiles(sector: number): Set<number> {
    const marked = new Set<number>(resourceNodesIn(sector).map(node => node.target));
    for (const journey of Object.values(STORY_FIELD_JOURNEYS)) {
        for (const point of Object.values(journey.points)) if (point.sector === sector) marked.add(point.tile);
    }
    return marked;
}

/** The figure is ~3 tiles tall: keep its head on the board. */
const MIN_ROW = 3;

/**
 * Where the roaming world boss stands in its current sector, deterministic per
 * sector so every player sees it in the same place. The figure is about three
 * tiles tall and two and a half wide, with its name under its feet, so the
 * first choice is open ground for all of it: a walkable tile whose neighbours
 * left, right and below and the two tiles its body rises into are walkable too,
 * clear of structures, village gates, road exits and gathering approaches, and
 * whose body (three tiles wide, three tall) and name row cover no gathering
 * spot or story field marker. Nearest the board's centre wins. A cramped sector relaxes to
 * its feet alone, then to any walkable tile.
 */
export function worldBossSectorTile(sector: number, isWalkable: (tile: number) => boolean): number {
    const claimed = claimedTiles(sector);
    const marked = markedTiles(sector);
    const open = (tile: number) => tile >= 0 && tile < GRID * GRID && isWalkable(tile) && !claimed.has(tile);
    const row = (tile: number) => Math.floor(tile / GRID);
    // Two columns each side: on a phone a gathering icon gets the 48px touch
    // floor, nearly two tiles wide, so one a column away still meets the boss.
    const bodyClear = (tile: number) => {
        for (let dr = -2; dr <= 1; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
            const r = row(tile) + dr, c = tile % GRID + dc;
            if (r >= 0 && c >= 0 && c < GRID && marked.has(r * GRID + c)) return false;
        }
        return true;
    };
    // The whole body box (three wide, three tall) on open ground, so on a phone,
    // where the figure is drawn wider than three tiles, it still clears walls.
    const bodyOpen = (tile: number) => {
        const col = tile % GRID;
        if (col === 0 || col === GRID - 1) return false;
        for (let dr = -2; dr <= 0; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
            if (!open(tile + dr * GRID + dc)) return false;
        }
        return true;
    };
    const roomy = (tile: number) => row(tile) >= MIN_ROW && row(tile) < GRID - 1
        && bodyOpen(tile) && open(tile + GRID) && bodyClear(tile);
    return ORDER.find(roomy)
        ?? ORDER.find(tile => row(tile) >= MIN_ROW && open(tile))
        ?? ORDER.find(tile => isWalkable(tile))
        ?? ORDER[0]!;
}
