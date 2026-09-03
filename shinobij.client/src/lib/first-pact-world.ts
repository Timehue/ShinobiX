import {
    FIRST_PACT_WORLD_HEIGHT,
    FIRST_PACT_WORLD_WIDTH,
    firstPactDistrictAt,
} from "../../../shared/first-pact-contract";

export { FIRST_PACT_WORLD_HEIGHT, FIRST_PACT_WORLD_WIDTH, firstPactDistrictAt };
export const FIRST_PACT_TILE_SIZE = 48;

export const FirstPactTile = {
    Void: 0,
    Stone: 1,
    Road: 2,
    Grass: 3,
    Water: 4,
    Bridge: 5,
    Roof: 6,
    Wall: 7,
    Arena: 8,
    Market: 9,
    Kennel: 10,
    Grate: 11,
    Stairs: 12,
    Garden: 13,
    Court: 14,
} as const;

export type FirstPactTile = typeof FirstPactTile[keyof typeof FirstPactTile];

export type FirstPactPoint = Readonly<{ x: number; y: number }>;
export type FirstPactRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type FirstPactDirection = "north" | "south" | "east" | "west";

export type FirstPactArchitecturePlacement = Readonly<{
    id: string;
    atlasCell: number;
    bounds: FirstPactRect;
    /** Optional normalized crop within a legacy atlas cell. */
    sourceCrop?: Readonly<{ x: number; y: number; width: number; height: number }>;
    /** Cell in the dedicated four-column Bell Quarter standalone strip. */
    bellQuarterCell?: number;
    /** Purpose-built High Court silhouette; never sampled from the legacy grid. */
    highCourtAsset?: "main-archive" | "record-hall" | "council-annex";
    /** Purpose-built Guardian Gardens frontage; never sampled from the legacy grid. */
    gardenAsset?: "lodge" | "hall" | "court-pavilion";
    /** One-tile, collision-open public threshold in world coordinates. */
    publicThreshold?: FirstPactRect;
    /** One character per world tile: # is solid architecture, . is transparent/open. */
    collisionMask: readonly string[];
}>;

export type FirstPactKennelStructurePlacement = Readonly<{
    id: string;
    kind: "kennel-pavilion" | "exercise-fence" | "bonding-cedar";
    side: "west" | "center" | "east";
    bounds: FirstPactRect;
    /** Roof-only visual overhang; ground collision remains at bounds. */
    roofOverhangNorth?: number;
    /** One character per world tile: # is a visible roof, post, or rail cell. */
    collisionMask: readonly string[];
}>;

export type FirstPactPropPlacement = Readonly<{
    id: string;
    atlasCell: number;
    bounds: FirstPactRect;
    /** Purpose-built transparent Guardian Gardens court prop. */
    gardenAsset?: "court-fountain" | "kaio-tree" | "listening-bench";
    /** Exact grounded cells for transparent props whose roots sit outside the
     * rectangular visual silhouette's center (for example a leaning tree). */
    collisionCells?: readonly FirstPactPoint[];
    /** Optional exact prop footprint; otherwise only the center tile is solid. */
    collisionMask?: readonly string[];
    rotation?: number;
    filter?: string;
}>;

export type FirstPactNpcDefinition = Readonly<{
    id: string;
    name: string;
    title: string;
    position: FirstPactPoint;
    behavior: "static" | "wander";
    wanderBounds?: FirstPactRect;
    facing: FirstPactDirection;
    palette: "amber" | "jade" | "cyan" | "rose" | "slate";
    portrait: "keeper" | "registrar" | "scribe" | "merchant" | "engineer" | "citizen";
}>;

const tiles = new Uint8Array(FIRST_PACT_WORLD_WIDTH * FIRST_PACT_WORLD_HEIGHT);

/** Narrow civic arms beneath the three High Court doors. The main arm is the
 * uninterrupted south approach; the secondary arms meet the shared cross lane. */
export const FIRST_PACT_HIGH_COURT_PATHS = [
    { id: "main-archive-approach", bounds: { x: 42, y: 8, width: 1, height: 5 } },
    { id: "record-hall-approach", bounds: { x: 33, y: 11, width: 1, height: 2 } },
    { id: "council-annex-approach", bounds: { x: 51, y: 11, width: 1, height: 2 } },
] as const;

/** Three paving stones carry each north-garden threshold to the public lane.
 * The lodge's short west cross-arm then joins the established east/west road. */
export const FIRST_PACT_GARDENS_NORTH_PATHS = [
    { id: "garden-lodge-approach", bounds: { x: 10, y: 11, width: 1, height: 3 } },
    { id: "guardian-hall-approach", bounds: { x: 20, y: 11, width: 1, height: 3 } },
] as const;
export const FIRST_PACT_GARDENS_NORTH_CROSS_ARM = { x: 10, y: 13, width: 5, height: 1 } as const;

/** One chamfered civic court replaces the old rectangular lawns and anonymous
 * dark shelf. These stepped bands share the surrounding global paver grid, so
 * they read as a built public space rather than a pasted ground plate. */
export const FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS = [
    { id: "court-north-apron", bounds: { x: 7, y: 13, width: 19, height: 1 } },
    { id: "court-upper-breadth", bounds: { x: 5, y: 14, width: 23, height: 2 } },
    { id: "court-east-shoulder", bounds: { x: 4, y: 16, width: 23, height: 1 } },
    { id: "court-upper-chamfer", bounds: { x: 4, y: 17, width: 23, height: 1 } },
    { id: "court-middle-chamfer", bounds: { x: 4, y: 18, width: 22, height: 2 } },
    { id: "court-lower-shoulder", bounds: { x: 5, y: 20, width: 22, height: 1 } },
    { id: "court-lower-chamfer", bounds: { x: 5, y: 21, width: 21, height: 1 } },
    { id: "court-south-apron", bounds: { x: 7, y: 22, width: 19, height: 1 } },
] as const;

/** The upper aqueduct reach narrows between two real masonry banks after the
 * three-tile civic bridge. These tiles are the shared visual, collision, and
 * minimap authority for the Guardian Gardens east seam. */
export const FIRST_PACT_GARDENS_AQUEDUCT = {
    crossing: { x: 27, y: 13, width: 6, height: 3 },
    deck: { x: 28, y: 13, width: 2, height: 3 },
    westBank: { x: 27, y: 3, width: 1, height: 24 },
    water: { x: 28, y: 3, width: 2, height: 24 },
    eastBank: { x: 30, y: 3, width: 1, height: 24 },
} as const;

/** The citywide east/west boulevard crosses the Aqueduct where its older
 * two-tile Gardens reach opens into the three-tile southern channel. The deck,
 * both one-tile landings, and the two visible water mouths are shared map,
 * collision, minimap, render-proof, and capture authority. */
export const FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING = {
    deck: { x: 28, y: 27, width: 3, height: 4 },
    westLanding: { x: 27, y: 27, width: 1, height: 4 },
    eastLanding: { x: 31, y: 27, width: 1, height: 4 },
    northMouth: { x: 28, y: 26, width: 2, height: 1 },
    southMouth: { x: 28, y: 31, width: 3, height: 1 },
    abutments: [
        { x: 27, y: 26 },
        { x: 30, y: 26 },
        { x: 27, y: 31 },
        { x: 31, y: 31 },
    ],
} as const;

/** The southern civic boulevard crosses the older three-tile aqueduct on one
 * collision-authoritative deck. One-tile masonry banks continue on both sides
 * of the water except at the road opening, so render, collision, minimap, and
 * pathfinding all describe the same bridge rather than a coordinate-only skin. */
export const FIRST_PACT_AQUEDUCT_CIVIC_CROSSING = {
    water: { x: 28, y: 27, width: 3, height: 26 },
    deck: { x: 28, y: 43, width: 3, height: 3 },
    westBankNorth: { x: 27, y: 31, width: 1, height: 12 },
    westBankSouth: { x: 27, y: 46, width: 1, height: 2 },
    eastBankNorth: { x: 31, y: 31, width: 1, height: 12 },
    eastBankSouth: { x: 31, y: 46, width: 1, height: 7 },
    westLanding: { x: 25, y: 43, width: 3, height: 3 },
    eastLanding: { x: 31, y: 43, width: 4, height: 3 },
    westServiceApproach: { x: 25, y: 39, width: 2, height: 9 },
    control: { x: 25.75, y: 39, width: 5, height: 3.33 },
} as const;

