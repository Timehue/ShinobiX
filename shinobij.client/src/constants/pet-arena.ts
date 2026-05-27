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
// Tile index = row * PET_GRID_COLS + col.
// Player always starts col 1 row 3 (=43), enemy col 12 row 3 (=54).
export const PET_GRID_COLS = 14;
export const PET_GRID_ROWS = 7;
export const PET_GRID_SIZE = PET_GRID_COLS * PET_GRID_ROWS; // 98

// ── Obstacle layouts ─────────────────────────────────────────────────────
// 8 hand-crafted layouts for the 14×7 arena. Picked randomly each battle.
// Row 0 is the new top-of-arena empty row (added for vertical breathing
// room); all legacy obstacle indices are shifted +14 so the layouts keep
// their old shape just one row lower visually.
export const PET_OBSTACLE_LAYOUTS: ReadonlyArray<ReadonlyArray<number>> = [
    // 0 — "Narrow Gate": centre-column wall forces pets through top/bottom passages
    [35, 49, 63, 77,  36, 50],
    // 1 — "Twin Boulders": two diagonal boulder clusters
    [33, 47, 48,  65, 79, 78],
    // 2 — "Side Walls": corner blocks funnel pets into the centre lane
    [16, 17, 30, 31,  80, 81, 94, 95],
    // 3 — "Central Rock": big impassable rock in the middle
    [48, 49, 50,  62, 63, 64],
    // 4 — "Half Walls": offset walls on each flank create asymmetric lanes
    [46, 60, 74,  37, 51, 65],
    // 5 — "Cross Bars": horizontal strips top and bottom force centre path
    [32, 33, 34, 35,  77, 78, 79, 80],
    // 6 — "Zigzag": diagonal stepping stones disrupt straight charges
    [31, 47, 63, 79,  32, 60],
    // 7 — "Fortress": enclosed square with two entry gaps on the sides
    [47, 48, 61, 62,  35, 77],
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
