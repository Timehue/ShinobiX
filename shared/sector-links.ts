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
//
// Label-clearance nudge, 2026-07-30: pins 1, 9, 24, 26, 54, 60 and 64 sit
// directly under a landmark crest, which is exactly where WorldPoiPlates now
// draws that landmark's name plate, so each pin was clipping a plate. (60 blocked
// the WHOLE column under Death's Gate — note 99 renders at 36px, not the usual
// 28px, so its plate needs more clearance than the rest.) They were moved
// 7-25px — the smallest offset that clears the plate — under three constraints,
// all of which MUST hold for any future nudge here:
//   1. every derived exit direction is unchanged (buildSectorExits below reads
//      these coordinates, and an exit's id embeds its direction, so a flip
//      rewires travel and can orphan a persisted exit id);
//   2. the new spot is not in the sea (checked against the keyart's own pixels);
//   3. no pin lands within ~58px of another.
// Nothing else about the topology moved: SECTOR_ROAD_PAIRS is untouched.
export const SECTOR_POINTS: readonly SectorPoint[] = [
    // Stormveil Harbor (1-8) — the SW stilt harbour
    { id: 1, x: 15, y: 83.5 }, { id: 2, x: 9, y: 66 }, { id: 3, x: 14, y: 63 }, { id: 4, x: 21, y: 61 },
    { id: 5, x: 28, y: 70 }, { id: 6, x: 21, y: 71 }, { id: 7, x: 6, y: 76 }, { id: 8, x: 14, y: 72 },
    // Ashen Leaf Deepwood (9-16) — the NW forest cliffs
    { id: 9, x: 11.5, y: 30.5 }, { id: 10, x: 7, y: 21 }, { id: 11, x: 14, y: 14 }, { id: 12, x: 22, y: 11 },
    { id: 13, x: 29, y: 13 }, { id: 14, x: 30, y: 25 }, { id: 15, x: 20, y: 22 }, { id: 16, x: 24, y: 33 },
    // Moonshadow Wilds (17-25) — the SE violet forest
    { id: 17, x: 85, y: 77 }, { id: 18, x: 75, y: 59 }, { id: 19, x: 82, y: 54 }, { id: 20, x: 89, y: 54 },
    { id: 21, x: 93, y: 58 }, { id: 22, x: 93, y: 70 }, { id: 23, x: 78, y: 70 }, { id: 24, x: 88.5, y: 66 },
    { id: 25, x: 76, y: 82 },
    // Frostfang Reach (26-33) — the NE glacier
    { id: 26, x: 76, y: 30.5 }, { id: 27, x: 93, y: 28 }, { id: 28, x: 77, y: 11 }, { id: 29, x: 85, y: 12 },
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
    { id: 52, x: 57, y: 88 }, { id: 53, x: 33, y: 80 }, { id: 54, x: 47, y: 84.5 },
    // The Hollow Road (55-57) — the pilgrim road past the obelisk. 57 sits
    // beside the shrine so the Hollow Gate landmark crest can own it visually.
    { id: 55, x: 59, y: 60 }, { id: 56, x: 57, y: 72 }, { id: 57, x: 67, y: 61 },
    // The Lavafront (58-60) + Death's Gate (99) — the northern ash and the cone
    { id: 58, x: 43, y: 21 }, { id: 59, x: 57, y: 26 }, { id: 60, x: 53, y: 14 },
    { id: 99, x: 47, y: 8 },
    // The 2026-07-29 expansion (61-66) — sited on the emptiest LAND on the
    // keyart (verified against the art's own pixels, so none of them sits in
    // the sea) and kept clear of the existing pins and the POI plaques.
    { id: 61, x: 16, y: 45 },   // Westfurrow Fields  — west farmland
    { id: 62, x: 10, y: 52 },   // Greycliff Landing  — west coast road
    { id: 63, x: 67, y: 92 },   // Tallgrass Bend     — south of the outpost
    { id: 64, x: 65, y: 75 },   // Lantern Vigil      — off the pilgrim road
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

/**
 * Lane preference order for road exits, centre-out.
 *
 * A lane is the cross-axis coordinate of a boundary tile: the COLUMN for a
 * north/south exit, the ROW for an east/west one (see boundaryTile). Both ends
 * of a road are given the SAME lane so a crossing preserves it — see
 * assignRoadLanes.
 *
 * Lanes 0 and 11 are deliberately absent. boundaryTile maps them onto the board
 * CORNERS, where two different directions resolve to the same tile — north lane
 * 0 and west lane 0 are both tile 0, south lane 11 and east lane 11 are both
 * tile 143 — which would collide two of a sector's exits onto one tile.
 */
const LANE_PREFERENCE: readonly number[] = [5, 4, 7, 3, 8, 2, 9, 6, 1, 10];

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

/**
 * How far inside the destination board a crossing lands, counted in tiles from
 * the boundary lane the player steps through.
 *
 * ⚖ OWNER RULING (2026-07-30): the player APPEARS here and does not move again.
 * A depth of 3 was tried together with an animated per-tile walk-in, on the
 * theory that watching the avatar enter would stop the crossing reading as a
 * teleport. It did the opposite: the game marched the avatar three tiles across
 * the new sector on its own, which reads as the character wandering off under
 * someone else's control. Arriving on the correct side was never the problem —
 * that already worked — so the arrival is one tile in from the seam and every
 * step after it belongs to the player.
 *
 * Keep this >= 1 (landing ON the seam tile would sit the player on top of the
 * gate marker) and small enough that DEPTH steps from any edge stay on the
 * board (GRID_WIDTH is 12, so anything up to 11 is safe).
 */
export const WALK_IN_DEPTH = 1;

/** `inwardTile` applied `steps` times, stopping early at the far edge. */
function inwardTiles(tile: number, edge: SectorDirection, steps: number): number {
    let out = tile;
    for (let i = 0; i < steps; i++) {
        const next = inwardTile(out, edge);
        if (next < 0 || next >= GRID_WIDTH * GRID_WIDTH) break;
        // East/west steps must not wrap onto the neighbouring row.
        if ((edge === 'east' || edge === 'west') && Math.floor(next / GRID_WIDTH) !== Math.floor(out / GRID_WIDTH)) break;
        out = next;
    }
    return out;
}

type ExitDraft = Omit<SectorExit, 'destinationExitId' | 'destinationTile'>;

/** Every road once, canonically ordered, so lane assignment is deterministic. */
function canonicalRoads(): readonly [number, number][] {
    const seen = new Set<string>();
    const roads: [number, number][] = [];
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const key = `${low}-${high}`;
        if (seen.has(key)) continue;
        seen.add(key);
        roads.push([low, high]);
    }
    return roads.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/**
 * Gives both ends of each road the SAME lane, so walking across a seam keeps
 * your lane instead of sliding you sideways.
 *
 * Lanes used to be handed out per (sector, edge): a road's lane at one end was
 * its rank among that sector's exits in that direction, and its lane at the
 * other end was an independent rank in the opposite direction. The two rarely
 * agreed, so a south crossing could leave column 5 and arrive at column 4, and a
 * west crossing could leave row 5 and arrive at row 4. Because boundaryTile uses
 * `lane` as the cross-axis coordinate for every direction, one shared lane per
 * road preserves the column on a north/south crossing and the row on an
 * east/west one.
 *
 * Assignment is first-fit over LANE_PREFERENCE against the lanes already taken
 * on BOTH of the road's edges. A sector has at most 5 exits, so the two edges
 * can hold at most 8 taken lanes between them and there is always one of the 10
 * candidates free.
 */
function assignRoadLanes(): Map<string, number> {
    const takenByEdge = new Map<string, Set<number>>();
    const edgeLanes = (sector: number, direction: SectorDirection): Set<number> => {
        const key = `${sector}:${direction}`;
        const existing = takenByEdge.get(key);
        if (existing) return existing;
        const fresh = new Set<number>();
        takenByEdge.set(key, fresh);
        return fresh;
    };

    const lanes = new Map<string, number>();
    for (const [a, b] of canonicalRoads()) {
        const takenAtA = edgeLanes(a, directionFromTo(a, b));
        const takenAtB = edgeLanes(b, directionFromTo(b, a));
        const lane = LANE_PREFERENCE.find((candidate) => !takenAtA.has(candidate) && !takenAtB.has(candidate));
        if (lane === undefined) throw new Error(`No lane left for both ends of road ${a}-${b}`);
        takenAtA.add(lane);
        takenAtB.add(lane);
        lanes.set(`${a}-${b}`, lane);
    }
    return lanes;
}

function buildSectorExits(): readonly SectorExit[] {
    const roadLanes = assignRoadLanes();
    const laneForRoad = (a: number, b: number): number => {
        const lane = roadLanes.get(`${Math.min(a, b)}-${Math.max(a, b)}`);
        if (lane === undefined) throw new Error(`Road ${a}-${b} was never assigned a lane`);
        return lane;
    };

    const drafts: ExitDraft[] = [];
    for (const [a, b] of canonicalRoads()) {
        const lane = laneForRoad(a, b);
        for (const [sector, destination] of [[a, b], [b, a]] as const) {
            const direction = directionFromTo(sector, destination);
            drafts.push({
                id: `${sector}:${direction}:${destination}`,
                sector,
                tile: boundaryTile(direction, lane),
                direction,
                destinationSector: destination,
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
                destinationTile: inwardTiles(reverse.tile, reverse.direction, WALK_IN_DEPTH),
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
