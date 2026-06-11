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
export const PET_GRID_COLS = 20;
export const PET_GRID_ROWS = 11;
export const PET_GRID_SIZE = PET_GRID_COLS * PET_GRID_ROWS; // 220

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
// [col, gapRow] — cols within 4..16 (clear of spawn cols 1 / COLS-2 = 18),
// non-adjacent so there is always open space to reposition between gaps.
export const PET_OBSTACLE_LAYOUTS: ReadonlyArray<ReadonlyArray<number>> = [
    mazeWalls([[6, 2], [11, 7], [15, 3]]),
    mazeWalls([[5, 6], [9, 1], [13, 7], [16, 3]]),
    mazeWalls([[7, 4], [12, 7]]),
    mazeWalls([[5, 1], [8, 7], [11, 2], [14, 8]]),
    mazeWalls([[6, 7], [10, 2], [14, 6]]),
    mazeWalls([[4, 3], [8, 8], [12, 1], [16, 6]]),
    mazeWalls([[7, 8], [11, 3], [15, 7]]),
    mazeWalls([[5, 4], [9, 8], [13, 2], [16, 7]]),
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