/** One two-tile civic spine is the Gardens' dominant public route. Short,
 * one-tile branches land exactly at doors, Kaio, the guardian pool, and the
 * real aqueduct bridge; the former four-sided pool loop returns to Court. */
export const FIRST_PACT_GARDENS_PRIMARY_SPINE = {
    id: "gardens-processional-spine",
    bounds: { x: 15, y: 13, width: 2, height: 10 },
} as const;

export const FIRST_PACT_GARDENS_PUBLIC_ROUTES = [
    { id: "lodge-door-arm", bounds: { x: 10, y: 10, width: 1, height: 4 } },
    { id: "lodge-spine-branch", bounds: { x: 10, y: 13, width: 6, height: 1 } },
    { id: "hall-door-arm", bounds: { x: 20, y: 10, width: 1, height: 5 } },
    { id: "hall-aqueduct-branch", bounds: { x: 17, y: 14, width: 16, height: 1 } },
    { id: "kaio-spur", bounds: { x: 17, y: 16, width: 2, height: 1 } },
    { id: "guardian-pool-spur", bounds: { x: 16, y: 19, width: 4, height: 1 } },
    { id: "pavilion-turn", bounds: { x: 10, y: 22, width: 6, height: 1 } },
    { id: "pavilion-door-arm", bounds: { x: 10, y: 20, width: 1, height: 3 } },
] as const;

export const FIRST_PACT_GARDENS_ROUTE_HIERARCHY = [
    { ...FIRST_PACT_GARDENS_PRIMARY_SPINE, role: "primary" as const },
    ...FIRST_PACT_GARDENS_PUBLIC_ROUTES.map((route) => ({ ...route, role: "secondary" as const })),
] as const;

function pointInRect(x: number, y: number, bounds: FirstPactRect): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

export function isFirstPactGardensPrimaryRoute(x: number, y: number): boolean {
    return pointInRect(x, y, FIRST_PACT_GARDENS_PRIMARY_SPINE.bounds);
}

export function isFirstPactGardensSecondaryRoute(x: number, y: number): boolean {
    return FIRST_PACT_GARDENS_PUBLIC_ROUTES.some(({ bounds }) => pointInRect(x, y, bounds));
}

function indexOf(x: number, y: number): number {
    return y * FIRST_PACT_WORLD_WIDTH + x;
}

function inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < FIRST_PACT_WORLD_WIDTH && y < FIRST_PACT_WORLD_HEIGHT;
}

function paintRect(rect: FirstPactRect, tile: FirstPactTile): void {
    const maxX = Math.min(FIRST_PACT_WORLD_WIDTH, rect.x + rect.width);
    const maxY = Math.min(FIRST_PACT_WORLD_HEIGHT, rect.y + rect.height);
    for (let y = Math.max(0, rect.y); y < maxY; y += 1) {
        for (let x = Math.max(0, rect.x); x < maxX; x += 1) tiles[indexOf(x, y)] = tile;
    }
}

function paintCircle(cx: number, cy: number, radius: number, tile: FirstPactTile): void {
    const r2 = radius * radius;
    for (let y = cy - radius; y <= cy + radius; y += 1) {
        for (let x = cx - radius; x <= cx + radius; x += 1) {
            if (inBounds(x, y) && ((x - cx) ** 2 + (y - cy) ** 2) <= r2) tiles[indexOf(x, y)] = tile;
        }
    }
}

