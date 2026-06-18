/**
 * Hollow Gate shrine — procedural dungeon generation.
 *
 * Parses the hand-designed ASCII room layouts and, as a fallback, generates
 * a BSP dungeon; computes per-floor visibility, rolls ancient-chest loot, and
 * picks encounter pets. Extracted verbatim from App.tsx with no behavior
 * change. The BSP + reachability primitives live in ./hollow-gate-bsp.
 *
 * HOLLOW_GATE_MAX_FLOOR is a live binding imported from ../App (runtime-tunable
 * from the admin panel) and read lazily inside the generator, mirroring the
 * existing combat-math.ts / bloodline.ts pattern.
 */
import { hollowGateReachableSet, bspSplit, bspRoomInNode, bspRoomCenter, bspCarveCorridor, type BSPRect } from "./hollow-gate-bsp";
import { pickRoomTheme } from "../data/hollow-gate-atlas";
import { HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import { petTreatItems, petRarityOrder } from "../data/pet-config";
import { starterItems } from "../data/starter-items";
import { cloneEncounterPet } from "./pet-balance";
import { HOLLOW_GATE_MAX_FLOOR } from "../App";
import type { HollowGateShrineRun, HollowGateTile, HollowGateTileKind, HollowGateTerrain } from "../types/character";
import type { Pet, PetRarity } from "../types/pet";

// ── Hand-designed ASCII layouts ─────────────────────────────────────────
//
// Each entry is a multi-line string parsed by `parseHollowGateLayout`.
// Symbols (case-sensitive):
//   #   wall (impassable)
//   .   room floor — lights up the whole connected room when entered
//   ,   corridor floor — single-tile visibility
//   +   door (walkable; just decorative)
//   P   spawn (room_floor underneath)            — exactly one per layout
//   X   exit / leave tile (room_floor underneath) — exactly one per layout
//   T   target — boss on F5, descend stairs F1-4  — exactly one per layout
//   t   torch decoration   (room_floor underneath)
//   b   barrel decoration  (room_floor underneath)
//   p   plant decoration   (room_floor underneath)
//   s   skull decoration   (room_floor underneath)
//
// Rules:
// - Width auto-derived from the longest row; shorter rows are right-padded
//   with '#'. So every row doesn't need to be the same length.
// - Reachability (spawn→exit AND spawn→target) is validated; layouts that
//   fail validation are silently skipped and the next one is tried. If none
//   parse, the BSP generator runs as a fallback.
// - To add a layout, just append another string to this array — no other
//   code change required.
const HOLLOW_GATE_LAYOUTS: string[] = [
    // ── 1. Hollow Threshold ────────────────────────────────────────────
    // Three rooms: spawn top-left, target top-right, exit bottom.
    // Two doors funnel into the main east-west corridor.
`###############
#.t...#......t#
#.....+.......#
#..P..#...T...#
#....s#......b#
###+#######+###
#,,,,,,,,,,,,,#
#####+##+######
#...........t.#
#.X..p........#
###############`,

    // ── 2. Crossroads ──────────────────────────────────────────────────
    // Six small rooms in a 3×2 grid around a central east-west corridor.
`###############
#.....#...#...#
#..P..+.t.+.T.#
#.....#...#...#
######+...+####
#,,,,,,,,,,,,,#
######+...+####
#.....#...#...#
#.X.s.+.b.+.p.#
#.....#...#...#
###############`,

    // ── 3. The Loop ────────────────────────────────────────────────────
    // Outer corridor frames a central chamber holding the target.
    // Bottom row has three small rooms (spawn / mid / exit).
`###############
#,,,,,,,,,,,,,#
#,#####+#####,#
#,#.........#,#
#,+....T....+,#
#,#.........#,#
#,#####+#####,#
#,,,,,,,,,,,,,#
###+###,###+###
#.P.#...#...X.#
###############`,
];

type ParsedHollowGateLayout = {
    width: number;
    height: number;
    terrain: HollowGateTerrain[];
    roomIds: number[];      // -1 for non-room tiles
    decorations: number[];  // -1 for none, 0-3 otherwise
    spawnIdx: number;
    exitIdx: number;
    targetIdx: number;
};

// Post-process pass run by both generators: enforce "no door leads to a wall".
// A door is a transition between two walkable cells (room ↔ corridor or
// room ↔ room). If a door has exactly one room neighbour and walls on all
// other sides, it visually leads nowhere — confusing and unfair.
//
// Fix policy: convert the wall cell directly opposite the room into a
// single-tile floor alcove + stamp a random surprise on it (poison trap /
// ambush battle / elite / chest). The alcove gets its own unique roomId
// so the visibility flood treats it as its own pocket; the player has to
// step onto the door first, then onto the alcove to discover what's there.
//
// Edge cases:
// - Door on the grid edge with nowhere to expand → close the door (wall it up)
// - Door with multiple room neighbours (room↔room door) → leave alone
// - Door with any corridor neighbour → leave alone (it leads somewhere)
// - Island door (no walkable neighbours at all) → close the door
function fixDoorsLeadingToWalls(
    width: number,
    height: number,
    terrain: HollowGateTerrain[],
    roomIds: number[],
    kinds: HollowGateTileKind[],
    reserved: Set<number>,
): void {
    let nextRoomId = roomIds.reduce((max, id) => Math.max(max, id), -1) + 1;
    const total = width * height;
    const cardinals: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    // dirs: 0=N, 1=S, 2=W, 3=E. Opposite pairs: 0↔1, 2↔3.
    const oppositeDir = (d: number) => d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2;

    for (let i = 0; i < total; i += 1) {
        if (terrain[i] !== "door") continue;
        const x = i % width;
        const y = Math.floor(i / width);

        const roomSides: number[] = [];
        const corridorSides: number[] = [];
        for (let d = 0; d < 4; d += 1) {
            const [dx, dy] = cardinals[d];
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const t = terrain[ny * width + nx];
            if (t === "room_floor") roomSides.push(d);
            else if (t === "corridor_floor" || t === "door") corridorSides.push(d);
        }

        if (corridorSides.length > 0) continue;         // leads to a corridor — fine
        if (roomSides.length === 0) {                    // island door — close it
            terrain[i] = "wall";
            kinds[i] = "wall";
            continue;
        }
        if (roomSides.length >= 2) continue;             // between two rooms — fine

        // Single room neighbour + walls on the other 3 sides. Carve an alcove.
        const opp = oppositeDir(roomSides[0]);
        const [odx, ody] = cardinals[opp];
        const ox = x + odx, oy = y + ody;
        if (ox < 0 || oy < 0 || ox >= width || oy >= height) {
            // Outside the grid — close the door instead.
            terrain[i] = "wall";
            kinds[i] = "wall";
            continue;
        }
        const oIdx = oy * width + ox;
        if (terrain[oIdx] !== "wall") continue;          // already walkable somehow

        terrain[oIdx] = "room_floor";
        roomIds[oIdx] = nextRoomId;
        nextRoomId += 1;

        // Stamp content on the alcove. Skip if the cell was already reserved by
        // spawn/exit/target (should never happen since walls are excluded from
        // reservations, but defensive). Mix favours traps so blind-doors punish
        // greed; chest is the small reward stinger.
        if (!reserved.has(oIdx)) {
            const roll = Math.random();
            const kind: HollowGateTileKind = roll < 0.40 ? "trap"      // poison
                : roll < 0.75 ? "battle"                                // ambush
                : roll < 0.90 ? "elite"                                  // tougher ambush
                : "chest";                                                // small reward
            kinds[oIdx] = kind;
            reserved.add(oIdx);
        }
    }
}

export function parseHollowGateLayout(ascii: string): ParsedHollowGateLayout | null {
    const lines = ascii.split("\n").map(l => l.replace(/\s+$/, ""));
    while (lines.length && lines[0].length === 0) lines.shift();
    while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
    if (lines.length < 3) return null;
    const width = Math.max(...lines.map(l => l.length));
    const height = lines.length;
    if (width < 3) return null;

    const total = width * height;
    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    const decorations: number[] = new Array(total).fill(-1);
    let spawnIdx = -1;
    let exitIdx = -1;
    let targetIdx = -1;

    for (let y = 0; y < height; y += 1) {
        const row = lines[y].padEnd(width, "#");
        for (let x = 0; x < width; x += 1) {
            const ch = row[x];
            const i = y * width + x;
            switch (ch) {
                case ".": terrain[i] = "room_floor"; break;
                case ",": terrain[i] = "corridor_floor"; break;
                case "+": terrain[i] = "door"; break;
                case "P": terrain[i] = "room_floor"; spawnIdx = i; break;
                case "X": terrain[i] = "room_floor"; exitIdx = i; break;
                case "T": terrain[i] = "room_floor"; targetIdx = i; break;
                case "t": terrain[i] = "room_floor"; decorations[i] = 0; break;
                case "b": terrain[i] = "room_floor"; decorations[i] = 1; break;
                case "p": terrain[i] = "room_floor"; decorations[i] = 2; break;
                case "s": terrain[i] = "room_floor"; decorations[i] = 3; break;
                // '#' and any unknown symbol fall through to wall.
                default: terrain[i] = "wall"; break;
            }
        }
    }
    if (spawnIdx < 0 || exitIdx < 0 || targetIdx < 0) return null;

    // Flood-fill connected room_floor regions to assign roomIds. Each blob of
    // room_floor cells separated from others by walls/corridors/doors gets a
    // unique id — the renderer uses this to light up the whole room when the
    // player steps in.
    const roomIds: number[] = new Array(total).fill(-1);
    let nextRoom = 0;
    for (let i = 0; i < total; i += 1) {
        if (terrain[i] !== "room_floor" || roomIds[i] >= 0) continue;
        const id = nextRoom;
        nextRoom += 1;
        const stack: number[] = [i];
        while (stack.length) {
            const cur = stack.pop()!;
            if (roomIds[cur] >= 0) continue;
            roomIds[cur] = id;
            const cx = cur % width;
            const cy = Math.floor(cur / width);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const nIdx = ny * width + nx;
                if (terrain[nIdx] === "room_floor" && roomIds[nIdx] < 0) stack.push(nIdx);
            }
        }
    }

    // Validate reachability with walls as the only blockers (doors and
    // corridors are walkable). Skip layouts where spawn can't reach exit/target.
    const wallSet = new Set<number>();
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") wallSet.add(i);
    const reachable = hollowGateReachableSet(width, height, spawnIdx, wallSet);
    if (!reachable.has(exitIdx) || !reachable.has(targetIdx)) return null;

    return { width, height, terrain, roomIds, decorations, spawnIdx, exitIdx, targetIdx };
}

