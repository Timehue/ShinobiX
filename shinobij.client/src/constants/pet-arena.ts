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
// 8 hand-designed tactical battlefields for the 14×7 arena (tile = row*14+col),
// picked by one seeded roll each battle. Each is a DELIBERATE composition —
// central keeps, paired chokepoints, flank cover, staggered stepping-stones —
// so the fight reads as a designed map, not scattered blocks. Centre-column
// obstacles (cols 5–8) become COVER, the rest BLOCKED (see buildArenaTiles).
//
// Invariants (enforced by pet-tactics.test.ts so a redesign can't ship a broken
// map): never occupy a spawn tile (1v1 43/54, 2v2 29/57/40/68); rows 0 and 6
// and the spawn columns (0–2 / 11–13) stay clear so a clean lane always links
// the two sides; a BFS path always exists between every spawn pair.
export const PET_OBSTACLE_LAYOUTS: ReadonlyArray<ReadonlyArray<number>> = [
    // 0 — "Fortress Core": a central 2×2 keep ringed by four flank pillars
    [48, 49, 62, 63,  32, 37, 74, 79],
    // 1 — "Twin Gates": two vertical wall segments → left/right chokepoints
    [33, 47, 61,  36, 50, 64],
    // 2 — "Central Spire": a solid centre wall; pets sweep around top or bottom
    [34, 35, 48, 49, 62, 63, 76, 77],
    // 3 — "Stepping Stones": an X of staggered cover that breaks straight charges
    [33, 48, 63, 78,  36, 49, 62, 75],
    // 4 — "Side Bastions": tall flank cover funnels into a guarded centre
    [31, 45, 59,  38, 52, 66,  48, 63],
    // 5 — "Pillared Hall": four spaced pillars + a centre pair (clean cover lanes)
    [33, 36, 75, 78,  49, 62],
    // 6 — "Chokepoint Bridge": top/bottom walls force a central corridor crossing
    [32, 33, 36, 37,  74, 75, 78, 79],
    // 7 — "Broken Lanes": offset half-walls carve asymmetric top/bottom routes
    [33, 34, 35,  63, 64, 65],
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