function buildWorld(): void {
    tiles.fill(FirstPactTile.Void);

    // One continuous civic shelf. Individual districts change material, but
    // their streets occupy the same coordinate plane — no sector hop exists.
    paintRect({ x: 3, y: 3, width: 78, height: 50 }, FirstPactTile.Stone);
    // A real two-course north parapet closes the former void behind Guardian
    // Gardens. It is map geometry (solid Wall in collision and minimap), not a
    // camera crop or a decorative rectangle painted only for the QA frame.
    paintRect({ x: 3, y: 1, width: 27, height: 2 }, FirstPactTile.Wall);
    // North of the public lane the two civic buildings stand on fitted stone.
    // South of it, a chamfered, world-backed public court replaces both the old
    // rectangular lawns and the unfinished dark masonry field.
    for (const band of FIRST_PACT_GARDENS_PUBLIC_COURT_BANDS) paintRect(band.bounds, FirstPactTile.Court);
    // The archive shelf rises two rows north of the general civic deck. This
    // keeps the complete roofline on authored terrain in the full-campus view,
    // rather than leaving a wide void band behind a pasted silhouette.
    paintRect({ x: 30, y: 1, width: 25, height: 17 }, FirstPactTile.Court);
    paintRect({ x: 57, y: 5, width: 22, height: 18 }, FirstPactTile.Garden);
    // The market court meets the older civic shelf on a repaired, stepped
    // footprint instead of one rectangular district plate.
    paintRect({ x: 57, y: 24, width: 21, height: 1 }, FirstPactTile.Market);
    paintRect({ x: 56, y: 25, width: 23, height: 8 }, FirstPactTile.Market);
    paintRect({ x: 57, y: 33, width: 22, height: 2 }, FirstPactTile.Market);
    paintRect({ x: 56, y: 35, width: 22, height: 3 }, FirstPactTile.Market);
    paintRect({ x: 57, y: 38, width: 22, height: 1 }, FirstPactTile.Market);
    // The ward continues to the civic shelf's south edge. Its lower apron is
    // an authored exercise yard rather than anonymous stone left beneath the
    // service road.
    paintRect({ x: 5, y: 31, width: 23, height: 22 }, FirstPactTile.Kennel);
    paintRect({ x: 30, y: 40, width: 25, height: 12 }, FirstPactTile.Stone);
    paintRect({ x: 57, y: 41, width: 22, height: 11 }, FirstPactTile.Grate);

    // The western aqueduct is a genuine obstacle, crossed by authored bridges.
    // Its upper two-tile reach continues visibly behind the Gardens bridge;
    // real one-tile banks replace the old abrupt three-tile teal rectangle.
    paintRect(FIRST_PACT_GARDENS_AQUEDUCT.water, FirstPactTile.Water);
    paintRect(FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.water, FirstPactTile.Water);

    // Connected primary streets. The Gardens overlap is normalized after every
    // inherited road pass near the end of this builder, so later city geometry
    // cannot silently widen its two-tile civic spine.
    paintRect({ x: 3, y: 27, width: 78, height: 4 }, FirstPactTile.Road);
    paintRect({ x: 40, y: 3, width: 5, height: 50 }, FirstPactTile.Road);
    paintRect({ x: 14, y: 13, width: 51, height: 3 }, FirstPactTile.Road);
    for (const path of FIRST_PACT_GARDENS_NORTH_PATHS) paintRect(path.bounds, FirstPactTile.Road);
    paintRect(FIRST_PACT_GARDENS_NORTH_CROSS_ARM, FirstPactTile.Road);
    paintRect({ x: 10, y: 10, width: 1, height: 1 }, FirstPactTile.Road);
    paintRect({ x: 20, y: 10, width: 1, height: 1 }, FirstPactTile.Road);
    // Inside the High Court, restore the broad inherited north/south boulevard
    // to quiet court stone, then lay only the three door-width public arms. The
    // east/west city lane at y=13..15 remains untouched and connects all three.
    paintRect({ x: 40, y: 3, width: 5, height: 10 }, FirstPactTile.Court);
    for (const path of FIRST_PACT_HIGH_COURT_PATHS) paintRect(path.bounds, FirstPactTile.Road);
    paintRect({ x: 14, y: 14, width: 3, height: 31 }, FirstPactTile.Road);
    // The southern boulevard now reaches the stable-gate aisle instead of
    // dissolving into anonymous ward paving. It separates the upper tack row
    // from the lower handler frontage as one continuous public street.
    paintRect({ x: 5, y: 43, width: 61, height: 3 }, FirstPactTile.Road);
    paintRect({ x: 64, y: 14, width: 3, height: 32 }, FirstPactTile.Road);
    paintRect({ x: 54, y: 20, width: 3, height: 27 }, FirstPactTile.Road);
    paintRect({ x: 25, y: 20, width: 3, height: 28 }, FirstPactTile.Road);

    // The market's east channel is real world water rather than a cyan pool
    // baked into one building sprite. The public lane crosses it on the same
    // two-tile cobble course used through the market proper.
    paintRect({ x: 75, y: 20, width: 2, height: 23 }, FirstPactTile.Water);
    paintRect({ x: 75, y: 29, width: 2, height: 2 }, FirstPactTile.Road);

    // Inside the market the citywide four-tile road resolves into a two-tile
    // trading lane. One-tile loops serve each stall, while the arcade keeps a
    // three-tile public spine below its genuinely open center passage.
    paintRect({ x: 57, y: 27, width: 18, height: 2 }, FirstPactTile.Market);
    paintRect({ x: 77, y: 27, width: 2, height: 2 }, FirstPactTile.Market);
    paintRect({ x: 56, y: 27, width: 4, height: 2 }, FirstPactTile.Road);
    paintRect({ x: 59, y: 23, width: 1, height: 7 }, FirstPactTile.Road);
    paintRect({ x: 69, y: 23, width: 1, height: 7 }, FirstPactTile.Road);
    paintRect({ x: 69, y: 27, width: 5, height: 2 }, FirstPactTile.Road);
    paintRect({ x: 73, y: 23, width: 1, height: 7 }, FirstPactTile.Road);
    paintRect({ x: 64, y: 22, width: 3, height: 18 }, FirstPactTile.Road);

    // The southern front is a low-traffic service setback crossed by one-tile
    // door arms. These join both thresholds to the spine without recreating a
    // broad rectangular plaza beneath the buildings.
    paintRect({ x: 57, y: 38, width: 18, height: 2 }, FirstPactTile.Market);
    paintRect({ x: 59, y: 38, width: 13, height: 1 }, FirstPactTile.Road);
    paintRect({ x: 64, y: 31, width: 3, height: 9 }, FirstPactTile.Road);

    // Bell Quarter is an inhabited block, not a garden field with monuments
    // dropped onto it. Reclaim the broad inherited cross-road inside the ward,
    // then author a narrower mossed-cobble network which reaches every south
    // door and rejoins both the High Court approach and the market spine.
    paintRect({ x: 57, y: 5, width: 22, height: 18 }, FirstPactTile.Garden);
    paintRect({ x: 54, y: 13, width: 26, height: 2 }, FirstPactTile.Road);
    // Short arms begin beneath the transparent lower margins of the west and
    // east house sprites. The masonry is partly occluded by their real steps,
    // then remains continuously visible into the east-west public lane.
    paintRect({ x: 59, y: 12, width: 3, height: 2 }, FirstPactTile.Road);
    paintRect({ x: 75, y: 12, width: 3, height: 2 }, FirstPactTile.Road);
    paintRect({ x: 67, y: 14, width: 2, height: 9 }, FirstPactTile.Road);
    paintRect({ x: 60, y: 14, width: 2, height: 3 }, FirstPactTile.Road);
    paintRect({ x: 74, y: 14, width: 1, height: 9 }, FirstPactTile.Road);
    paintRect({ x: 59, y: 21, width: 16, height: 2 }, FirstPactTile.Road);
    paintRect({ x: 64, y: 22, width: 3, height: 2 }, FirstPactTile.Road);
    // The canal predates the quarter and remains a genuine obstacle at its
    // southeast edge; the one-tile courier lane bends west instead of paving
    // over water or implying an unauthored bridge.
    paintRect({ x: 75, y: 20, width: 2, height: 3 }, FirstPactTile.Water);

    // The upper handler approach keeps its one-tile north/south service lane.
    // The full southern boulevard at y=43..45 remains collision-free.
    paintRect({ x: 14, y: 31, width: 2, height: 12 }, FirstPactTile.Kennel);

    // Grand Colosseum: traversable inner sand, solid ring, four public gates.
    paintCircle(42, 28, 10, FirstPactTile.Wall);
    paintCircle(42, 28, 8, FirstPactTile.Arena);
    paintRect({ x: 40, y: 17, width: 5, height: 4 }, FirstPactTile.Stairs);
    paintRect({ x: 40, y: 36, width: 5, height: 4 }, FirstPactTile.Stairs);
    paintRect({ x: 31, y: 26, width: 4, height: 5 }, FirstPactTile.Stairs);
    paintRect({ x: 50, y: 26, width: 4, height: 5 }, FirstPactTile.Stairs);

    // Arrival court is intentionally quiet and broad enough for the opening
    // camera reveal, tutorial movement, and the player's following companion.
    paintRect({ x: 34, y: 47, width: 17, height: 6 }, FirstPactTile.Court);
    paintRect({ x: 40, y: 46, width: 5, height: 7 }, FirstPactTile.Road);

    // The inherited city roads are intentionally broad. Normalize their overlap
    // inside the Gardens only after every later road pass: Court shoulders frame
    // one two-tile processional spine and one-tile destination branches. The
    // bridge approach at x27 and its east landing remain untouched.
    paintRect({ x: 14, y: 13, width: 3, height: 10 }, FirstPactTile.Court);
    paintRect({ x: 17, y: 13, width: 10, height: 3 }, FirstPactTile.Court);
    for (const route of FIRST_PACT_GARDENS_ROUTE_HIERARCHY) paintRect(route.bounds, FirstPactTile.Road);

    // Restore the two masonry banks after the road pass, leaving only the
    // three crossing rows open. The real upper bridge is then painted last so
    // tile type, minimap material, collision, and render pass all agree.
    const gardenAqueductBankSegments = [
        { y: FIRST_PACT_GARDENS_AQUEDUCT.water.y, height: FIRST_PACT_GARDENS_AQUEDUCT.deck.y - FIRST_PACT_GARDENS_AQUEDUCT.water.y },
        {
            y: FIRST_PACT_GARDENS_AQUEDUCT.deck.y + FIRST_PACT_GARDENS_AQUEDUCT.deck.height,
            height: FIRST_PACT_GARDENS_AQUEDUCT.water.y + FIRST_PACT_GARDENS_AQUEDUCT.water.height
                - FIRST_PACT_GARDENS_AQUEDUCT.deck.y - FIRST_PACT_GARDENS_AQUEDUCT.deck.height,
        },
    ] as const;
    for (const bank of [FIRST_PACT_GARDENS_AQUEDUCT.westBank, FIRST_PACT_GARDENS_AQUEDUCT.eastBank]) {
        for (const segment of gardenAqueductBankSegments) {
            paintRect({ x: bank.x, y: segment.y, width: bank.width, height: segment.height }, FirstPactTile.Wall);
        }
    }
    // Close the two-cell parapet return above the east bank. Leaving these as
    // court would create an unreachable pocket behind the collision-backed
    // canal wall even though no public paving is visible there.
    paintRect({ x: 30, y: 2, width: 2, height: 1 }, FirstPactTile.Wall);
    paintRect(FIRST_PACT_GARDENS_AQUEDUCT.deck, FirstPactTile.Bridge);

    // Reassert the lower Aqueduct after every inherited road, ward, arena, and
    // arrival-court pass. The bank courses are real Wall cells split around the
    // three-row boulevard opening; the deck is real Bridge data, not a render-
    // only exception. The accepted Gardens reach above y=27 remains unchanged;
    // the separate central boulevard crossing is normalized immediately after.
    for (const bank of [
        FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankNorth,
        FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.westBankSouth,
        FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankNorth,
        FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.eastBankSouth,
    ]) {
        paintRect(bank, FirstPactTile.Wall);
    }
    // The central boulevard is reasserted after the arena's west-gate stairs:
    // the full span is real Bridge data and each bank receives one Road landing
    // before the Colosseum threshold changes material farther east.
    paintRect(FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.deck, FirstPactTile.Bridge);
    paintRect(FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.westLanding, FirstPactTile.Road);
    paintRect(FIRST_PACT_AQUEDUCT_CENTRAL_CROSSING.eastLanding, FirstPactTile.Road);
    paintRect(FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.deck, FirstPactTile.Bridge);

    // GATEWORKS SERVICE CIRCULATION.
    //
    // The district was one 22x11 sheet of service stone with both halls parked
    // on it: no aisle reached either south entrance, and the valve stood on bare
    // grate with nothing under it. Every tile below is walkable already, so this
    // is a MATERIAL pass, not a collision one — the routes it draws were always
    // walkable, they simply were not legible as routes.
    //
    // Painted last so no earlier district sheet can flood back over them, and
    // kept east of x56 so the accepted Aqueduct crossings are untouched.

    // The south maintenance street, running the full frontage of both halls so
    // the engine hall and the pump house are served by one continuous lane
    // instead of anonymous ground.
    paintRect({ x: 54, y: 50, width: 25, height: 2 }, FirstPactTile.Road);

    // A north-south service spine in the alley between the engine hall and the
    // pump house, tying that lane up to the Market shelf. Without it the only
    // way through the district read as walking across a field.
    paintRect({ x: 64, y: 41, width: 2, height: 11 }, FirstPactTile.Road);

    // The yard lane between the pump house and the maintenance store, so the
    // service row is entered from a street rather than from open ground.
    paintRect({ x: 73, y: 41, width: 2, height: 11 }, FirstPactTile.Road);

    // The valve's masonry cradle. Painted after the lane so it reads as a plinth
    // set into the street's west end rather than a patch of different floor.
    paintRect({ x: 57, y: 48, width: 6, height: 4 }, FirstPactTile.Stone);

    // ARRIVAL COURT. A real rampart closes the city's south edge either side of
    // the gatehouse, so the boundary is built rather than simply where the map
    // stops being painted. The spine keeps its opening under the arch.
    // The court continues south past the old last-painted row, so the gate can
    // sit at a real edge instead of on top of the player's landing.
    paintRect({ x: 32, y: 53, width: 25, height: 3 }, FirstPactTile.Court);
    paintRect({ x: 32, y: 55, width: 6, height: 1 }, FirstPactTile.Wall);
    paintRect({ x: 47, y: 55, width: 10, height: 1 }, FirstPactTile.Wall);

    // One stepped course reads as the threshold the plaza hands you to the gate.
    paintRect({ x: 40, y: 50, width: 5, height: 1 }, FirstPactTile.Stairs);

    // The plaza was one flat sheet of court paving, which is the queue's leading
    // complaint. The accepted Market district reads because its ground alternates:
    // light cobble streets against dark planted plots, with buildings set back
    // inside them. Same structure here -- two planted setbacks flanking the civic
    // spine, a cobble margin beside it, and a cross street along the gate wall.
    paintRect({ x: 34, y: 47, width: 5, height: 5 }, FirstPactTile.Garden);
    paintRect({ x: 46, y: 47, width: 5, height: 5 }, FirstPactTile.Garden);
    paintRect({ x: 32, y: 52, width: 25, height: 1 }, FirstPactTile.Road);

    // SEAM FEATHERING.
    //
    // A dead-straight boundary between two ground materials is the pasted plate
    // the brief forbids: real cities change surface along a kerb or a doorway,
    // not along a ruler. A whole-city scan found the longest runs, and the worst
    // of them was the cross street directly above -- 25 unbroken tiles. These
    // notches interlock the two materials so the join reads as paving laid
    // against paving. Every tile involved is walkable either way, so nothing
    // about collision or routing changes.
    // Bell Quarter and Kennel Ward are ACCEPTED gates. Feathering their joins
    // broke two of their own contracts, which is the rule working: the brief
    // says preserve accepted pieces exactly unless a blind seam proof demands a
    // change, and no such proof exists. Their runs stay as authored.
    for (const notch of [
        // Arrival Court cross street against the gate forecourt.
        { x: 35, y: 53, width: 2, height: 1, tile: FirstPactTile.Road },
        { x: 44, y: 53, width: 2, height: 1, tile: FirstPactTile.Road },
        { x: 52, y: 53, width: 2, height: 1, tile: FirstPactTile.Road },
        { x: 38, y: 52, width: 2, height: 1, tile: FirstPactTile.Court },
        { x: 48, y: 52, width: 2, height: 1, tile: FirstPactTile.Court },
        // Gateworks maintenance street against the southern apron.
        { x: 66, y: 52, width: 2, height: 1, tile: FirstPactTile.Road },
        { x: 74, y: 52, width: 2, height: 1, tile: FirstPactTile.Road },
        { x: 70, y: 51, width: 2, height: 1, tile: FirstPactTile.Stone },
    ]) paintRect({ x: notch.x, y: notch.y, width: notch.width, height: notch.height }, notch.tile);
}