// Overlay battle/trap/chest/etc. content on top of a parsed layout's terrain.
// Same content rules as the BSP generator — keeps the dungeon experience
// consistent regardless of whether geometry came from a layout or BSP.
export function buildRunFromParsedLayout(
    parsed: ParsedHollowGateLayout,
    floor: number,
    isFinalFloor: boolean,
): HollowGateShrineRun {
    const { width: w, height: h, terrain, roomIds, decorations, spawnIdx, exitIdx, targetIdx } = parsed;
    const total = w * h;

    const kinds: HollowGateTileKind[] = new Array(total).fill("empty");
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") kinds[i] = "wall";

    const reserved = new Set<number>([spawnIdx, exitIdx, targetIdx]);
    kinds[exitIdx] = "exit";
    kinds[targetIdx] = isFinalFloor ? "boss" : "descend";

    const playerX = spawnIdx % w;
    const playerY = Math.floor(spawnIdx / w);
    const protectedRadius = new Set<number>([spawnIdx]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = playerX + dx;
        const ny = playerY + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            const nIdx = ny * w + nx;
            if (terrain[nIdx] !== "wall") protectedRadius.add(nIdx);
        }
    }

    function placeIn(allowedTerrains: HollowGateTerrain[], kind: HollowGateTileKind, count: number) {
        let placed = 0;
        let safety = 0;
        while (placed < count && safety < 400) {
            safety += 1;
            const idx = Math.floor(Math.random() * total);
            if (reserved.has(idx) || protectedRadius.has(idx)) continue;
            if (kinds[idx] !== "empty") continue;
            if (!allowedTerrains.includes(terrain[idx])) continue;
            kinds[idx] = kind;
            placed += 1;
        }
    }

    const battleCount = 4 + Math.min(3, floor);
    const trapCount = 3 + Math.floor(floor / 2);

    function walkableNeighbors(idx: number): number {
        const x = idx % w;
        const y = Math.floor(idx / w);
        let n = 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (terrain[ny * w + nx] !== "wall") n += 1;
        }
        return n;
    }
    function placeTrapsAtDeadEnds(maxTraps: number): number {
        const deadEnds: number[] = [];
        for (let i = 0; i < total; i += 1) {
            if (reserved.has(i) || protectedRadius.has(i)) continue;
            if (kinds[i] !== "empty") continue;
            if (terrain[i] !== "corridor_floor" && terrain[i] !== "room_floor") continue;
            if (walkableNeighbors(i) <= 1) deadEnds.push(i);
        }
        deadEnds.sort(() => Math.random() - 0.5);
        let placed = 0;
        for (const idx of deadEnds) {
            if (placed >= maxTraps) break;
            kinds[idx] = "trap";
            placed += 1;
        }
        return placed;
    }
    const deadEndTrapsPlaced = placeTrapsAtDeadEnds(Math.ceil(trapCount * 0.67));

    placeIn(["room_floor", "corridor_floor"], "battle", battleCount);
    // pet_battle / tile_game walk-on tiles retired — those encounters now come
    // only from the threat ambush. Their slots become Shard Veins (below).
    placeIn(["room_floor", "corridor_floor"], "trap", Math.max(0, trapCount - deadEndTrapsPlaced));
    placeIn(["room_floor"], "elite", 1 + Math.floor(floor / 2));
    placeIn(["room_floor"], "chest", 3);
    // pet_event tile: deprecated. The old "glowing pawprints" flavor tile
    // was atmospheric-only with no reward — superseded by pet_battle for
    // real pet content. Kind kept in the union for legacy saved-run
    // compatibility but the generator no longer places new ones.
    // placeIn(["room_floor"], "pet_event", 1);  // removed
    placeIn(["room_floor"], "shrine", 1);
    placeIn(["room_floor"], "story", 1);
    placeIn(["room_floor"], "shard_vein", 1 + Math.floor(floor / 2));   // Hollow Shard caches (F1=1 … F5=3)
    placeIn(["room_floor"], "locked", 1);
    placeIn(["room_floor"], "npc", 1);

    // Rule: no door leads to a wall. Convert any dead-end door's wall-side
    // into a 1-tile alcove stamped with trap/battle/elite/chest.
    // (Layouts often have hand-placed doors; this fixes accidental dead-ends.)
    // Mutates terrain / roomIds / kinds / reserved in place — that's why the
    // arrays from the parser are reused downstream untouched by this call.
    fixDoorsLeadingToWalls(w, h, terrain, roomIds, kinds, reserved);

    // BFS validate spawn → exit AND spawn → target with locked tiles blocking.
    // Same logic as the BSP generator — relocate the offending locked tile if
    // it sits on the only path.
    function locateLockedTiles(): number[] {
        const out: number[] = [];
        for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === "locked") out.push(i);
        return out;
    }
    function freeRoomCells(): number[] {
        const out: number[] = [];
        for (let i = 0; i < kinds.length; i += 1) {
            if (kinds[i] === "empty" && !reserved.has(i) && terrain[i] === "room_floor") out.push(i);
        }
        return out;
    }
    let attempts = 0;
    while (attempts < 12) {
        attempts += 1;
        const locked = locateLockedTiles();
        const wallBlockers = new Set<number>();
        for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") wallBlockers.add(i);
        const blocked = new Set<number>([...locked, ...wallBlockers]);
        const reachable = hollowGateReachableSet(w, h, spawnIdx, blocked);
        if (reachable.has(exitIdx) && reachable.has(targetIdx)) break;
        const free = freeRoomCells();
        if (locked.length > 0 && free.length > 0) {
            kinds[locked[0]] = "empty";
            kinds[free[Math.floor(Math.random() * free.length)]] = "locked";
            continue;
        }
        break;
    }

    // Respect layout-supplied decorations, then sprinkle a few more on empty
    // room cells that didn't get one explicitly. Same density as BSP path.
    const finalDecorations: number[] = [...decorations];
    for (let i = 0; i < total; i += 1) {
        if (terrain[i] !== "room_floor") continue;
        if (finalDecorations[i] >= 0) continue;
        if (kinds[i] !== "empty") continue;
        if (reserved.has(i) || protectedRadius.has(i)) continue;
        if (Math.random() < 0.12) finalDecorations[i] = Math.floor(Math.random() * 4);
    }

    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        decoration: finalDecorations[i] >= 0 ? finalDecorations[i] : undefined,
        revealed: i === spawnIdx,
        resolved: i === spawnIdx,
        flavor: i === spawnIdx ? "You stand at the threshold of the Hollow Gate Shrine." : undefined,
    }));

    // Stamp each room with a deterministic theme. Same room within the run
    // keeps its theme, but the run's seed shuffles which theme each room gets.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const roomThemes: Record<number, string> = {};
    const uniqueRoomIds = new Set(roomIds.filter(id => id >= 0));
    for (const rid of uniqueRoomIds) {
        roomThemes[rid] = pickRoomTheme(rid, floor, seed);
    }

    return {
        width: w,
        height: h,
        playerX,
        playerY,
        tiles,
        floor,
        threat: 0,
        torch: 10,
        keys: 0,
        completed: false,
        roomThemes,
        seed,
    };
}

