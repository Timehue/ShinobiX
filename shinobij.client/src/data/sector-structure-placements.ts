/*
 * Where the Rift aperture and the Sector Stronghold stand on each sector board.
 *
 * Both used to share ONE fixed position across every sector. That was invisible
 * while they were UI cards and obvious once they became structures standing on the
 * terrain: the same spot put the stronghold on painted rooftops in some sectors and
 * in water in others. Shrines never had this problem because shared/shrines.ts gives
 * each one its own place, tuned to its sector's art; these two now work the same way.
 *
 * Keyed by artKey, NOT by sector number. The ground a marker stands on belongs to
 * the PAINTING (public/sector-map/s<artKey>.webp), and sectors have been renumbered
 * once already (2026-07) with every picture kept in place — keyed by art, a future
 * renumbering cannot silently put every marker on the wrong ground. The trailing
 * comment names the sector that shows that painting today.
 *
 * Each point is the marker's BASE, in percent of the board: where the building's
 * footing, or the lower half of the rift's aperture, meets the ground. How they were
 * chosen (2026-09-10): a script scored every painting for open ground (low texture,
 * not water or lava, in the foreground band) and proposed a spot; every one was then
 * checked by eye on contact sheets compositing the real marker art at its real
 * scale, and about a third were corrected by hand — the scorer reads a painted path
 * as open ground and misses a smooth dark wall. sector-structure-placements.test.ts
 * holds every entry to the rules that matter mechanically: inside the board, off
 * every road-exit gate and arrival tile, off the shrine, and — in the sectors where
 * both can appear at once — off each other.
 */
import { sectorArtKey } from "../../../shared/sector-geo";

/** A marker's base point, in percent of the sector board. */
export type BoardPoint = Readonly<{ left: number; top: number }>;

/** Where the Sector Stronghold stands. Covers all 32 village home sectors — war and
 *  capture only ever apply there (isWarSector), so a capture changes WHO owns a
 *  sector, never which sectors can host one. */
export const STRONGHOLD_BY_ART: Readonly<Record<number, BoardPoint>> = {
    31: { left: 24, top: 65 }, // s1 Harbor Gates
    21: { left: 42, top: 58 }, // s2 North Docks
    22: { left: 67, top: 71 }, // s3 Upper Terraces
    34: { left: 60, top: 40 }, // s4 Clocktower Hill
    24: { left: 28, top: 86 }, // s5 Reedmarsh Boardwalk
    32: { left: 36, top: 90 }, // s6 Eastern Stilts
    26: { left: 60, top: 76 }, // s7 Western Piers
    27: { left: 74, top: 74 }, // s8 Canal Heart
    38: { left: 54, top: 82 }, // s9 Ashen Leaf Gates
    36: { left: 28, top: 78 }, // s10 Cliffside Deepwood
    37: { left: 74, top: 86 }, // s11 Blossom Grove
    39: { left: 22, top: 84 }, // s12 Canopy Heights
    40: { left: 78, top: 86 }, // s13 Headland Woods
    41: { left: 84, top: 74 }, // s14 Gorgeview Plateau
    42: { left: 26, top: 72 }, // s15 Heartwood Shrine
    43: { left: 78, top: 66 }, // s16 Fern Terraces
    11: { left: 78, top: 76 }, // s17 Moonshadow Gates
    19: { left: 14, top: 66 }, // s18 Jade River Bridge
    15: { left: 86, top: 76 }, // s19 Western Eaves
     4: { left: 82, top: 74 }, // s20 Amethyst Canopy
     5: { left: 86, top: 86 }, // s21 Moonstone Rise
     6: { left: 74, top: 88 }, // s22 Moonlit Cove Cliffs
    16: { left: 18, top: 78 }, // s23 Moongrotto
     8: { left: 64, top: 48 }, // s24 Crystal Plaza
    47: { left: 54, top: 64 }, // s26 Frostfang Gates
    46: { left: 80, top: 76 }, // s27 Far Glacier Shelf
    48: { left: 40, top: 56 }, // s28 Needle Spires
    49: { left: 48, top: 68 }, // s29 Highpass Peaks
    50: { left: 34, top: 80 }, // s30 Glacier Terraces
    53: { left: 46, top: 44 }, // s31 Shrinefall Shelf
    54: { left: 38, top: 68 }, // s32 Knife-Edge Summit
    51: { left: 14, top: 70 }, // s33 Cinderfrost Divide
};

/** Where a Hollow Rift opens. Covers every sector riftTargetSector can return (wild
 *  sectors 1..MAX_WILD_SECTOR except the outskirts gates and the castle) AND the five
 *  only a pre-renumbering save can reach: before 2026-07-29 riftTargetSector drew
 *  from 1..55 without skipping the outskirts, and api/sector/_rift-quest.ts remaps
 *  such a quest when it is read — which can land it on an outskirts gate or the
 *  castle. Those rows are marked, and are the only ones no new quest can reach. */
