"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTOR_EXITS = exports.SECTOR_ROAD_PAIRS = exports.SECTOR_POINTS = void 0;
exports.sectorExits = sectorExits;
exports.sectorExitById = sectorExitById;
exports.SECTOR_POINTS = [
    { id: 1, x: 58, y: 50 }, { id: 2, x: 62, y: 37 }, { id: 3, x: 69, y: 37 }, { id: 4, x: 84, y: 58 }, { id: 5, x: 91, y: 62 },
    { id: 6, x: 91, y: 74 }, { id: 7, x: 54, y: 35 }, { id: 8, x: 84, y: 71 }, { id: 9, x: 63, y: 59 }, { id: 10, x: 66, y: 48 },
    { id: 11, x: 79, y: 79 }, { id: 12, x: 59, y: 69 }, { id: 13, x: 54, y: 85 }, { id: 14, x: 62, y: 91 }, { id: 15, x: 76, y: 58 },
    { id: 16, x: 72, y: 73 }, { id: 17, x: 70, y: 84 }, { id: 18, x: 61, y: 80 }, { id: 19, x: 69, y: 63 }, { id: 20, x: 44, y: 79 },
    { id: 21, x: 9, y: 69 }, { id: 22, x: 16, y: 64 }, { id: 23, x: 37, y: 51 }, { id: 24, x: 31, y: 73 }, { id: 25, x: 34, y: 41 },
    { id: 26, x: 7, y: 80 }, { id: 27, x: 16, y: 75 }, { id: 28, x: 30, y: 55 }, { id: 29, x: 37, y: 63 }, { id: 30, x: 43, y: 70 },
    { id: 31, x: 14, y: 89 }, { id: 32, x: 24, y: 74 }, { id: 33, x: 38, y: 80 }, { id: 34, x: 24, y: 62 }, { id: 35, x: 44, y: 91 },
    { id: 36, x: 8, y: 26 }, { id: 37, x: 15, y: 19 }, { id: 38, x: 14, y: 33 }, { id: 39, x: 24, y: 16 }, { id: 40, x: 31, y: 18 },
    { id: 41, x: 32, y: 30 }, { id: 42, x: 22, y: 27 }, { id: 43, x: 26, y: 38 }, { id: 44, x: 39, y: 33 }, { id: 45, x: 46, y: 36 },
    { id: 46, x: 92, y: 31 }, { id: 47, x: 76, y: 31 }, { id: 48, x: 77, y: 13 }, { id: 49, x: 84, y: 14 }, { id: 50, x: 80, y: 19 },
    { id: 51, x: 67, y: 26 }, { id: 52, x: 56, y: 24 }, { id: 53, x: 84, y: 34 }, { id: 54, x: 88, y: 21 }, { id: 55, x: 73, y: 47 },
    { id: 56, x: 44, y: 47 }, { id: 57, x: 54, y: 48 }, { id: 58, x: 48, y: 55 }, { id: 59, x: 55, y: 58 }, { id: 60, x: 49, y: 64 },
    { id: 99, x: 51, y: 10 },
];
// Frozen geographic roads. Every standard sector has 2-4 connections, the
// graph is connected, and special Sector 99 stays map-travel-only.
exports.SECTOR_ROAD_PAIRS = [
    [1, 9], [1, 10], [1, 57], [1, 59], [2, 3], [2, 7], [3, 47], [3, 51], [3, 55], [4, 5], [4, 15],
    [5, 6], [5, 8], [6, 8], [7, 45], [7, 52], [8, 11], [9, 12], [9, 19], [9, 59], [10, 55], [11, 16],
    [11, 17], [12, 18], [12, 60], [13, 14], [13, 18], [13, 35], [14, 17], [14, 18], [15, 19], [16, 17],
    [16, 19], [17, 18], [20, 30], [20, 33], [20, 35], [21, 22], [21, 27], [22, 34], [23, 25], [23, 28],
    [23, 56], [24, 32], [24, 33], [25, 43], [25, 44], [26, 27], [26, 31], [27, 31], [27, 32], [28, 29],
    [28, 34], [29, 30], [30, 60], [36, 37], [36, 38], [37, 39], [37, 42], [38, 42], [39, 40], [40, 41],
    [41, 42], [41, 43], [41, 44], [44, 45], [46, 53], [46, 54], [47, 51], [47, 53], [48, 49], [48, 50],
    [49, 50], [49, 54], [50, 54], [51, 52], [56, 57], [56, 58], [57, 58], [58, 59], [58, 60], [59, 60],
];
const GRID_WIDTH = 12;
const POINT_BY_ID = new Map(exports.SECTOR_POINTS.map((point) => [point.id, point]));
function directionFromTo(sector, destination) {
    const from = POINT_BY_ID.get(sector);
    const to = POINT_BY_ID.get(destination);
    if (!from || !to)
        return 'north';
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy))
        return dx >= 0 ? 'east' : 'west';
    return dy >= 0 ? 'south' : 'north';
}
function laneSlots(count) {
    if (count <= 1)
        return [5];
    if (count === 2)
        return [4, 7];
    if (count === 3)
        return [3, 5, 7];
    return [2, 4, 7, 9];
}
function boundaryTile(direction, lane) {
    if (direction === 'north')
        return lane;
    if (direction === 'south')
        return (GRID_WIDTH - 1) * GRID_WIDTH + lane;
    if (direction === 'west')
        return lane * GRID_WIDTH;
    return lane * GRID_WIDTH + (GRID_WIDTH - 1);
}
function inwardTile(tile, edge) {
    if (edge === 'north')
        return tile + GRID_WIDTH;
    if (edge === 'south')
        return tile - GRID_WIDTH;
    if (edge === 'west')
        return tile + 1;
    return tile - 1;
}
function buildSectorExits() {
    const destinations = new Map();
    for (const [a, b] of exports.SECTOR_ROAD_PAIRS) {
        destinations.set(a, [...(destinations.get(a) ?? []), b]);
        destinations.set(b, [...(destinations.get(b) ?? []), a]);
    }
    const drafts = [];
    for (const [sector, linked] of destinations) {
        const byDirection = new Map();
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
        .map((exit) => {
        const reverse = byRoute.get(`${exit.destinationSector}:${exit.sector}`);
        if (!reverse)
            throw new Error(`Missing reciprocal sector road ${exit.destinationSector}->${exit.sector}`);
        return {
            ...exit,
            destinationExitId: reverse.id,
            destinationTile: inwardTile(reverse.tile, reverse.direction),
        };
    })
        .sort((a, b) => a.sector - b.sector || a.tile - b.tile || a.destinationSector - b.destinationSector);
}
exports.SECTOR_EXITS = buildSectorExits();
const EMPTY_EXITS = Object.freeze([]);
const EXITS_BY_SECTOR = new Map();
const EXIT_BY_SECTOR_AND_ID = new Map();
for (const exit of exports.SECTOR_EXITS) {
    EXITS_BY_SECTOR.set(exit.sector, [
        ...(EXITS_BY_SECTOR.get(exit.sector) ?? EMPTY_EXITS),
        exit,
    ]);
    EXIT_BY_SECTOR_AND_ID.set(`${exit.sector}:${exit.id}`, exit);
}
function sectorExits(sector) {
    return EXITS_BY_SECTOR.get(sector) ?? EMPTY_EXITS;
}
function sectorExitById(sector, exitId) {
    return EXIT_BY_SECTOR_AND_ID.get(`${sector}:${exitId}`);
}
