/** Shared, reciprocal overworld road topology used by client and server. */
export type SectorPoint = { id: number; x: number; y: number };
export type SectorDirection = 'north' | 'east' | 'south' | 'west';
export type SectorRoadPair = readonly [number, number];

export type SectorExit = {
    id: string;
    sector: number;
    tile: number;
    direction: SectorDirection;
    destinationSector: number;
    destinationExitId: string;
    destinationTile: number;
};

// Positions use the 2026-07 REGION-BLOCK numbering (shared/sector-geo.ts holds
// the id → place registry and the old↔new mapping).
//
// Re-tuned 2026-07-29 against the NEW 16:9 world keyart (1672×941). Every
// region was moved onto the terrain that matches its name — the harbour block
// onto the stilt piers, the deepwood onto the NW forest cliffs, the glacier
// block onto the NE snowfield, the violet block onto the SE blossom forest,
// the Midlands ring + The Gates onto the central keep and its farmland, the
// festival block onto the southern desert outpost and the Lavafront onto the
// northern ash. Region blocks were remapped as WHOLE UNITS (an affine fit of
// each region's old bounding box onto its new terrain box) so each region's
// internal topology — and therefore every derived exit direction — is
// preserved rather than reshuffled.
export const SECTOR_POINTS: readonly SectorPoint[] = [
    // Stormveil Harbor (1-8) — the SW stilt harbour
    { id: 1, x: 15, y: 82 }, { id: 2, x: 9, y: 66 }, { id: 3, x: 14, y: 63 }, { id: 4, x: 21, y: 61 },
    { id: 5, x: 28, y: 70 }, { id: 6, x: 21, y: 71 }, { id: 7, x: 6, y: 76 }, { id: 8, x: 14, y: 72 },
    // Ashen Leaf Deepwood (9-16) — the NW forest cliffs
    { id: 9, x: 13, y: 28 }, { id: 10, x: 7, y: 21 }, { id: 11, x: 14, y: 14 }, { id: 12, x: 22, y: 11 },
    { id: 13, x: 29, y: 13 }, { id: 14, x: 30, y: 25 }, { id: 15, x: 20, y: 22 }, { id: 16, x: 24, y: 33 },
    // Moonshadow Wilds (17-25) — the SE violet forest
    { id: 17, x: 85, y: 77 }, { id: 18, x: 75, y: 59 }, { id: 19, x: 82, y: 54 }, { id: 20, x: 89, y: 54 },
    { id: 21, x: 93, y: 58 }, { id: 22, x: 93, y: 70 }, { id: 23, x: 78, y: 70 }, { id: 24, x: 89, y: 68 },
    { id: 25, x: 76, y: 82 },
    // Frostfang Reach (26-33) — the NE glacier
    { id: 26, x: 76, y: 28 }, { id: 27, x: 93, y: 28 }, { id: 28, x: 77, y: 11 }, { id: 29, x: 85, y: 12 },
    { id: 30, x: 81, y: 17 }, { id: 31, x: 85, y: 31 }, { id: 32, x: 89, y: 19 }, { id: 33, x: 67, y: 23 },
    // Frost Border (34-35) — where the ice meets the green
    { id: 34, x: 73, y: 42 }, { id: 35, x: 66, y: 35 },
    // The Midlands (36-45) — the green ring around the keep
    { id: 36, x: 36, y: 26 }, { id: 37, x: 43, y: 29 }, { id: 38, x: 33, y: 36 }, { id: 39, x: 36, y: 46 },
    { id: 40, x: 28, y: 50 }, { id: 41, x: 36, y: 58 }, { id: 42, x: 43, y: 65 }, { id: 43, x: 67, y: 54 },
    { id: 44, x: 66, y: 46 }, { id: 45, x: 44, y: 74 },
    // The Castle City (46-51) — The Gates, at the map's heart
    { id: 46, x: 52, y: 36 }, { id: 47, x: 44, y: 42 }, { id: 48, x: 49, y: 50 }, { id: 49, x: 57, y: 53 },
    { id: 50, x: 50, y: 59 }, { id: 51, x: 61, y: 45 },
    // Festival Grounds (52-54) — the southern desert outpost
    { id: 52, x: 57, y: 88 }, { id: 53, x: 33, y: 80 }, { id: 54, x: 47, y: 86 },
    // The Hollow Road (55-57) — the pilgrim road past the obelisk. 57 sits
    // beside the shrine so the Hollow Gate landmark crest can own it visually.
    { id: 55, x: 59, y: 60 }, { id: 56, x: 57, y: 72 }, { id: 57, x: 67, y: 61 },
    // The Lavafront (58-60) + Death's Gate (99) — the northern ash and the cone
    { id: 58, x: 43, y: 21 }, { id: 59, x: 57, y: 26 }, { id: 60, x: 52, y: 14 },
    { id: 99, x: 47, y: 8 },
    // The 2026-07-29 expansion (61-66) — sited on the emptiest LAND on the
    // keyart (verified against the art's own pixels, so none of them sits in
    // the sea) and kept clear of the existing pins and the POI plaques.
    { id: 61, x: 16, y: 45 },   // Westfurrow Fields  — west farmland
    { id: 62, x: 10, y: 52 },   // Greycliff Landing  — west coast road
    { id: 63, x: 67, y: 92 },   // Tallgrass Bend     — south of the outpost
    { id: 64, x: 65, y: 74 },   // Lantern Vigil      — off the pilgrim road
    { id: 65, x: 92, y: 44 },   // Eastwind Cirque    — the far eastern snows
    { id: 66, x: 62, y: 8 },    // Emberspine Ridge   — deep in the ash
];