export function generateHollowGateShrineRun(floor = 1): HollowGateShrineRun {
    const isFinalFloor = floor >= HOLLOW_GATE_MAX_FLOOR;

    // Random-maze dungeon (owner preference — the branching-wings generator in
    // lib/hollow-gate-wings is kept but no longer the default). For more per-run
    // variety, ~half the floors use a fresh procedural BSP maze and ~half use a
    // shuffled hand-authored maze layout. The wing-aware UI/mechanics safely
    // no-op on these floors (no wingThemes → no tint, door labels, or sealing).
    if (Math.random() < 0.5) {
        const shuffled = [...HOLLOW_GATE_LAYOUTS].sort(() => Math.random() - 0.5);
        for (const layoutSrc of shuffled) {
            const parsed = parseHollowGateLayout(layoutSrc);
            if (parsed) return buildRunFromParsedLayout(parsed, floor, isFinalFloor);
        }
    }
    // Procedural BSP maze — random rooms + corridors, fresh every run.
    return generateHollowGateShrineRunBSP(floor);
}

function generateHollowGateShrineRunBSP(floor = 1): HollowGateShrineRun {
    const w = HOLLOW_GATE_SHRINE_W;
    const h = HOLLOW_GATE_SHRINE_H;
    const total = w * h;
    const isFinalFloor = floor >= HOLLOW_GATE_MAX_FLOOR;

    // ── 1. BSP partition the grid into 5-7 rooms ──────────────────────────
    const rootNode: BSPRect = { x: 0, y: 0, w, h };
    // 3-4 levels of splits on a 15×11 grid produce ~5-7 leaves.
    const splitDepth = 3;
    const minLeaf = 4; // each leaf is at least 4×4 so rooms fit comfortably
    const leaves = bspSplit(rootNode, splitDepth, minLeaf);
    // Drop tiny leaves (BSP can over-split when grid is unbalanced).
    const usableLeaves = leaves.filter(l => l.w >= 4 && l.h >= 4);
    const rooms = usableLeaves.map(bspRoomInNode);

    // ── 2. Initialize terrain to all walls ────────────────────────────────
    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    // Parallel array tagging each cell with its room ID (-1 = wall / corridor).
    // The renderer uses this to light up the entire current room when the
    // player walks into it, without revealing what's beyond doors.
    const roomIds: number[] = new Array(total).fill(-1);

    // Carve room floors and stamp each cell with the room index.
    rooms.forEach((room, roomIndex) => {
        for (let ry = room.y; ry < room.y + room.h; ry += 1) {
            for (let rx = room.x; rx < room.x + room.w; rx += 1) {
                if (rx >= 0 && ry >= 0 && rx < w && ry < h) {
                    const idx = ry * w + rx;
                    terrain[idx] = "room_floor";
                    roomIds[idx] = roomIndex;
                }
            }
        }
    });

    // ── 2b. Cut corners off rooms to break up the all-rectangles look ──
    // 15% chance per corner of a single-tile cut. Bigger cuts (or higher
    // chance) made rooms unidentifiable as rooms.
    rooms.forEach((room) => {
        if (room.w < 4 || room.h < 4) return;
        const corners: Array<[number, number]> = [
            [room.x, room.y],                                 // top-left
            [room.x + room.w - 1, room.y],                    // top-right
            [room.x, room.y + room.h - 1],                    // bottom-left
            [room.x + room.w - 1, room.y + room.h - 1],       // bottom-right
        ];
        for (const [cx, cy] of corners) {
            if (Math.random() >= 0.15) continue;
            if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
            const idx = cy * w + cx;
            if (terrain[idx] === "room_floor") {
                terrain[idx] = "wall";
                roomIds[idx] = -1;
            }
        }
    });

    // ── 3. Connect adjacent rooms with corridors ──────────────────────────
    // Sort rooms by center x then y, then connect each to the next so every
    // room is reachable. (Not the prettiest tour but reliably connected.)
    const sortedRooms = [...rooms].sort((a, b) => {
        const ca = bspRoomCenter(a);
        const cb = bspRoomCenter(b);
        return ca.x !== cb.x ? ca.x - cb.x : ca.y - cb.y;
    });
    for (let i = 0; i + 1 < sortedRooms.length; i += 1) {
        bspCarveCorridor(terrain, w, bspRoomCenter(sortedRooms[i]), bspRoomCenter(sortedRooms[i + 1]));
    }
    // Add 1-2 extra random connections so the layout isn't a strict chain.
    const extraConnections = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < extraConnections && rooms.length >= 2; i += 1) {
        const a = rooms[Math.floor(Math.random() * rooms.length)];
        const b = rooms[Math.floor(Math.random() * rooms.length)];
        if (a !== b) bspCarveCorridor(terrain, w, bspRoomCenter(a), bspRoomCenter(b));
    }

    // ── 4. Mark doors where corridors enter rooms ────────────────────────
    // Old logic converted EVERY room-floor cell that touched a corridor into
    // a door — for a 4-tile-wide room edge this produced 4 adjacent door
    // tiles, which read as a "wall of doors" rather than a doorway.
    // New rule: a room-floor cell becomes a door ONLY if it is the unique
    // entry point — i.e. the corridor cell is adjacent and that corridor
    // cell does not extend further into the room. We process each corridor
    // endpoint and mark exactly one room cell as the door.
    {
        const corridorEndsTouchingRoom = new Set<number>();
        for (let i = 0; i < total; i += 1) {
            if (terrain[i] !== "corridor_floor") continue;
            const x = i % w;
            const y = Math.floor(i / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (terrain[nIdx] === "room_floor") {
                    // Only the FIRST room cell each corridor end touches becomes
                    // a door — subsequent room cells stay as room floor.
                    if (!corridorEndsTouchingRoom.has(nIdx)) {
                        terrain[nIdx] = "door";
                        corridorEndsTouchingRoom.add(nIdx);
                    }
                }
            }
        }
    }

    // ── 5. Pick spawn, exit (leave), and target (boss / descend) rooms ──
    if (rooms.length === 0) {
        // Defensive: BSP failed to produce rooms (shouldn't happen at 15×11).
        // Fall back to a single big room covering the grid.
        for (let i = 0; i < total; i += 1) {
            terrain[i] = "room_floor";
            roomIds[i] = 0;
        }
        rooms.push({ x: 1, y: 1, w: w - 2, h: h - 2 });
    }

    // Spawn = first room in left-to-right order.
    const spawnRoom = [...rooms].sort((a, b) => a.x - b.x)[0];
    const spawnCenter = bspRoomCenter(spawnRoom);
    const playerX = spawnCenter.x;
    const playerY = spawnCenter.y;
    const spawnIdx = playerY * w + playerX;

    // Exit/Leave = room farthest from spawn.
    function distRoom(r: BSPRect): number {
        const c = bspRoomCenter(r);
        return Math.abs(c.x - playerX) + Math.abs(c.y - playerY);
    }
    const remainingRooms = rooms.filter(r => r !== spawnRoom);
    const sortedByDist = [...remainingRooms].sort((a, b) => distRoom(b) - distRoom(a));
    const leaveRoom = sortedByDist[0] ?? spawnRoom;
    const leaveCenter = bspRoomCenter(leaveRoom);
    const exitIdx = leaveCenter.y * w + leaveCenter.x;

    // Target room (boss on F5, descend on F1-4) = second-farthest, distinct
    // from spawn AND leave. Fall back to mid-distance if needed.
    const targetCandidates = remainingRooms.filter(r => r !== leaveRoom);
    const targetRoom = targetCandidates[Math.floor(targetCandidates.length / 2)] ?? leaveRoom;
    const targetCenter = bspRoomCenter(targetRoom);
    const targetIdx = targetCenter.y * w + targetCenter.x;

    // ── 6. Now build the content layer (kinds) on top of terrain ─────────
    const kinds: HollowGateTileKind[] = new Array(total).fill("empty");
    // Walls map to kind "wall" so existing event/movement code keeps working.
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") kinds[i] = "wall";

    const reserved = new Set<number>([spawnIdx, exitIdx, targetIdx]);
    kinds[exitIdx] = "exit";
    kinds[targetIdx] = isFinalFloor ? "boss" : "descend";

    // Spawn safety: spawn cell + 4 cardinal neighbors stay empty (no content,
    // no walls — though walls were already excluded by the room shape).
    const protectedRadius = new Set<number>([spawnIdx]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = playerX + dx;
        const ny = playerY + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
            const nIdx = ny * w + nx;
            if (terrain[nIdx] !== "wall") protectedRadius.add(nIdx);
        }
    }

    // ── 7. Place content tiles ────────────────────────────────────────────
    // Room-only content: chest, npc, story, pet_event, shrine, locked, elite.
    // Corridor-eligible: battle, trap (+ dead-end bias).
    function placeIn(allowedTerrains: HollowGateTerrain[], kind: HollowGateTileKind, count: number) {
        let placed = 0;
        let safety = 0;
        while (placed < count && safety < 400) {
            safety += 1;
            const idx = Math.floor(Math.random() * total);
            if (reserved.has(idx) || protectedRadius.has(idx)) continue;
            if (kinds[idx] !== "empty") continue;
            if (!allowedTerrains.includes(terrain[idx])) continue;
            kinds[idx] = kind;
            placed += 1;
        }
    }

    const battleCount = 4 + Math.min(3, floor);
    const trapCount = 3 + Math.floor(floor / 2);

    // Dead-end trap bias: corridors with only 1 walkable neighbor are natural
    // ambush points. Bias most traps there so a wrong turn at a corridor fork
    // punishes the player.
    function walkableNeighbors(idx: number): number {
        const x = idx % w;
        const y = Math.floor(idx / w);
        let n = 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (terrain[ny * w + nx] !== "wall") n += 1;
        }
        return n;
    }
    function placeTrapsAtDeadEnds(maxTraps: number): number {
        const deadEnds: number[] = [];
        for (let i = 0; i < total; i += 1) {
            if (reserved.has(i) || protectedRadius.has(i)) continue;
            if (kinds[i] !== "empty") continue;
            // Only corridor cells and small room corners qualify as dead-ends.
            if (terrain[i] !== "corridor_floor" && terrain[i] !== "room_floor") continue;
            if (walkableNeighbors(i) <= 1) deadEnds.push(i);
        }
        deadEnds.sort(() => Math.random() - 0.5);
        let placed = 0;
        for (const idx of deadEnds) {
            if (placed >= maxTraps) break;
            kinds[idx] = "trap";
            placed += 1;
        }
        return placed;
    }
    const deadEndTrapsPlaced = placeTrapsAtDeadEnds(Math.ceil(trapCount * 0.67));

    // Battles can be in rooms (guards) or corridors (ambushes).
    placeIn(["room_floor", "corridor_floor"], "battle", battleCount);
    // Remaining traps fill anywhere walkable.
    placeIn(["room_floor", "corridor_floor"], "trap", Math.max(0, trapCount - deadEndTrapsPlaced));
    // Room-only content: feels like guarded loot / shrines.
    placeIn(["room_floor"], "elite", 1 + Math.floor(floor / 2));
    placeIn(["room_floor"], "chest", 3);
    // pet_event tile: deprecated. The old "glowing pawprints" flavor tile
    // was atmospheric-only with no reward — superseded by pet_battle for
    // real pet content. Kind kept in the union for legacy saved-run
    // compatibility but the generator no longer places new ones.
    // placeIn(["room_floor"], "pet_event", 1);  // removed
    placeIn(["room_floor"], "shrine", 1);
    placeIn(["room_floor"], "story", 1);
    placeIn(["room_floor"], "shard_vein", 1 + Math.floor(floor / 2));   // Hollow Shard caches (F1=1 … F5=3)
    placeIn(["room_floor"], "locked", 1);
    placeIn(["room_floor"], "npc", 1);    // Shrine Keeper — one per floor

    // Rule: no door leads to a wall. BSP corridors usually terminate cleanly
    // at room edges so this is mostly a safety net for irregular cuts, but
    // it also adds extra reward/risk pockets behind doors that would
    // otherwise lead nowhere.
    fixDoorsLeadingToWalls(w, h, terrain, roomIds, kinds, reserved);

    // ── 8. BFS path-validation: spawn → exit + spawn → target ─────────────
    // Walls always block; locked tiles also block (player needs a Shrine Key).
    // Doors are walkable (they're just decorative thresholds).
    function locateLockedTiles() {
        const out: number[] = [];
        for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === "locked") out.push(i);
        return out;
    }
    function freeRoomCells(): number[] {
        const out: number[] = [];
        for (let i = 0; i < kinds.length; i += 1) {
            if (kinds[i] === "empty" && !reserved.has(i) && terrain[i] === "room_floor") out.push(i);
        }
        return out;
    }
    let attempts = 0;
    while (attempts < 12) {
        attempts += 1;
        const lockedIndices = locateLockedTiles();
        const wallBlockers = new Set<number>();
        for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") wallBlockers.add(i);
        const blocked = new Set<number>([...lockedIndices, ...wallBlockers]);
        const reachable = hollowGateReachableSet(w, h, spawnIdx, blocked);
        const exitOk = reachable.has(exitIdx);
        const targetOk = reachable.has(targetIdx);
        if (exitOk && targetOk) break;
        // Relocate one offending locked tile if it's blocking the path.
        const free = freeRoomCells();
        if (lockedIndices.length > 0 && free.length > 0) {
            const offending = lockedIndices[0];
            kinds[offending] = "empty";
            kinds[free[Math.floor(Math.random() * free.length)]] = "locked";
            continue;
        }
        // If walls are blocking, the BSP is broken — bail and accept the run.
        break;
    }

    // ── 8b. Sprinkle decorations on empty room cells ───────────────────
    // ~12% of empty room cells get a random decoration index (0-3). Purely
    // visual — no event, no block, just breaks up the floor monotony.
    const decorationOf: number[] = new Array(total).fill(-1);
    for (let i = 0; i < total; i += 1) {
        if (terrain[i] !== "room_floor") continue;
        if (kinds[i] !== "empty") continue;          // don't put decos on content tiles
        if (reserved.has(i) || protectedRadius.has(i)) continue;
        if (Math.random() < 0.12) {
            decorationOf[i] = Math.floor(Math.random() * 4);
        }
    }

    // ── 9. Build the final tile array, attaching kind / terrain / roomId ──
    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        decoration: decorationOf[i] >= 0 ? decorationOf[i] : undefined,
        revealed: i === spawnIdx, // spawn revealed
        resolved: i === spawnIdx,
        flavor: i === spawnIdx ? "You stand at the threshold of the Hollow Gate Shrine." : undefined,
    }));

    // Per-room theme assignment — same logic as the layout-based builder so
    // BSP runs also benefit from themed terrain when slots are assigned.
    const bspSeed = Math.floor(Math.random() * 0x7fffffff);
    const bspRoomThemes: Record<number, string> = {};
    for (let i = 0; i < rooms.length; i += 1) {
        bspRoomThemes[i] = pickRoomTheme(i, floor, bspSeed);
    }

    return {
        width: w,
        height: h,
        playerX,
        playerY,
        tiles,
        floor,
        threat: 0,
        torch: 10,
        keys: 0,
        completed: false,
        roomThemes: bspRoomThemes,
        seed: bspSeed,
    };
}

