import { sectorFloorLayout } from "./sector-floor-layout";
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES } from "../../../shared/resource-nodes";
import { STORY_FIELD_JOURNEYS } from "../../../shared/story-field-work";
import { sectorExits } from "../../../shared/sector-links";

const GRID = 12;
// The board's middle: the camera follows a player who usually stands near the
// centre or an edge road, and a figure rising three tiles from a high row had
// its head above the visible board.
const HOME_COL = 5.5;
const HOME_ROW = 6;

/** Every tile, nearest the point (col, row) first. Squared distances are
 *  exact, so every browser engine sorts the same way (Math.hypot may differ
 *  in its last bit between engines, and every player must agree). */
function tilesNearest(col: number, row: number): number[] {
    return Array.from({ length: GRID * GRID }, (_, tile) => tile).sort((a, b) => {
        const da = (a % GRID - col) ** 2 + (Math.floor(a / GRID) - row) ** 2;
        const db = (b % GRID - col) ** 2 + (Math.floor(b / GRID) - row) ** 2;
        return da - db || a - b;
    });
}

/** Straight-line distance in tiles. Math.sqrt is correctly rounded everywhere. */
export function tileSpan(dCol: number, dRow: number): number {
    return Math.sqrt(dCol * dCol + dRow * dRow);
}

// The figure's button: 21% of the board wide (2.52 tiles), 4:3 tall, its feet
// 0.92 of the way down the tile it stands on (styles/world-boss-map.css).
const FIGURE_HALF_WIDTH = 1.26;
const FIGURE_HEIGHT = 3.36;
const FIGURE_FEET = 0.92;

const ORDER = tilesNearest(HOME_COL, HOME_ROW);

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

/** How much of one sector's board the boss's figure can use, best first. */
export type WorldBossGround = Readonly<{
    /** Open ground for the whole figure and its name (see worldBossSectorTile). */
    roomy: (tile: number) => boolean;
    /** Unclaimed walkable ground with the figure's head on the board. */
    standable: (tile: number) => boolean;
    /** No gathering spot or story marker under the figure or its name. */
    clear: (tile: number) => boolean;
    /** The figure's button standing on `tile` covers no road exit's tile, so
     *  a tap to cross that road never opens the queue instead. */
    clearOfExits: (tile: number) => boolean;
    walkable: (tile: number) => boolean;
    /** The tiles a canvas tap reaches the boss by while it stands on `tile`:
     *  its feet and the two tiles its body rises into, less any tile a
     *  structure, exit, gathering spot or story marker already answers taps on. */
    footprint: (tile: number) => number[];
}>;

export function worldBossGround(sector: number, isWalkable: (tile: number) => boolean): WorldBossGround {
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
    const exitTiles = [...new Set([...sectorExits(sector).map(exit => exit.tile), ...(sectorFloorLayout(sector)?.exits ?? []).map(exit => exit.tile)])];
    const clearOfExits = (tile: number) => {
        const left = tile % GRID + 0.5 - FIGURE_HALF_WIDTH, right = tile % GRID + 0.5 + FIGURE_HALF_WIDTH;
        const bottom = row(tile) + FIGURE_FEET, top = bottom - FIGURE_HEIGHT;
        return exitTiles.every(exit => left >= exit % GRID + 1 || right <= exit % GRID || top >= row(exit) + 1 || bottom <= row(exit));
    };
    return {
        roomy: tile => row(tile) >= MIN_ROW && row(tile) < GRID - 1
            && bodyOpen(tile) && open(tile + GRID) && bodyClear(tile),
        standable: tile => row(tile) >= MIN_ROW && open(tile),
        clear: bodyClear,
        clearOfExits,
        walkable: isWalkable,
        footprint: tile => [tile, tile - GRID, tile - 2 * GRID].filter(t => t >= 0 && !claimed.has(t) && !marked.has(t)),
    };
}

function bestOf(ground: WorldBossGround, order: readonly number[]): number {
    return order.find(ground.roomy)
        ?? order.find(ground.standable)
        ?? order.find(tile => ground.walkable(tile))
        ?? order[0]!;
}

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
    return bestOf(worldBossGround(sector, isWalkable), ORDER);
}

/**
 * Where the walking boss stops on its way to `tile` (a road exit or a village
 * gate): the nearest place to it, where each thing the spot lacks counts as
 * extra distance. Open ground for the whole figure is worth a tile and a half,
 * a clear view of nearby markers one tile, and the board's side edge another
 * tile and a half, and ground its head would leave the board by more, so a
 * cramped road does not stop it far short of the exit. It stands there for
 * seconds at a time, so a spot where it would cover a road exit's tile costs
 * the most of all.
 */
export function worldBossTileToward(ground: WorldBossGround, tile: number, allowed: (tile: number) => boolean = () => true): number {
    const col = tile % GRID, row = Math.floor(tile / GRID);
    const inward = (t: number) => t % GRID > 0 && t % GRID < GRID - 1 && Math.floor(t / GRID) < GRID - 1;
    const cost = (t: number) => !ground.walkable(t) || !allowed(t) ? Infinity
        : tileSpan(t % GRID - col, Math.floor(t / GRID) - row)
            + (ground.roomy(t) ? 0 : 1.5) + (ground.clear(t) ? 0 : 1) + (inward(t) ? 0 : 1.5) + (ground.standable(t) ? 0 : 4.5)
            + (ground.clearOfExits(t) ? 0 : 8);
    return tilesNearest(col, row).reduce((best, t) => cost(t) < cost(best) ? t : best);
}