// Frozen geographic roads — the same 82 place-to-place roads as before the
// renumbering (remapped id-for-id), plus the Upper Terraces ↔ Canal Heart
// link (3-8) that closed Stormveil's one internal gap. Every walkable sector
// has 2-5 connections and the walkable graph is connected.
//
// NOTE (2026-07-29): sector 57 Hollow Temple was briefly taken off this graph
// on the assumption that it WAS the Hollow Gate POI. It isn't — the Hollow Gate
// is a landmark crest that opens the rift menu (already key-gated) and never
// travels to a sector, while 57 is an ordinary wild sector on the pilgrim road.
// Its four roads were restored.
export const SECTOR_ROAD_PAIRS: readonly SectorRoadPair[] = [
    [1, 7], [1, 8], [2, 3], [2, 8], [3, 4], [3, 8], [4, 40], [5, 6], [5, 53], [6, 8], [7, 8],
    [9, 10], [9, 15], [10, 11], [11, 12], [11, 15], [12, 13], [13, 14], [14, 15], [14, 16], [14, 36],
    [16, 38], [17, 23], [17, 24], [17, 25], [18, 19], [18, 23], [18, 43], [19, 20], [20, 21], [21, 22],
    [21, 24], [22, 24], [23, 25], [25, 52], [25, 57], [26, 31], [26, 33], [26, 35], [27, 31], [27, 32], [28, 29],
    [28, 30], [29, 30], [29, 32], [30, 32], [33, 35], [33, 60], [34, 35], [34, 44], [35, 59], [36, 37],
    [36, 38], [37, 58], [38, 39], [39, 40], [39, 47], [40, 41], [41, 42], [42, 45], [42, 50], [43, 49],
    [43, 51], [43, 55], [44, 51], [45, 53], [45, 54], [46, 47], [46, 48], [46, 51], [47, 48], [48, 49],
    [48, 50], [49, 50], [49, 51], [50, 55], [52, 56], [52, 57], [54, 56], [55, 57], [56, 57], [58, 59],
    [58, 60],
    // The 2026-07-29 expansion — each new sector joins the network by two roads
    // to its nearest established neighbours, so it is reachable on foot and has
    // the minimum degree of 2. No existing road was touched.
    [16, 61], [40, 61],   // Westfurrow Fields — the deepwood edge and the terraces
    [61, 62], [2, 62],    // Greycliff Landing — the farmland and the north docks
    [52, 63], [25, 63],   // Tallgrass Bend    — the festival basin and Fallswood
    [56, 64], [23, 64],   // Lantern Vigil     — the pilgrim road and Moongrotto
    [27, 65], [31, 65],   // Eastwind Cirque   — the glacier shelves
    [60, 66], [33, 66],   // Emberspine Ridge  — the forecourt and Cinderfrost
];