export const RIFT_BY_ART: Readonly<Record<number, BoardPoint>> = {
    31: { left: 44, top: 52 }, // s1 Harbor Gates (pre-renumbering saves only)
    21: { left: 60, top: 50 }, // s2 North Docks
    22: { left: 30, top: 66 }, // s3 Upper Terraces
    34: { left: 52, top: 58 }, // s4 Clocktower Hill
    24: { left: 44, top: 62 }, // s5 Reedmarsh Boardwalk
    32: { left: 66, top: 44 }, // s6 Eastern Stilts
    26: { left: 38, top: 62 }, // s7 Western Piers
    27: { left: 64, top: 52 }, // s8 Canal Heart
    38: { left: 34, top: 62 }, // s9 Ashen Leaf Gates (pre-renumbering saves only)
    36: { left: 26, top: 56 }, // s10 Cliffside Deepwood
    37: { left: 14, top: 72 }, // s11 Blossom Grove
    39: { left: 72, top: 80 }, // s12 Canopy Heights
    40: { left: 60, top: 64 }, // s13 Headland Woods
    41: { left: 56, top: 60 }, // s14 Gorgeview Plateau
    42: { left: 70, top: 70 }, // s15 Heartwood Shrine
    43: { left: 48, top: 66 }, // s16 Fern Terraces
    11: { left: 52, top: 58 }, // s17 Moonshadow Gates (pre-renumbering saves only)
    19: { left: 82, top: 62 }, // s18 Jade River Bridge
    15: { left: 14, top: 86 }, // s19 Western Eaves
     4: { left: 42, top: 86 }, // s20 Amethyst Canopy
     5: { left: 74, top: 54 }, // s21 Moonstone Rise
     6: { left: 34, top: 82 }, // s22 Moonlit Cove Cliffs
    16: { left: 86, top: 62 }, // s23 Moongrotto
     8: { left: 86, top: 76 }, // s24 Crystal Plaza
    17: { left: 34, top: 72 }, // s25 Fallswood
    47: { left: 42, top: 84 }, // s26 Frostfang Gates (pre-renumbering saves only)
    46: { left: 38, top: 66 }, // s27 Far Glacier Shelf
    48: { left: 78, top: 74 }, // s28 Needle Spires
    49: { left: 66, top: 84 }, // s29 Highpass Peaks
    50: { left: 64, top: 55 }, // s30 Glacier Terraces
    53: { left: 84, top: 72 }, // s31 Shrinefall Shelf
    54: { left: 50, top: 46 }, // s32 Knife-Edge Summit
    51: { left: 72, top: 88 }, // s33 Cinderfrost Divide
    55: { left: 22, top: 88 }, // s34 Icefall Cliffs
     3: { left: 52, top: 84 }, // s35 Glacier Bridge
    44: { left: 62, top: 64 }, // s36 North Reach
    45: { left: 60, top: 80 }, // s37 Crossway Hills
    25: { left: 76, top: 64 }, // s38 Great Bridge Gorge
    23: { left: 36, top: 86 }, // s39 Falls Overlook
    28: { left: 58, top: 76 }, // s40 Goatstone Terraces
    29: { left: 86, top: 86 }, // s41 Milestone Vale
    30: { left: 34, top: 74 }, // s42 Teahouse Fields
     9: { left: 54, top: 62 }, // s43 Windmill Fields
    10: { left: 34, top: 78 }, // s44 Watchruin Ridge
    20: { left: 22, top: 74 }, // s45 Southern Crossroads
     1: { left: 52, top: 74 }, // s51 East Ring Road (pre-renumbering saves only)
    14: { left: 52, top: 70 }, // s52 Festival Grounds
    33: { left: 58, top: 86 }, // s53 Boardwalk Scrub
    35: { left: 64, top: 66 }, // s54 Cactus Flats
    12: { left: 14, top: 78 }, // s55 Waymarker Road
    13: { left: 16, top: 86 }, // s56 Lantern Approach
    18: { left: 86, top: 82 }, // s57 Hollow Temple
     7: { left: 14, top: 58 }, // s58 Cinder Foothills
     2: { left: 86, top: 74 }, // s59 Northroad Saddle
    52: { left: 66, top: 66 }, // s60 Obsidian Forecourt
    61: { left: 76, top: 68 }, // s61 Westfurrow Fields
    62: { left: 84, top: 68 }, // s62 Greycliff Landing
    63: { left: 72, top: 62 }, // s63 Tallgrass Bend
    64: { left: 86, top: 64 }, // s64 Lantern Vigil
    65: { left: 30, top: 54 }, // s65 Eastwind Cirque
    66: { left: 84, top: 54 }, // s66 Emberspine Ridge
};

// Only reachable for a sector outside both domains above, which the tests forbid for
// every sector either marker can appear in today. Kept so an unforeseen sector still
// draws its marker somewhere sensible rather than not at all.
const FALLBACK_STRONGHOLD: BoardPoint = { left: 64, top: 70 };
const FALLBACK_RIFT: BoardPoint = { left: 34, top: 76 };

export function strongholdPlacement(sector: number): BoardPoint {
    return STRONGHOLD_BY_ART[sectorArtKey(sector)] ?? FALLBACK_STRONGHOLD;
}

export function riftPlacement(sector: number): BoardPoint {
    return RIFT_BY_ART[sectorArtKey(sector)] ?? FALLBACK_RIFT;
}