// ── Room-flood visibility ───────────────────────────────────────────────────
// Builds the set of tiles currently lit up around the player.
//
// Rules (matches your "light up the section you're in but not behind doors"
// request):
//   • Player's tile is always visible.
//   • If the player is standing IN a room (tile has roomId), the entire room
//     lights up at once — every cell with the same roomId becomes visible.
//   • Doors at the edge of the lit room are visible (you can see the doorway),
//     but vision STOPS at the door — what's beyond stays fogged. This is what
//     makes choosing the wrong door risky.
//   • If the player is in a corridor (no roomId), vision flood-fills along
//     the corridor in all four directions until it hits a wall or a door.
//     Doors at the end of a corridor are visible but don't reveal beyond.
//   • Walls are NEVER walkable, but neighboring walls of a lit room ARE shown
//     so the room reads as a discrete chamber (its walls trace the perimeter).
export function computeHollowGateVisible(run: HollowGateShrineRun): Set<number> {
    const w = run.width;
    const h = run.height;
    const playerIdx = run.playerY * w + run.playerX;
    const playerTile = run.tiles[playerIdx];
    const visible = new Set<number>([playerIdx]);
    if (!playerTile) return visible;

    function addWallsAroundLitTiles() {
        // Reveal the wall tiles that border any currently-lit cell so each
        // room's perimeter is visible from the inside.
        const litSnapshot = [...visible];
        for (const idx of litSnapshot) {
            const x = idx % w;
            const y = Math.floor(idx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (run.tiles[nIdx]?.terrain === "wall") visible.add(nIdx);
            }
        }
    }

    if (playerTile.roomId != null) {
        // Standing in a room — light up every cell of that room + bordering doors.
        for (let i = 0; i < run.tiles.length; i += 1) {
            if (run.tiles[i]?.roomId === playerTile.roomId) visible.add(i);
        }
        // Add doors adjacent to lit room cells (doors are 'room_floor' typed
        // as 'door' terrain — they belong to the same roomId).
        // They're already included above. But we also want to reveal doors
        // that border the room from the corridor side; check cardinal neighbours.
        const litSnapshot = [...visible];
        for (const idx of litSnapshot) {
            const x = idx % w;
            const y = Math.floor(idx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (run.tiles[nIdx]?.terrain === "door") visible.add(nIdx);
            }
        }
        addWallsAroundLitTiles();
        return visible;
    }

    // Standing in a corridor (or undefined terrain on legacy runs).
    // Flood-fill: walk in 4 directions through corridor cells until we hit
    // a wall or a door. Doors themselves get added but don't propagate further.
    const queue: number[] = [playerIdx];
    while (queue.length > 0) {
        const idx = queue.shift()!;
        const x = idx % w;
        const y = Math.floor(idx / w);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (visible.has(nIdx)) continue;
            const nTile = run.tiles[nIdx];
            if (!nTile) continue;
            if (nTile.terrain === "wall") continue; // walls handled at the end
            if (nTile.terrain === "door") {
                visible.add(nIdx);
                continue; // can see the door, but vision stops here
            }
            if (nTile.terrain === "corridor_floor" || nTile.terrain == null) {
                visible.add(nIdx);
                queue.push(nIdx);
            }
            // If we somehow reach a room_floor (legacy runs without doors
            // between corridor and room), reveal one tile but don't flood
            // the whole room from a corridor position.
            if (nTile.terrain === "room_floor") {
                visible.add(nIdx);
            }
        }
    }
    addWallsAroundLitTiles();
    return visible;
}

