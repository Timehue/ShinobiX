/*
 * Pet Arena constants — grid dimensions, hand-crafted obstacle layouts,
 * and type-effectiveness matchup table.
 *
 * Pure data. The arena resolver (battle simulator + BFS pathfinding +
 * type-multiplier helper) stays in App.tsx; these are just the inputs.
 *
 * Extracted from App.tsx.
 */

import type { JutsuElement } from "../types/core";

// ── Grid dimensions ──────────────────────────────────────────────────────
// Tile index = row * PET_GRID_COLS + col. A big arena so battles are a JOURNEY
// through a maze, not a head-on clash. Everything (spawns, terrain helpers,
// renderer) derives from these two numbers so the size is a single knob.
export const PET_GRID_COLS = 28;
export const PET_GRID_ROWS = 15;
export const PET_GRID_SIZE = PET_GRID_COLS * PET_GRID_ROWS; // 420

// ── Spawn tiles (derived) ─────────────────────────────────────────────────
// Player on the left edge (col 1), enemy on the right (col COLS-2), middle row;
// the 2v2 leads/reserves split above/below. Derived so a resize never strands
// a spawn inside a wall.
const _MID = Math.floor(PET_GRID_ROWS / 2);
export const PET_SPAWN_1V1 = {
    player: _MID * PET_GRID_COLS + 1,
    enemy: _MID * PET_GRID_COLS + (PET_GRID_COLS - 2),
};
export const PET_SPAWN_2V2 = {
    playerLead: (_MID - 2) * PET_GRID_COLS + 1,
    playerReserve: (_MID + 2) * PET_GRID_COLS + 1,
    enemyLead: (_MID - 2) * PET_GRID_COLS + (PET_GRID_COLS - 2),
    enemyReserve: (_MID + 2) * PET_GRID_COLS + (PET_GRID_COLS - 2),
};
export const PET_SPAWN_TILES: ReadonlyArray<number> = [
    PET_SPAWN_1V1.player, PET_SPAWN_1V1.enemy,
    PET_SPAWN_2V2.playerLead, PET_SPAWN_2V2.playerReserve,
    PET_SPAWN_2V2.enemyLead, PET_SPAWN_2V2.enemyReserve,
];

// ── Maze layouts ──────────────────────────────────────────────────────────
// A maze the pets must navigate to reach each other. Each wall is FULL height
// with a single 2-row GAP (the only passage); the gaps are offset between walls
// so a pet has to weave. Navigable BY CONSTRUCTION: every wall has a gap, and
// the open columns between walls let a pet reposition to the next gap, so a BFS
// path always links the spawns (enforced by pet-tactics.test.ts). Walls sit in
// the central columns, clear of the spawn columns. Deterministic.
function mazeWalls(walls: ReadonlyArray<readonly [number, number]>): number[] {
    const out: number[] = [];
    for (const [col, gap] of walls) {
        for (let row = 0; row < PET_GRID_ROWS; row++) {
            if (row === gap || row === gap + 1) continue; // 2-row passage
            out.push(row * PET_GRID_COLS + col);
        }
    }
    return out;
}
// [col, gapRow] — many walls in cols 4..24 (clear of spawn cols 1 / COLS-2 = 26),
// non-adjacent so there is always open space to reposition between gaps. Dense +
// deep so the journey winds through a real maze.
export const PET_OBSTACLE_LAYOUTS: ReadonlyArray<ReadonlyArray<number>> = [
    mazeWalls([[5, 2], [8, 10], [11, 4], [14, 12], [17, 3], [20, 9], [23, 5]]),
    mazeWalls([[4, 8], [7, 1], [10, 11], [13, 4], [16, 12], [19, 6], [22, 2]]),
    mazeWalls([[6, 4], [9, 11], [12, 5], [15, 1], [18, 10], [21, 4], [24, 11]]),
    mazeWalls([[5, 12], [8, 5], [11, 11], [14, 2], [17, 8], [20, 3], [23, 10]]),
    mazeWalls([[4, 3], [8, 10], [12, 1], [16, 12], [20, 5], [24, 8]]),
    mazeWalls([[6, 9], [9, 2], [12, 11], [15, 4], [18, 12], [21, 7], [24, 3]]),
    mazeWalls([[5, 5], [9, 12], [13, 2], [17, 9], [21, 4], [24, 11]]),
    mazeWalls([[4, 11], [7, 4], [10, 12], [13, 1], [16, 9], [19, 3], [22, 10]]),
];

// ── Type-effectiveness ───────────────────────────────────────────────────
// Classic chakra rock-paper-scissors loop:
//   Fire > Wind > Lightning > Earth > Water > Fire
// Damage multipliers: super-effective 1.25×, resisted 0.80×, otherwise 1.0.
// Pets with no element (or element "None") fight neutral against everything.
export const PET_ELEMENT_BEATS: Partial<Record<JutsuElement, JutsuElement>> = {
    Fire: "Wind",
    Wind: "Lightning",
    Lightning: "Earth",
    Earth: "Water",
    Water: "Fire",
};