buildWorld();

/**
 * Exterior silhouettes composited over the collision-authoritative tile map.
 * The source atlas is a rigid four-by-four grid in this exact cell order:
 * civic buildings, animal wards, market buildings, then bell and waterworks.
 */
export const FIRST_PACT_ARCHITECTURE: readonly FirstPactArchitecturePlacement[] = [
    // Guardian Gardens
    { id: "garden-lodge", atlasCell: 7, gardenAsset: "lodge", bounds: { x: 6, y: 4, width: 9, height: 9 }, publicThreshold: { x: 10, y: 10, width: 1, height: 1 }, collisionMask: [".........", "..#####..", "..#####..", ".#######.", ".#######.", ".#######.", "...#.#...", ".........", "........."] },
    { id: "guardian-hall", atlasCell: 1, gardenAsset: "hall", bounds: { x: 16, y: 4, width: 10, height: 8 }, publicThreshold: { x: 20, y: 10, width: 1, height: 1 }, collisionMask: ["..........", "..######..", ".########.", ".########.", ".########.", ".########.", "...#..#...", ".........."] },
    { id: "garden-court-pavilion", atlasCell: 3, gardenAsset: "court-pavilion", bounds: { x: 6, y: 16, width: 8, height: 5 }, publicThreshold: { x: 10, y: 20, width: 1, height: 1 }, collisionMask: [".######.", "########", ".######.", ".######.", "...#...."] },

    // High Court archive campus
    // Three purpose-built silhouettes share the same roof pitch, tile density,
    // south-facing door scale, and authored shadow direction. Their final rows
    // are visible stairs: one centered cell stays open as the public threshold.
    { id: "high-court-archive", atlasCell: 0, highCourtAsset: "main-archive", bounds: { x: 38, y: 2, width: 9, height: 7 }, publicThreshold: { x: 42, y: 8, width: 1, height: 1 }, collisionMask: ["....#....", "..#####..", ".########", "#########", "#########", "#########", "..##.##.."] },
    { id: "west-record-hall", atlasCell: 2, highCourtAsset: "record-hall", bounds: { x: 30, y: 7, width: 6, height: 5 }, publicThreshold: { x: 33, y: 11, width: 1, height: 1 }, collisionMask: [".####.", "######", "######", "######", ".##.#."] },
    { id: "east-council-annex", atlasCell: 3, highCourtAsset: "council-annex", bounds: { x: 49, y: 7, width: 5, height: 5 }, publicThreshold: { x: 51, y: 11, width: 1, height: 1 }, collisionMask: ["..#..", ".###.", "#####", "#####", ".#.#."] },

    // Bell Quarter. These normalized crops isolate four complete, fitting
    // silhouettes from the legacy atlas: the open bell remains the district's
    // only landmark, while three smaller south-facing homes establish ordinary
    // shinobi scale. No neighboring dome or clipped cell content is sampled.
    { id: "open-bell-tower", atlasCell: 12, bellQuarterCell: 0, bounds: { x: 65, y: 5, width: 6, height: 9 }, collisionMask: ["......", ".####.", ".####.", ".####.", ".####.", "######", "######", "######", "..##.."] },
    { id: "bell-quarter-residence", atlasCell: 15, bellQuarterCell: 1, bounds: { x: 57, y: 6, width: 6, height: 7 }, collisionMask: [".#....", ".####.", ".####.", "######", "######", "######", "..##.."] },
    { id: "bell-scribe-townhouse", atlasCell: 1, bellQuarterCell: 2, bounds: { x: 73, y: 6, width: 6, height: 7 }, collisionMask: ["..#.#.", ".#####", "######", "######", "######", ".#####", "..##.."] },
    { id: "bell-courier-house", atlasCell: 10, bellQuarterCell: 3, bounds: { x: 58, y: 17, width: 6, height: 5 }, collisionMask: [".####.", "######", "######", "######", ".####."] },

    // Kennel Ward
    // V3 Kennel architecture is authored at an exact two-pixels-per-world-pixel
    // scale. The smaller service buildings share the street-facing block between
    // the two north/south roads instead of sitting on detached private pads.
    // Their final rows are visible entry steps, so those clean thresholds remain
    // traversable rather than being treated as solid masonry.
    { id: "vale-stable", atlasCell: 4, bounds: { x: 5, y: 31, width: 8, height: 7 }, collisionMask: [".######.", "########", "##....##", "##....##", "##....##", "##....##", ".##..##."] },
    // A street-edge tack room replaces the detached display pens. Its covered
    // delivery bay aligns with the stable's x=9 gate aisle; the roof above the
    // bay is a walk-under canopy, while the three-room mass and east pier are
    // collision-authoritative walls.
    { id: "stable-tack-annex", atlasCell: 4, bounds: { x: 6, y: 38, width: 5, height: 4 }, collisionMask: ["###..", "###.#", "###.#", "###.#"] },
    // The handler lodge closes the court's north-west edge beside the tack room.
    // Its two south-facing doorsteps land directly on the boulevard approach;
    // roof, timber, and stone remain collision-authoritative.
    { id: "handler-lodge", atlasCell: 4, bounds: { x: 11, y: 39, width: 5, height: 4 }, collisionMask: ["####.", "#####", "#####", "##.#."] },
    // The infirmary anchors the lower-left campus without touching the three-tile
    // boulevard. Its paired main steps open south into a two-tile public approach
    // that returns west to the established stable-gate aisle.
    { id: "kennel-infirmary", atlasCell: 5, bounds: { x: 10, y: 46, width: 5, height: 4 }, collisionMask: ["####.", "#####", "#####", "##.##"] },
    { id: "kennel-house", atlasCell: 5, bounds: { x: 17, y: 32, width: 4, height: 4 }, collisionMask: ["####", "####", ".##.", "...."] },
    { id: "feed-storehouse", atlasCell: 6, bounds: { x: 21, y: 32, width: 4, height: 4 }, collisionMask: ["####", "####", "####", "...."] },

    // Market and Scriptorium. These compact standalone silhouettes replace
    // the old atlas cells whose neighboring art leaked across their crops.
    // The arcade's center column is a real covered passage, each stall keeps
    // a full tile of public aisle, and both south doors meet the forecourt.
    { id: "market-arcade", atlasCell: 8, bounds: { x: 60, y: 23, width: 9, height: 6 }, collisionMask: [".........", ".###.###.", "####.####", "####.####", "####.####", ".###.###."] },
    { id: "market-stall-west", atlasCell: 9, bounds: { x: 56, y: 24, width: 3, height: 3 }, collisionMask: ["###", "###", "###"] },
    { id: "market-stall-east", atlasCell: 9, bounds: { x: 70, y: 24, width: 3, height: 3 }, collisionMask: ["###", "###", "###"] },
    { id: "merchant-house", atlasCell: 10, bounds: { x: 56, y: 32, width: 7, height: 6 }, collisionMask: ["..###..", ".#####.", ".#####.", ".#####.", ".#####.", ".##.##."] },
    { id: "waterside-workshop", atlasCell: 11, bounds: { x: 67, y: 32, width: 9, height: 6 }, collisionMask: ["...#.....", "..#####..", ".#######.", ".#######.", ".#######.", ".##..###."] },

    // Gateworks
    // GATEWORKS. The shipped pair were 11x11 and 10x10 monuments that between
    // them filled the district — a 23x12 shelf with 221 tiles of building on it,
    // which left no plot anywhere for ordinary architecture and is why the halls
    // read as oversized. Re-authored at working-building scale from front
    // elevations that share one masonry course and roof-tile size with the
    // service row below, so the district finally has a sense of scale.
    // Each mask blocks the body and leaves its south row walkable as the
    // threshold the maintenance street serves.
    { id: "gateworks-engine-hall", atlasCell: 13, bounds: { x: 57, y: 40, width: 7, height: 8 }, collisionMask: ["...#...", ".#####.", ".#####.", "#######", ".#####.", ".#####.", ".#####.", "......."] },
    { id: "gateworks-pump-house", atlasCell: 14, bounds: { x: 66, y: 40, width: 7, height: 6 }, collisionMask: [".#####.", ".######", "######.", ".#####.", ".#####.", "......."] },
    // The ordinary working architecture the queue asks for: a keeper's rowhouse,
    // a maintenance store and a valve house, all at house scale so the two halls
    // finally have something to be larger THAN.
    { id: "gateworks-keeper-rowhouse", atlasCell: 13, bounds: { x: 75, y: 40, width: 3, height: 6 }, collisionMask: ["###", "###", "###", "###", "###", "..."] },
    { id: "gateworks-maintenance-shed", atlasCell: 13, bounds: { x: 66, y: 46, width: 6, height: 4 }, collisionMask: ["######", "######", "######", "......"] },
    { id: "gateworks-valve-house", atlasCell: 14, bounds: { x: 74, y: 46, width: 4, height: 4 }, collisionMask: [".##.", "###.", "####", "...."] },
    // ARRIVAL COURT THRESHOLD. The city's south boundary was the last painted
    // row of the map, so the world ended at the edge of the canvas. The gatehouse
    // gives the northbound spine a built edge to pass through: its piers are
    // solid, and the arch column is open at EVERY row so the player walks under
    // the lintel rather than into it.
    { id: "arrival-gate", atlasCell: 13, bounds: { x: 38, y: 51, width: 9, height: 5 }, collisionMask: ["..##.##..", ".###.###.", "####.####", "####.####", "........."] },
    { id: "arrival-stele-west", atlasCell: 13, bounds: { x: 34, y: 53, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    { id: "arrival-lantern-west", atlasCell: 13, bounds: { x: 36, y: 53, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    { id: "arrival-lantern-east", atlasCell: 13, bounds: { x: 48, y: 53, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    { id: "arrival-stele-east", atlasCell: 13, bounds: { x: 50, y: 53, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    // A second pair closer to the spine, so the approach is lit the whole way
    // down rather than only at the wall.
    { id: "arrival-lantern-approach-west", atlasCell: 13, bounds: { x: 38, y: 47, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    { id: "arrival-lantern-approach-east", atlasCell: 13, bounds: { x: 46, y: 47, width: 1, height: 2 }, collisionMask: ["#", "#"] },
    // One maple stands in each planted setback so the plots carry mass instead of
    // reading as pasted green rectangles. Canopies stay walk-under, the same
    // contract the bonding cedar uses.
    { id: "arrival-maple-west", atlasCell: 13, bounds: { x: 34, y: 48, width: 4, height: 4 }, collisionMask: ["....", "....", "..#.", "...."] },
    { id: "arrival-maple-east", atlasCell: 13, bounds: { x: 47, y: 48, width: 4, height: 4 }, collisionMask: ["....", "....", ".#..", "...."] },
] as const;

/**
 * Supplementary V3 kennel architecture. These forms use the same navy tile,
 * timber, bronze, and stone language as the standalone ward buildings, while
 * remaining data-authored so their roofs and rails participate in collision.
 * The mirrored fence gates open toward the four-tile central handling aisle.
 */
export const FIRST_PACT_KENNEL_STRUCTURES: readonly FirstPactKennelStructurePlacement[] = [
    {
        id: "vale-bonding-cedar",
        kind: "bonding-cedar",
        side: "center",
        bounds: { x: 19, y: 36, width: 4, height: 4 },
        // The crown and reaching boughs are visual overhang. Only the two
        // ground cells occupied by the joined trunk and masonry planter block
        // movement, leaving four alleys to pass beneath the canopy edges.
        collisionMask: ["....", "....", "....", ".##."],
    },
    {
        id: "lower-kennel-pavilion",
        kind: "kennel-pavilion",
        side: "center",
        bounds: { x: 18, y: 46, width: 7, height: 4 },
        roofOverhangNorth: .42,
        // The visible side pens and roof masses are solid. The centered bay is
        // an authored covered gateway, so the primary north/south aisle passes
        // through it instead of clipping through a wall.
        collisionMask: [".##.##.", "###.###", "###.###", "###.###"],
    },
    {
        id: "lower-west-exercise-fence",
        kind: "exercise-fence",
        side: "west",
        bounds: { x: 15, y: 46, width: 3, height: 7 },
        collisionMask: ["#.#", "#.#", "#.#", "#..", "#..", "#..", "###"],
    },
    {
        id: "lower-east-exercise-fence",
        kind: "exercise-fence",
        side: "east",
        // The east run begins below the established north/south service road;
        // its mouth uses that road instead of placing fence collision on it.
        bounds: { x: 25, y: 48, width: 3, height: 5 },
        collisionMask: ["#.#", "..#", "..#", "..#", "###"],
    },
] as const;

/** One legible, story-relevant landmark per space; buildings carry the city detail. */
export const FIRST_PACT_CITY_PROPS: readonly FirstPactPropPlacement[] = [
    // High Court archive posting.
    { id: "archive-notice", atlasCell: 2, bounds: { x: 30.5, y: 14.5, width: 4.5, height: 3 } },

    // Kaio's listening court gives the south plaza one restrained civic use.
    // Its irregular root pocket and one east-flank bench preserve the critic-
    // verified listener at 18,17; only the real root and stone feet are solid.
    { id: "garden-court-kaio-tree", atlasCell: 4, gardenAsset: "kaio-tree", bounds: { x: 14, y: 13, width: 5, height: 5 }, collisionCells: [{ x: 18, y: 18 }] },
    { id: "garden-court-listening-bench", atlasCell: 4, gardenAsset: "listening-bench", bounds: { x: 19, y: 16, width: 3, height: 2 }, collisionMask: ["...", "#.#"] },

    // Guardian pool. Its exact basin footprint leaves the route on its west
    // side open and remains visually subordinate to the two civic buildings.
    { id: "garden-court-fountain", atlasCell: 4, gardenAsset: "court-fountain", bounds: { x: 20, y: 18, width: 4, height: 3 }, collisionMask: [".##.", "####", "####"] },

    // Market edge pockets turn the wide crossroads into two functional fronts
    // while leaving its continuous lanes and every stall aisle unobstructed.
    { id: "market-scriptorium-notice", atlasCell: 2, bounds: { x: 60, y: 30.2, width: 3.2, height: 1.7 } },
    { id: "market-trade-crates", atlasCell: 9, bounds: { x: 70.5, y: 30.2, width: 3.2, height: 1.7 } },

    // Kennel Ward working equipment tied to Vale Stable.
    // The cart is parked across the tack-room doors and the trough hugs the
    // delivery pier, so both read as working frontage rather than loose props.
    { id: "stable-hay-cart", atlasCell: 10, bounds: { x: 5.65, y: 40.2, width: 2.6, height: 1.73 }, rotation: -4 },
    { id: "stable-trough", atlasCell: 11, bounds: { x: 10.05, y: 40.55, width: 2.6, height: 1.73 } },

    // Gateworks and aqueduct machinery explains the district's function.
    { id: "gateworks-valve", atlasCell: 12, bounds: { x: 57, y: 49, width: 5, height: 3.33 } },
    // Gateworks was buildings standing on bare service stone: no plots, no
    // setbacks and not one prop, while the accepted Market next door carries a
    // stall, a signboard, crates, baskets and planters at every doorway. That
    // difference, not the architecture, is what made the district read as
    // placed rather than lived in. The sixteen-cell street atlas was already
    // authored and barely used, so this dresses the works from it.
    { id: "gateworks-alley-lanterns", atlasCell: 0, bounds: { x: 64.15, y: 47.3, width: 1.8, height: 2.2 } },
    { id: "gateworks-notice", atlasCell: 2, bounds: { x: 64.15, y: 42.3, width: 1.8, height: 1.7 } },
    { id: "gateworks-yard-trough", atlasCell: 11, bounds: { x: 73.1, y: 41.3, width: 1.8, height: 1.4 } },
    { id: "gateworks-store-crates", atlasCell: 9, bounds: { x: 72.1, y: 49.05, width: 2.4, height: 1.5 } },
    // The control assembly straddles the canal itself as a sluice mechanism;
    // it no longer reads as loose machinery abandoned in the public crossing.
    { id: "aqueduct-valve", atlasCell: 12, bounds: FIRST_PACT_AQUEDUCT_CIVIC_CROSSING.control },
] as const;

/** Low, irregular beds occupy the north civic setbacks without replacing the
 * shelf with a garden-ground rectangle. Their cells are the shared authority
 * for drawing, collision, and minimap massing. */
export const FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS = [
    { id: "lodge-west-grove", gardenCell: 2, gardenAsset: "corner", bounds: { x: 5, y: 10, width: 4, height: 3 }, collisionMask: ["....", "####", "####"] },
    { id: "lodge-east-bed", gardenCell: 3, gardenAsset: "long", bounds: { x: 11, y: 11, width: 4, height: 2 }, collisionMask: ["####", "####"] },
    { id: "hall-west-bed", gardenCell: 3, gardenAsset: "long", bounds: { x: 16, y: 11, width: 4, height: 2 }, collisionMask: ["####", "####"] },
    { id: "hall-east-grove", gardenCell: 2, gardenAsset: "corner", bounds: { x: 22, y: 10, width: 4, height: 3 }, collisionMask: ["....", "####", "####"] },
] as const;

/** Two transparent, broken-edged edge beds frame the public court without
 * blocking the central spine or replacing paving with a lawn rectangle. */
export const FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS = [
    { id: "court-west-herb-bed", gardenCell: 3, gardenAsset: "long", bounds: { x: 5, y: 14, width: 4, height: 2 }, collisionMask: ["####", "####"] },
    { id: "court-east-maple-bed", gardenCell: 2, gardenAsset: "corner", bounds: { x: 25, y: 17, width: 3, height: 3 }, collisionMask: ["...", "###", "###"] },
] as const;

export const FIRST_PACT_GARDENS_NORTH_PLANTING_CELLS: readonly FirstPactPoint[] = FIRST_PACT_GARDENS_NORTH_PLANTING_BEDS.flatMap(({ bounds, collisionMask }) =>
    collisionMask.flatMap((row, localY) => [...row].flatMap((cell, localX) => (
        cell === "#" ? [{ x: bounds.x + localX, y: bounds.y + localY }] : []
    ))),
);

export const FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_CELLS: readonly FirstPactPoint[] = FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_BEDS.flatMap(({ bounds, collisionMask }) =>
    collisionMask.flatMap((row, localY) => [...row].flatMap((cell, localX) => (
        cell === "#" ? [{ x: bounds.x + localX, y: bounds.y + localY }] : []
    ))),
);

/** Tree crowns may overlap roof eaves, but each trunk terminates in a planted,
 * collision-backed root cell rather than floating over walkable paving. */
export const FIRST_PACT_GARDENS_NORTH_TREES = [
    { id: "west-maple", gardenAsset: "maple-a", root: { x: 7, y: 11 }, bounds: { x: 4.35, y: 5.45, width: 5.2, height: 5.5 }, hue: -17, flip: false },
    { id: "hinge-maple", gardenAsset: "maple-b", root: { x: 13, y: 11 }, bounds: { x: 11.45, y: 6.45, width: 3.6, height: 4.45 }, hue: -23, flip: true },
    { id: "east-maple", gardenAsset: "maple-b", root: { x: 24, y: 11 }, bounds: { x: 22.4, y: 6.45, width: 3.6, height: 4.45 }, hue: -11, flip: false },
] as const;

/** Four compact, purpose-built archive gardens punctuate the court without
 * replacing its authored paving with broad decorative plates. The cell index
 * selects exact transparent art; the mask is shared by collision and minimap. */
export const FIRST_PACT_HIGH_COURT_GARDEN_BEDS = [
    { id: "west-marker-grove", gardenCell: 0, bounds: { x: 31, y: 2, width: 4, height: 3 }, collisionMask: [".##.", "####", "####"] },
    { id: "east-bonsai-garden", gardenCell: 1, bounds: { x: 50, y: 2, width: 4, height: 3 }, collisionMask: [".##.", "####", "####"] },
    { id: "west-lantern-garden", gardenCell: 2, bounds: { x: 37, y: 9, width: 4, height: 3 }, collisionMask: ["....", "####", "####"] },
    { id: "east-hedge-garden", gardenCell: 3, bounds: { x: 44, y: 9, width: 4, height: 3 }, collisionMask: ["#..#", "####", "####"] },
] as const;

export const FIRST_PACT_HIGH_COURT_GARDEN_CELLS: readonly FirstPactPoint[] = FIRST_PACT_HIGH_COURT_GARDEN_BEDS.flatMap(({ bounds, collisionMask }) =>
    collisionMask.flatMap((row, localY) => [...row].flatMap((cell, localX) => (
        cell === "#" ? [{ x: bounds.x + localX, y: bounds.y + localY }] : []
    ))),
);

/** A one-tile north parapet makes the raised archive shelf a closed civic
 * perimeter rather than an inaccessible strip of apparently walkable pavers. */
export const FIRST_PACT_HIGH_COURT_PARAPET = { bounds: { x: 30, y: 1, width: 25, height: 1 } } as const;
export const FIRST_PACT_HIGH_COURT_PARAPET_CELLS: readonly FirstPactPoint[] = Array.from(
    { length: FIRST_PACT_HIGH_COURT_PARAPET.bounds.width },
    (_, index) => ({ x: FIRST_PACT_HIGH_COURT_PARAPET.bounds.x + index, y: FIRST_PACT_HIGH_COURT_PARAPET.bounds.y }),
);

/**
 * Low planted setbacks separating Bell Quarter eaves from its public lanes.
 * The same cells drive drawing, collision, minimap massing, and the empty-lawn
 * contract, so decorative shrubs never become invisible walking shortcuts.
 */
export const FIRST_PACT_BELL_PLANTING_BEDS = [
    { id: "west-foundation", bounds: { x: 63, y: 6, width: 2, height: 6 }, salt: 1709 },
    { id: "east-foundation", bounds: { x: 71, y: 6, width: 2, height: 6 }, salt: 1783 },
    { id: "courier-foundation", bounds: { x: 64, y: 17, width: 2, height: 4 }, salt: 1871 },
    { id: "courtyard-grove", bounds: { x: 70, y: 17, width: 4, height: 3 }, salt: 1949 },
    { id: "upper-canal-bank", bounds: { x: 76, y: 16, width: 3, height: 3 }, salt: 2017 },
    { id: "lower-canal-bank", bounds: { x: 77, y: 20, width: 2, height: 3 }, salt: 2069 },
] as const;

export const FIRST_PACT_BELL_PLANTING_CELLS: readonly FirstPactPoint[] = FIRST_PACT_BELL_PLANTING_BEDS.flatMap(({ bounds }) =>
    Array.from({ length: bounds.width * bounds.height }, (_, index) => ({
        x: bounds.x + index % bounds.width,
        y: bounds.y + Math.floor(index / bounds.width),
    })),
);

const FIRST_PACT_BELL_PLANTING_COLLISION = new Set(FIRST_PACT_BELL_PLANTING_CELLS.map(({ x, y }) => indexOf(x, y)));
const FIRST_PACT_GARDENS_NORTH_PLANTING_COLLISION = new Set(FIRST_PACT_GARDENS_NORTH_PLANTING_CELLS.map(({ x, y }) => indexOf(x, y)));
const FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_COLLISION = new Set(FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_CELLS.map(({ x, y }) => indexOf(x, y)));
const FIRST_PACT_HIGH_COURT_GARDEN_COLLISION = new Set(FIRST_PACT_HIGH_COURT_GARDEN_CELLS.map(({ x, y }) => indexOf(x, y)));
const FIRST_PACT_HIGH_COURT_PARAPET_COLLISION = new Set(FIRST_PACT_HIGH_COURT_PARAPET_CELLS.map(({ x, y }) => indexOf(x, y)));

const FIRST_PACT_ARCHITECTURE_COLLISION = new Set<number>();
for (const placement of [...FIRST_PACT_ARCHITECTURE, ...FIRST_PACT_KENNEL_STRUCTURES]) {
    for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
        for (let localX = 0; localX < placement.collisionMask[localY].length; localX += 1) {
            if (placement.collisionMask[localY][localX] === "#") {
                FIRST_PACT_ARCHITECTURE_COLLISION.add(indexOf(placement.bounds.x + localX, placement.bounds.y + localY));
            }
        }
    }
}

const FIRST_PACT_PROP_COLLISION = new Set<number>();
for (const placement of FIRST_PACT_CITY_PROPS) {
    if (placement.collisionCells) {
        for (const point of placement.collisionCells) FIRST_PACT_PROP_COLLISION.add(indexOf(point.x, point.y));
        continue;
    }
    if (placement.collisionMask) {
        for (let localY = 0; localY < placement.collisionMask.length; localY += 1) {
            for (let localX = 0; localX < placement.collisionMask[localY].length; localX += 1) {
                if (placement.collisionMask[localY][localX] === "#") {
                    FIRST_PACT_PROP_COLLISION.add(indexOf(placement.bounds.x + localX, placement.bounds.y + localY));
                }
            }
        }
        continue;
    }
    FIRST_PACT_PROP_COLLISION.add(indexOf(
        Math.floor(placement.bounds.x + placement.bounds.width / 2),
        Math.floor(placement.bounds.y + placement.bounds.height / 2),
    ));
}

// Low masonry and hedge-backed service edges enclose the two rear market
// courts. They sit entirely outside the pale public spine and door approaches.
const FIRST_PACT_MARKET_SERVICE_EDGE_COLLISION = new Set([
    [60, 31], [61, 31], [62, 31],
    [69, 31], [70, 31], [71, 31], [72, 31], [73, 31],
].map(([x, y]) => indexOf(x, y)));

export const FIRST_PACT_PLAYER_START: FirstPactPoint = { x: 42, y: 50 };

export const FIRST_PACT_NPCS: readonly FirstPactNpcDefinition[] = [
    { id: "keeper-sena", name: "Sena Vale", title: "Last Keeper of Vale Stable", position: { x: 24, y: 40 }, behavior: "static", facing: "west", palette: "rose", portrait: "keeper" },
    { id: "registrar-orin", name: "Registrar Orin", title: "Master of the Sand Ledger", position: { x: 42, y: 34 }, behavior: "static", facing: "south", palette: "amber", portrait: "registrar" },
    { id: "scribe-vey", name: "Scribe Vey", title: "Keeper of Unedited Names", position: { x: 42, y: 12 }, behavior: "static", facing: "south", palette: "cyan", portrait: "scribe" },
    { id: "bellwarden-isu", name: "Isu", title: "Bell Warden", position: { x: 68, y: 16 }, behavior: "static", facing: "west", palette: "jade", portrait: "citizen" },
    { id: "engineer-tam", name: "Tam", title: "Gateworks Engineer", position: { x: 73, y: 46 }, behavior: "static", facing: "west", palette: "cyan", portrait: "engineer" },
    { id: "market-rho", name: "Rho", title: "Feed Merchant", position: { x: 67, y: 34 }, behavior: "static", facing: "east", palette: "amber", portrait: "merchant" },
    { id: "kennel-hand", name: "Pell", title: "Stable Hand", position: { x: 18, y: 40 }, behavior: "wander", wanderBounds: { x: 17, y: 39, width: 9, height: 4 }, facing: "east", palette: "jade", portrait: "citizen" },
    { id: "court-courier", name: "Nemi", title: "Court Courier", position: { x: 74, y: 17 }, behavior: "wander", wanderBounds: { x: 74, y: 13, width: 1, height: 10 }, facing: "south", palette: "rose", portrait: "citizen" },
    { id: "garden-keeper", name: "Old Kaio", title: "Garden Keeper", position: { x: 18, y: 16 }, behavior: "wander", wanderBounds: { x: 14, y: 13, width: 12, height: 13 }, facing: "west", palette: "slate", portrait: "citizen" },
    { id: "market-runner", name: "Yori", title: "Market Runner", position: { x: 62, y: 30 }, behavior: "wander", wanderBounds: { x: 56, y: 24, width: 22, height: 15 }, facing: "east", palette: "amber", portrait: "citizen" },
];

export function firstPactTileAt(x: number, y: number): FirstPactTile {
    if (!inBounds(x, y)) return FirstPactTile.Void;
    return tiles[indexOf(x, y)] as FirstPactTile;
}

export function firstPactTileSnapshot(): Uint8Array {
    return tiles.slice();
}

/** Mossed public routes inside Bell Quarter, including its west approach. */
export function isFirstPactBellRoute(x: number, y: number): boolean {
    return x >= 54 && x <= 79 && y >= 12 && y <= 23 && firstPactTileAt(x, y) === FirstPactTile.Road;
}

export function isFirstPactBellPlanting(x: number, y: number): boolean {
    return inBounds(x, y) && FIRST_PACT_BELL_PLANTING_COLLISION.has(indexOf(x, y));
}

export function isFirstPactGardensNorthPlanting(x: number, y: number): boolean {
    return inBounds(x, y) && FIRST_PACT_GARDENS_NORTH_PLANTING_COLLISION.has(indexOf(x, y));
}

export function isFirstPactGardensPublicCourtPlanting(x: number, y: number): boolean {
    return inBounds(x, y) && FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_COLLISION.has(indexOf(x, y));
}

export function isFirstPactWalkable(x: number, y: number): boolean {
    const tile = firstPactTileAt(x, y);
    return tile !== FirstPactTile.Void
        && tile !== FirstPactTile.Water
        && tile !== FirstPactTile.Roof
        && tile !== FirstPactTile.Wall
        && !FIRST_PACT_ARCHITECTURE_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_PROP_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_BELL_PLANTING_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_GARDENS_NORTH_PLANTING_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_GARDENS_PUBLIC_COURT_PLANTING_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_HIGH_COURT_GARDEN_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_HIGH_COURT_PARAPET_COLLISION.has(indexOf(x, y))
        && !FIRST_PACT_MARKET_SERVICE_EDGE_COLLISION.has(indexOf(x, y));
}

const CARDINALS: readonly FirstPactPoint[] = [
    { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
];

function pointKey(point: FirstPactPoint): number {
    return indexOf(point.x, point.y);
}

/** Finds the closest legal avatar tile when a saved checkpoint predates a map
 * revision or now overlaps a static actor. Search order is deterministic. */
export function nearestFirstPactWalkable(
    point: FirstPactPoint,
    blocked: ReadonlySet<number> = new Set(),
): FirstPactPoint | null {
    const start = {
        x: Math.max(0, Math.min(FIRST_PACT_WORLD_WIDTH - 1, Math.floor(point.x))),
        y: Math.max(0, Math.min(FIRST_PACT_WORLD_HEIGHT - 1, Math.floor(point.y))),
    };
    const queue: FirstPactPoint[] = [start];
    const visited = new Uint8Array(FIRST_PACT_WORLD_WIDTH * FIRST_PACT_WORLD_HEIGHT);
    visited[pointKey(start)] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (isFirstPactWalkable(current.x, current.y) && !blocked.has(pointKey(current))) return current;
        for (const step of CARDINALS) {
            const next = { x: current.x + step.x, y: current.y + step.y };
            if (!inBounds(next.x, next.y)) continue;
            const key = pointKey(next);
            if (visited[key]) continue;
            visited[key] = 1;
            queue.push(next);
        }
    }
    return null;
}

/** Short local flood used by interactions so Manhattan-near actors cannot be
 * addressed through architecture, water, or any other collision tile. */
export function isFirstPactWithinReach(
    start: FirstPactPoint,
    target: FirstPactPoint,
    maxSteps = 2,
): boolean {
    if (!isFirstPactWalkable(start.x, start.y) || !isFirstPactWalkable(target.x, target.y)) return false;
    const limit = Math.max(0, Math.floor(maxSteps));
    const queue: Array<{ point: FirstPactPoint; steps: number }> = [{ point: start, steps: 0 }];
    const visited = new Set<number>([pointKey(start)]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (current.point.x === target.x && current.point.y === target.y) return true;
        if (current.steps >= limit) continue;
        for (const step of CARDINALS) {
            const next = { x: current.point.x + step.x, y: current.point.y + step.y };
            const key = pointKey(next);
            if (visited.has(key) || !isFirstPactWalkable(next.x, next.y)) continue;
            visited.add(key);
            queue.push({ point: next, steps: current.steps + 1 });
        }
    }
    return false;
}

/** A* over the same four-direction tile grid the avatar occupies. */
export function findFirstPactPath(
    start: FirstPactPoint,
    goal: FirstPactPoint,
    blocked: ReadonlySet<number> = new Set(),
): FirstPactPoint[] {
    if (!isFirstPactWalkable(start.x, start.y) || !isFirstPactWalkable(goal.x, goal.y)) return [];
    if (start.x === goal.x && start.y === goal.y) return [];

    const open: FirstPactPoint[] = [start];
    const openKeys = new Set([pointKey(start)]);
    const cameFrom = new Map<number, number>();
    const g = new Map<number, number>([[pointKey(start), 0]]);

    while (open.length) {
        let bestIndex = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < open.length; i += 1) {
            const point = open[i];
            const score = (g.get(pointKey(point)) ?? Number.POSITIVE_INFINITY)
                + Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
            if (score < bestScore) { bestIndex = i; bestScore = score; }
        }
        const current = open.splice(bestIndex, 1)[0];
        const currentKey = pointKey(current);
        openKeys.delete(currentKey);
        if (current.x === goal.x && current.y === goal.y) {
            const reversed: FirstPactPoint[] = [goal];
            let cursor = currentKey;
            while (cameFrom.has(cursor)) {
                cursor = cameFrom.get(cursor)!;
                const x = cursor % FIRST_PACT_WORLD_WIDTH;
                const y = Math.floor(cursor / FIRST_PACT_WORLD_WIDTH);
                reversed.push({ x, y });
            }
            reversed.reverse();
            return reversed.slice(1);
        }
        for (const step of CARDINALS) {
            const next = { x: current.x + step.x, y: current.y + step.y };
            const nextKey = pointKey(next);
            if (!isFirstPactWalkable(next.x, next.y) || blocked.has(nextKey)) continue;
            const tentative = (g.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
            if (tentative >= (g.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
            cameFrom.set(nextKey, currentKey);
            g.set(nextKey, tentative);
            if (!openKeys.has(nextKey)) { open.push(next); openKeys.add(nextKey); }
        }
    }
    return [];
}

function hashSeed(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
    return hash >>> 0;
}

function nextSeed(value: number): number {
    return (Math.imul(value, 1664525) + 1013904223) >>> 0;
}

/** Picks a reachable destination inside the NPC's authored roaming pen. */
export function chooseFirstPactWanderDestination(
    npc: FirstPactNpcDefinition,
    from: FirstPactPoint,
    cycle: number,
): FirstPactPoint | null {
    const bounds = npc.wanderBounds;
    if (npc.behavior !== "wander" || !bounds) return null;
    let seed = hashSeed(`${npc.id}:${cycle}`);
    for (let attempt = 0; attempt < 32; attempt += 1) {
        seed = nextSeed(seed);
        const x = bounds.x + (seed % Math.max(1, bounds.width));
        seed = nextSeed(seed);
        const y = bounds.y + (seed % Math.max(1, bounds.height));
        if ((x === from.x && y === from.y) || !isFirstPactWalkable(x, y)) continue;
        if (findFirstPactPath(from, { x, y }).length) return { x, y };
    }
    return null;
}

export function firstPactPointKey(point: FirstPactPoint): number {
    return pointKey(point);
}