// Module-level Ancient Chest roll for the Hollow Gate Shrine. Mirrors the
// WorldMap rollAncientChest behavior but is callable from the App-level shrine
// handler. Floor scales the XP/ryo equivalent of the original "sector" input.
type HollowGateChestLoot = {
    xp: number;
    ryo?: number;
    itemId?: string;
    fateShards?: number;
    boneCharms?: number;
    auraStones?: number;
    auraDust?: number;
};

export function rollHollowGateAncientChest(floor: number): HollowGateChestLoot {
    // Treat floor as a "sector equivalent" of 30–50 so chests feel meaningful
    // at any shrine depth.
    const sectorEq = 25 + floor * 5;
    const xp = 50 + Math.floor(sectorEq * 2);
    const ryo = Math.random() < 0.5 ? 100 + Math.floor(Math.random() * 401) : undefined;

    const lootRoll = Math.random();
    let itemId: string | undefined;
    let fateShards: number | undefined;
    let boneCharms: number | undefined;
    let auraStones: number | undefined;
    const auraDust = Math.random() < 0.2 ? 5 + Math.floor(Math.random() * 11) : undefined;

    if (lootRoll < 0.2) {
        const treat = petTreatItems[Math.floor(Math.random() * petTreatItems.length)];
        itemId = treat?.id;
    } else if (lootRoll < 0.55) {
        const commons = starterItems.filter((i) => i.rarity === "common" && i.slot !== "item");
        if (commons.length) itemId = commons[Math.floor(Math.random() * commons.length)].id;
    } else if (lootRoll < 0.65) {
        const rares = starterItems.filter((i) => i.rarity === "rare" && i.slot !== "item");
        if (rares.length) itemId = rares[Math.floor(Math.random() * rares.length)].id;
    } else if (lootRoll < 0.92) {
        // 27% — tile cards are skipped here (shrine doesn't expose card UI),
        // so we promote them into extra currencies for variety.
        fateShards = 1;
    } else if (lootRoll < 0.97) {
        fateShards = 1;
    } else if (lootRoll < 0.99) {
        boneCharms = 1;
    } else {
        auraStones = 1;
    }
    return { xp, ryo, itemId, fateShards, boneCharms, auraStones, auraDust };
}

// Pick a random pet from the player's available pool (editablePets) of the
// given rarity, falling back to lower rarities if no template of that rarity
// exists. Returns a cloned encounter copy ready to befriend.
export function pickHollowGateEncounterPet(pets: Pet[], rarity: PetRarity): Pet | null {
    const rarityIndex = petRarityOrder.indexOf(rarity);
    const fallbackRarities = petRarityOrder.slice(0, rarityIndex + 1).reverse();
    for (const fallback of fallbackRarities) {
        const pool = pets.filter((pet) => pet.rarity === fallback);
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        if (chosen) return cloneEncounterPet(chosen);
    }
    return null;
}