/**
 * Sectors that exist on the map but carry no roads: reachable by map travel
 * only, never by walking an edge. Death's Gate is the PvP arena.
 */
export const NON_WALKABLE_SECTORS: readonly number[] = [99];

const GRID_WIDTH = 12;
const POINT_BY_ID = new Map(SECTOR_POINTS.map((point) => [point.id, point]));

function directionFromTo(sector: number, destination: number): SectorDirection {
    const from = POINT_BY_ID.get(sector);
    const to = POINT_BY_ID.get(destination);
    if (!from || !to) return 'north';
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
    return dy >= 0 ? 'south' : 'north';
}

function laneSlots(count: number): readonly number[] {
    if (count <= 1) return [5];
    if (count === 2) return [4, 7];
    if (count === 3) return [3, 5, 7];
    return [2, 4, 7, 9];
}

function boundaryTile(direction: SectorDirection, lane: number): number {
    if (direction === 'north') return lane;
    if (direction === 'south') return (GRID_WIDTH - 1) * GRID_WIDTH + lane;
    if (direction === 'west') return lane * GRID_WIDTH;
    return lane * GRID_WIDTH + (GRID_WIDTH - 1);
}

function inwardTile(tile: number, edge: SectorDirection): number {
    if (edge === 'north') return tile + GRID_WIDTH;
    if (edge === 'south') return tile - GRID_WIDTH;
    if (edge === 'west') return tile + 1;
    return tile - 1;
}

type ExitDraft = Omit<SectorExit, 'destinationExitId' | 'destinationTile'>;

function buildSectorExits(): readonly SectorExit[] {
    const destinations = new Map<number, number[]>();
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        destinations.set(a, [...(destinations.get(a) ?? []), b]);
        destinations.set(b, [...(destinations.get(b) ?? []), a]);
    }

    const drafts: ExitDraft[] = [];
    for (const [sector, linked] of destinations) {
        const byDirection = new Map<SectorDirection, number[]>();
        for (const destination of linked) {
            const direction = directionFromTo(sector, destination);
            byDirection.set(direction, [...(byDirection.get(direction) ?? []), destination]);
        }
        for (const [direction, unsorted] of byDirection) {
            const sorted = [...unsorted].sort((a, b) => a - b);
            const lanes = laneSlots(sorted.length);
            sorted.forEach((destinationSector, index) => {
                drafts.push({
                    id: `${sector}:${direction}:${destinationSector}`,
                    sector,
                    tile: boundaryTile(direction, lanes[index] ?? 5),
                    direction,
                    destinationSector,
                });
            });
        }
    }

    const byRoute = new Map(drafts.map((exit) => [`${exit.sector}:${exit.destinationSector}`, exit]));
    return drafts
        .map((exit): SectorExit => {
            const reverse = byRoute.get(`${exit.destinationSector}:${exit.sector}`);
            if (!reverse) throw new Error(`Missing reciprocal sector road ${exit.destinationSector}->${exit.sector}`);
            return {
                ...exit,
                destinationExitId: reverse.id,
                destinationTile: inwardTile(reverse.tile, reverse.direction),
            };
        })
        .sort((a, b) => a.sector - b.sector || a.tile - b.tile || a.destinationSector - b.destinationSector);
}

export const SECTOR_EXITS: readonly SectorExit[] = buildSectorExits();

const EMPTY_EXITS: readonly SectorExit[] = Object.freeze([]);
const EXITS_BY_SECTOR = new Map<number, readonly SectorExit[]>();
const EXIT_BY_SECTOR_AND_ID = new Map<string, SectorExit>();

for (const exit of SECTOR_EXITS) {
    EXITS_BY_SECTOR.set(exit.sector, [
        ...(EXITS_BY_SECTOR.get(exit.sector) ?? EMPTY_EXITS),
        exit,
    ]);
    EXIT_BY_SECTOR_AND_ID.set(`${exit.sector}:${exit.id}`, exit);
}

export function sectorExits(sector: number): readonly SectorExit[] {
    return EXITS_BY_SECTOR.get(sector) ?? EMPTY_EXITS;
}

export function sectorExitById(sector: number, exitId: string): SectorExit | undefined {
    return EXIT_BY_SECTOR_AND_ID.get(`${sector}:${exitId}`);
}
