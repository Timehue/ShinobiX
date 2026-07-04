// Hand-curated world-map scatter coordinates (0–100 % of the map background).
// Single source of truth for sector positions — imported by WorldMap (marker
// placement + the SectorOwnershipOverlay) and by lib/weekly-boss-roam (which
// derives sector adjacency for the roaming world boss's path).
//
// Provenance: the 60 standard sectors were de-collided (≤~5% nudge) to de-overlap
// the mobile zoom overview; fixed POIs stayed pinned. Sector 99 is the special
// lava-arena slot (not a normal overworld roam destination).
//
// Extracted verbatim from WorldMap.tsx (behavior-preserving) so the roam library
// can compute adjacency without importing a screen.

export type SectorPoint = { id: number; x: number; y: number };

export const SECTOR_POINTS: readonly SectorPoint[] = [
    { id: 1, x: 58, y: 50 }, { id: 2, x: 62, y: 37 }, { id: 3, x: 69, y: 37 }, { id: 4, x: 84, y: 58 }, { id: 5, x: 91, y: 62 },
    { id: 6, x: 91, y: 74 }, { id: 7, x: 54, y: 35 }, { id: 8, x: 84, y: 71 }, { id: 9, x: 63, y: 59 }, { id: 10, x: 66, y: 48 },
    { id: 11, x: 79, y: 79 }, { id: 12, x: 59, y: 69 }, { id: 13, x: 54, y: 85 }, { id: 14, x: 62, y: 91 }, { id: 15, x: 76, y: 58 },
    { id: 16, x: 72, y: 73 }, { id: 17, x: 70, y: 84 }, { id: 18, x: 61, y: 80 }, { id: 19, x: 69, y: 63 }, { id: 20, x: 47, y: 79 },
    { id: 21, x: 9, y: 69 }, { id: 22, x: 16, y: 64 }, { id: 23, x: 37, y: 51 }, { id: 24, x: 31, y: 73 }, { id: 25, x: 34, y: 41 },
    { id: 26, x: 7, y: 80 }, { id: 27, x: 16, y: 75 }, { id: 28, x: 30, y: 55 }, { id: 29, x: 37, y: 63 }, { id: 30, x: 43, y: 70 },
    { id: 31, x: 14, y: 86 }, { id: 32, x: 24, y: 74 }, { id: 33, x: 38, y: 80 }, { id: 34, x: 24, y: 62 }, { id: 35, x: 44, y: 91 },
    { id: 36, x: 8, y: 26 }, { id: 37, x: 15, y: 19 }, { id: 38, x: 14, y: 33 }, { id: 39, x: 24, y: 16 }, { id: 40, x: 31, y: 18 },
    { id: 41, x: 32, y: 30 }, { id: 42, x: 22, y: 27 }, { id: 43, x: 26, y: 38 }, { id: 44, x: 39, y: 33 }, { id: 45, x: 46, y: 36 },
    { id: 46, x: 92, y: 31 }, { id: 47, x: 76, y: 31 }, { id: 48, x: 77, y: 13 }, { id: 49, x: 84, y: 14 }, { id: 50, x: 80, y: 19 },
    { id: 51, x: 67, y: 26 }, { id: 52, x: 56, y: 24 }, { id: 53, x: 84, y: 34 }, { id: 54, x: 88, y: 21 }, { id: 55, x: 73, y: 47 },
    { id: 56, x: 44, y: 47 }, { id: 57, x: 54, y: 48 }, { id: 58, x: 48, y: 55 }, { id: 59, x: 55, y: 58 }, { id: 60, x: 49, y: 64 },
    { id: 99, x: 51, y: 10 },
];
