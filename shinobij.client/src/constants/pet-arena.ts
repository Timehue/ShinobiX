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
// Tile index = row * PET_GRID_COLS + col. A TIGHT arena (the maze pivot is dead)
// so the two pets are always in each other's faces — the anime-fight stage. The
// engine's melee/ranged bands are tuned to this 14×7. Everything (spawns, terrain
// helpers, renderer) derives from these two numbers, so size stays one knob.
export const PET_GRID_COLS = 14;
export const PET_GRID_ROWS = 7;
export const PET_GRID_SIZE = PET_GRID_COLS * PET_GRID_ROWS; // 98

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

// ── Cover layouts ─────────────────────────────────────────────────────────
// A LIGHT scatter of stone cover pillars (not a maze) — a couple of obstacles
// to fight around + slam each other into, never blocking the head-on clash.
// Central columns, clear of the spawn columns. Navigable by construction
// (sparse); pet-tactics.test.ts still proves a BFS path links every spawn pair.
export const PET_OBSTACLE_LAYOUTS: ReadonlyArray<ReadonlyArray<number>> = [
    [48, 49],               // a central pillar pair
    [34, 76],               // one high, one low (cols centred)
    [47, 50, 61, 64],       // four pillars boxing the centre
    [48, 62],               // a vertical centre pair
    [33, 38, 75, 80],       // four corners of the contested middle
    [49, 63],               // off-centre pair
    [35, 49, 63, 77],       // a short central spine
    [34, 35, 76, 77],       // a top pair + a bottom pair
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
