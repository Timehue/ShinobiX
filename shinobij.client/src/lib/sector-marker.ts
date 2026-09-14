/*
 * sector-marker — the ONE geometry every figure standing on a sector board uses.
 *
 * Four components draw a figure on the 12x12 sector grid: the player
 * (<SectorAvatar>), other players (<SectorPeers>), wandering AI
 * (<SectorWanderer>) and the weekly boss (<SectorWeeklyBossActor>). Each used
 * to carry its own hard-coded FIGURE_W/FIGURE_H pair, and they had drifted far
 * enough apart that on a phone (tile ~28px) the player's portrait was 16.3px
 * against another player's 21.2px and the boss's 25.3px — the player read as
 * the smallest real person on their own board. Peers were worse than the raw
 * numbers suggest: their size was multiplied twice (0.86 here x `width: 88%`
 * from the shared .tiny-map-avatar class), and they were anchored by their
 * MIDDLE on the tile centre while every other figure was anchored by its pin
 * TIP — so a peer standing on your tile also planted ~0.4 tiles lower than you.
 *
 * Every figure now sizes itself from these constants and anchors the same way.
 * The boss keeps a deliberate size advantage, but as an explicit multiplier of
 * the shared base (SECTOR_BOSS_SCALE) rather than a fourth set of magic numbers
 * — so "the boss looms" survives, and nothing else can drift again.
 *
 * Geometry-only: no game logic, balance, or save data.
 */

/** Circle diameter as a fraction of one grid tile. This is THE marker size. */
export const SECTOR_MARKER_W = 0.72;

/**
 * `.sector-avatar-pin` hangs 30% of the circle's diameter below the circle
 * (`bottom: -30%` in 11-sector-explore-village-themes.css). The figure box has
 * to be that much taller than the circle for the pin TIP to land exactly on the
 * box's bottom edge — which is what BASE_ANCHOR plants on the tile centre.
 */
const PIN_DROP = 0.30;

/** Figure box height as a fraction of one grid tile (circle + pin). */
export const SECTOR_MARKER_H = SECTOR_MARKER_W * (1 + PIN_DROP);

/** % down the figure box that lands on the tile centre — the pin tip. */
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

/**
 * Ring colour that says WHAT a figure is, now that size no longer can.
 *
 * With the player, other players and wandering AI all drawn at one size, bulk
 * stopped being an identity cue — so identity moved to the ring, which is the
 * cue that stays legible at a 20px disc on a phone. Peers used to be told apart
 * by a red `outline` + glow bolted on outside their border box, which both read
 * as "hostile" (standing near someone is not an attack — attacking is a
 * deliberate action in the Players Here panel) and made them paint 1.55x the
 * player's footprint. A ring COLOUR costs no extra pixels.
 */
export const SECTOR_RING_SELF = "rgba(250, 204, 21, 0.95)";   // gold — matches your gold tile
export const SECTOR_RING_PEER = "rgba(125, 211, 252, 0.95)";  // sky — another real person
export const SECTOR_RING_AI = "rgba(255, 255, 255, 0.9)";     // white — the default; AI adds its own tell ring
