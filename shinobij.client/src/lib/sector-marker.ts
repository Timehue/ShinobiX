/** Shared width in tiles for players and other actors on a sector board. */
export const SECTOR_MARKER_W = 0.72;

/** Standing figures share one footprint, with their feet at the tile centre. */
export const SECTOR_MARKER_H = SECTOR_MARKER_W * 1.30;
export const SECTOR_MARKER_ANCHOR = 100;

/** The weekly boss looms over everyone else. Intentional, and the ONLY exception. */
export const SECTOR_BOSS_SCALE = 1.5;

/**
 * Pixel size of a figure box for a given tile size. `scale` is for the boss;
 * every other actor leaves it at 1 so they come out identical by construction.
 */
export function sectorMarkerBox(tilePx: number, scale = 1): { w: number; h: number } {
    const t = Math.max(0, tilePx);
    return { w: t * SECTOR_MARKER_W * scale, h: t * SECTOR_MARKER_H * scale };
}

/** Identity colours for sector figures and their labels. */
export const SECTOR_RING_SELF = "rgba(230, 196, 119, 0.95)";   // gold — matches your gold tile
export const SECTOR_RING_PEER = "rgba(125, 211, 252, 0.95)";  // sky — another real person
export const SECTOR_RING_AI = "rgba(255, 255, 255, 0.9)";     // white — the default; AI adds its own tell ring
