/** Painted restorations for ruined sector buildings.
 *
 * While a ruin stands restored (see readSharedBuilding), its painting replaces
 * the ruin in the sector floor: the plot is cleared to the sector's own ground,
 * the intact building stands on the ruin's main solid block, and every other
 * solid tile of that ruin gets a tidy intact feature, so no tile looks walkable
 * while the walk mask still blocks it. Pieces sit only on solid tiles; cleared
 * ground never covers a road. Coordinates are pixels on the 1024px floor.
 *
 * `scripts/bake-ruin-restorations.mjs` builds each painting from these specs;
 * the client draws it into the floor at `restorationArtBounds`. */
export type RuinPiece = { source: string; tile: readonly [col: number, row: number, cols: number, rows: number] };
export type RuinRestoration = {
    buildingId: string; artKey: number;
    /** Debris cleared to plain ground, [x0, y0, x1, y1]. */
    clear: readonly (readonly [number, number, number, number])[];
    /** An untouched patch of the same floor that supplies the cleared ground. */
    ground: readonly [number, number, number, number];
    pieces: readonly RuinPiece[];
};
export const RUIN_TILE_PX = 1024 / 12;
/** Shadow and edge-feather margin kept around each painting. */
export const RUIN_PAINT_MARGIN = 16;

const festivalGround = [430, 430, 760, 850] as const;
const meadowGround50 = [100, 180, 420, 410] as const, meadowGround62 = [700, 170, 900, 420] as const;
const ashGround = [600, 500, 940, 840] as const, gorgeGround = [700, 600, 900, 850] as const;
const hedge = 'meadow-hedge-prop', lantern = 'meadow-stone-lantern-prop', wall = 'obsidian-wall', brazier = 'obsidian-brazier-prop';

