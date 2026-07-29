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
// the id → place registry and the old↔new mapping). Coordinates are unchanged
// per PLACE — they were tuned against the painted world map and stay valid.
export const SECTOR_POINTS: readonly SectorPoint[] = [
    // Stormveil Harbor (1-8)
    { id: 1, x: 14, y: 89 }, { id: 2, x: 9, y: 69 }, { id: 3, x: 16, y: 64 }, { id: 4, x: 24, y: 62 },
    { id: 5, x: 31, y: 73 }, { id: 6, x: 24, y: 74 }, { id: 7, x: 7, y: 80 }, { id: 8, x: 16, y: 75 },
    // Ashen Leaf Deepwood (9-16)
    { id: 9, x: 14, y: 33 }, { id: 10, x: 8, y: 26 }, { id: 11, x: 15, y: 19 }, { id: 12, x: 24, y: 16 },
    { id: 13, x: 31, y: 18 }, { id: 14, x: 32, y: 30 }, { id: 15, x: 22, y: 27 }, { id: 16, x: 26, y: 38 },
    // Moonshadow Wilds (17-25)
    { id: 17, x: 79, y: 79 }, { id: 18, x: 69, y: 63 }, { id: 19, x: 76, y: 58 }, { id: 20, x: 84, y: 58 },
    { id: 21, x: 91, y: 62 }, { id: 22, x: 91, y: 74 }, { id: 23, x: 72, y: 73 }, { id: 24, x: 84, y: 71 },
    { id: 25, x: 70, y: 84 },
    // Frostfang Reach (26-33)
    { id: 26, x: 76, y: 31 }, { id: 27, x: 92, y: 31 }, { id: 28, x: 77, y: 13 }, { id: 29, x: 84, y: 14 },
    { id: 30, x: 80, y: 19 }, { id: 31, x: 84, y: 34 }, { id: 32, x: 88, y: 21 }, { id: 33, x: 67, y: 26 },
    // Frost Border (34-35)
    { id: 34, x: 73, y: 47 }, { id: 35, x: 69, y: 37 },
    // The Midlands (36-45)
    { id: 36, x: 39, y: 33 }, { id: 37, x: 46, y: 36 }, { id: 38, x: 34, y: 41 }, { id: 39, x: 37, y: 51 },
    { id: 40, x: 30, y: 55 }, { id: 41, x: 37, y: 63 }, { id: 42, x: 43, y: 70 }, { id: 43, x: 63, y: 59 },
    { id: 44, x: 66, y: 48 }, { id: 45, x: 44, y: 79 },
    // The Castle City (46-51)
    { id: 46, x: 54, y: 48 }, { id: 47, x: 44, y: 47 }, { id: 48, x: 48, y: 55 }, { id: 49, x: 55, y: 58 },
    { id: 50, x: 49, y: 64 }, { id: 51, x: 58, y: 50 },
    // Festival Grounds (52-54)
    { id: 52, x: 62, y: 91 }, { id: 53, x: 38, y: 80 }, { id: 54, x: 44, y: 91 },
    // The Hollow Road (55-57)
    { id: 55, x: 59, y: 69 }, { id: 56, x: 54, y: 85 }, { id: 57, x: 61, y: 80 },
    // The Lavafront (58-60) + Death's Gate (99). 58 sits on the ash edge just
    // north of the castle roofline in the 2026-07 keyart (same exit directions).
    { id: 58, x: 53, y: 30 }, { id: 59, x: 62, y: 37 }, { id: 60, x: 56, y: 24 },
    { id: 99, x: 51, y: 10 },
];

// Frozen geographic roads — the same 82 place-to-place roads as before the
// renumbering (remapped id-for-id), plus the Upper Terraces ↔ Canal Heart
// link (3-8) that closed Stormveil's one internal gap. Every standard sector
// has 2-5 connections, the graph is connected, and special Sector 99 stays
// map-travel-only.
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
];

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