export const RUIN_RESTORATIONS: readonly RuinRestoration[] = [
    // The western plot includes the collapsed long house between the Welcome and Performers' houses.
    { buildingId: 'festival-welcome', artKey: 14, ground: festivalGround, clear: [[62, 78, 345, 345], [30, 340, 400, 600]],
        pieces: [{ source: 'festival-welcome', tile: [1, 1, 2, 3] }, { source: 'festival-storage-prop', tile: [3, 1, 1, 1] },
            { source: 'festival-storage-prop', tile: [2, 4, 1, 1] }, { source: 'festival-long-house', tile: [1, 5, 3, 1] },
            { source: 'festival-lantern-rack', tile: [2, 6, 1, 1] }] },
    { buildingId: 'festival-steps-house', artKey: 14, ground: festivalGround, clear: [[30, 640, 341, 853], [341, 640, 427, 768], [30, 853, 256, 885]],
        pieces: [{ source: 'festival-performers', tile: [1, 8, 3, 2] }] },
    // "The southern row of houses": the lantern booth plus the rebuilt south row.
    { buildingId: 'festival-lantern-house', artKey: 14, ground: festivalGround, clear: [[341, 760, 560, 938], [256, 853, 341, 938], [85, 925, 768, 1024]],
        pieces: [{ source: 'festival-lantern-kiosk', tile: [4, 9, 1, 1] }, { source: 'festival-lantern-rack', tile: [3, 10, 1, 1] },
            { source: 'festival-row-houses', tile: [1, 11, 4, 1] }, { source: 'festival-row-houses', tile: [5, 11, 4, 1] }] },
    { buildingId: 'gorgewatch', artKey: 25, ground: gorgeGround, clear: [[853, 170, 938, 341], [682, 341, 853, 400]],
        pieces: [{ source: 'gorgewatch-tower', tile: [7, 1, 3, 3] }] },
    { buildingId: 'esplanade-record-house', artKey: 60, ground: meadowGround50, clear: [[40, 512, 440, 860]],
        pieces: [{ source: 'esplanade-record-house', tile: [1, 6, 3, 3] }, { source: hedge, tile: [4, 7, 1, 1] },
            { source: hedge, tile: [1, 9, 1, 1] }, { source: hedge, tile: [2, 9, 1, 1] }] },
    { buildingId: 'esplanade-work-yard', artKey: 60, ground: meadowGround50, clear: [[600, 430, 938, 690], [853, 512, 1024, 1024]],
        pieces: [{ source: 'esplanade-work-shed', tile: [8, 6, 3, 1] }, { source: hedge, tile: [9, 5, 1, 1] },
            { source: 'meadow-hedge-row', tile: [11, 7, 1, 4] }, { source: hedge, tile: [10, 11, 1, 1] }, { source: hedge, tile: [11, 11, 1, 1] }] },
    { buildingId: 'grey-landing-relay', artKey: 62, ground: meadowGround62, clear: [[90, 85, 426, 770]],
        pieces: [{ source: 'greycliff-relay', tile: [2, 6, 3, 2] },
            { source: hedge, tile: [3, 1, 1, 1] }, { source: lantern, tile: [3, 2, 1, 1] },
            { source: 'esplanade-work-shed', tile: [2, 3, 3, 1] },
            { source: lantern, tile: [3, 4, 1, 1] }, { source: lantern, tile: [4, 5, 1, 1] },
            { source: hedge, tile: [2, 8, 1, 1] }, { source: hedge, tile: [4, 8, 1, 1] }] },
    { buildingId: 'grey-landing-memorial', artKey: 62, ground: meadowGround62, clear: [[598, 430, 800, 598], [515, 598, 800, 780]],
        pieces: [{ source: 'greycliff-memorial', tile: [6, 7, 2, 2] }, { source: lantern, tile: [7, 6, 1, 1] }, { source: lantern, tile: [8, 7, 1, 1] }] },
    { buildingId: 'obsidian-waystation', artKey: 52, ground: ashGround, clear: [[100, 427, 560, 900]],
        pieces: [{ source: 'obsidian-station-hall', tile: [3, 5, 2, 2] }, { source: wall, tile: [2, 5, 1, 1] }, { source: wall, tile: [5, 5, 1, 1] },
            { source: 'obsidian-round-tower', tile: [5, 7, 1, 2] }, { source: brazier, tile: [3, 8, 1, 1] },
            { source: wall, tile: [2, 9, 5, 1] }, { source: brazier, tile: [5, 10, 1, 1] }] },
    { buildingId: 'obsidian-north-watch', artKey: 52, ground: ashGround, clear: [[0, 0, 430, 300]],
        pieces: [{ source: 'obsidian-watch-hall', tile: [2, 1, 2, 2] }, { source: 'obsidian-round-tower', tile: [0, 0, 1, 2] },
            { source: brazier, tile: [1, 0, 1, 1] }, { source: wall, tile: [1, 1, 1, 1] }, { source: wall, tile: [4, 1, 1, 1] }, { source: brazier, tile: [0, 2, 1, 1] }] },
];

/** Floor-pixel box the painting covers, including its shadow margin. */
export function restorationArtBounds(spec: RuinRestoration) {
    const boxes = [...spec.clear, ...spec.pieces.map(({ tile: [c, r, w, h] }) => [c * RUIN_TILE_PX, r * RUIN_TILE_PX, (c + w) * RUIN_TILE_PX, (r + h) * RUIN_TILE_PX] as const)];
    const x0 = Math.max(0, Math.floor(Math.min(...boxes.map(b => b[0])) - RUIN_PAINT_MARGIN)), y0 = Math.max(0, Math.floor(Math.min(...boxes.map(b => b[1])) - RUIN_PAINT_MARGIN));
    const x1 = Math.min(1024, Math.ceil(Math.max(...boxes.map(b => b[2])) + RUIN_PAINT_MARGIN)), y1 = Math.min(1024, Math.ceil(Math.max(...boxes.map(b => b[3])) + RUIN_PAINT_MARGIN));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
export const ruinRestoration = (buildingId: string) => RUIN_RESTORATIONS.find(spec => spec.buildingId === buildingId);
export const restoredArtFile = (buildingId: string) => `/sector-buildings/restored-${buildingId}-v1.webp`;
