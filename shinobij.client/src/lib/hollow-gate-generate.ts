/**
 * Hollow Gate — coherent floor generator (rooms + MST corridors + ROOM-ROLE
 * content). ONE consistent style varied by per-floor parameters.
 *
 * Pipeline (per docs/hollow-gate-loop.md research — Nystrom connectivity + TinyKeep
 * connection graph + RogueBasin Dijkstra-map content):
 *   1. Rooms        — BSP leaves → chunky, non-overlapping chambers (rooms fill
 *                     most of their leaf so the floor reads as REAL rooms, not
 *                     scattered closets — Zelda-DS dungeon scale on the 25×17 grid).
 *   2. Corridors    — Prim's MINIMUM SPANNING TREE over room centres + L-corridors,
 *                     so every room joins its NEAREST neighbours (no x-sorted
 *                     crossing corridors), then 0-1 extra edge for a single loop.
 *   3. Connectivity — BFS from spawn; carve a repair corridor to any unreached room.
 *                     GUARANTEED connected (vs the old "bail and ship disconnected").
 *   4. Doors        — one door per corridor↔room seam (fog-of-war "what's behind it").
 *   5. Content      — ROOM ROLES, not scatter. Every room gets a job and its
 *                     content matches the job:
 *                       · entrance  — the spawn chamber, always safe
 *                       · stair     — descend/boss, its doorway guarded by an elite
 *                       · treasury  — the most private room: locked vault door,
 *                                     clustered chests + a shard vein inside, a
 *                                     trap taxing the approach corridor
 *                       · sanctum   — shrine + story tablet share a chamber
 *                       · keeper    — the Shrine Keeper's quiet alcove
 *                       · guard     — everything else; battles hold doorways and
 *                                     corridor junctions (chokepoints), not random
 *                                     open floor
 *                     Tile COUNTS are unchanged from the legacy generators — this
 *                     improves WHERE things are, not how much there is.
 *   6. Invariants   — assert exit + descend reachable; else regenerate (cheap).
 *
 * Pure. Same output shape + tile kinds/terrains + content counts as the legacy
 * generators (balance unchanged — this improves STRUCTURE, not rates). Throws only
 * if every attempt fails (caller falls back to the maze generator).
 */
import { bspSplit, bspRoomCenter, bspCarveCorridor, hollowGateReachableSet, type BSPRect } from "./hollow-gate-bsp";
import { pickRoomTheme } from "../data/hollow-gate-atlas";
import { HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import type { HollowGateShrineRun, HollowGateTile, HollowGateTileKind, HollowGateTerrain } from "../types/character";

const CARD: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Optional grid dimensions — event-gate variants pass a smaller board; the
 *  standard shrine constants apply when omitted. */
export type HollowGateFloorDims = { width: number; height: number };

/** Public entry: a fully-connected, intentionally-laid-out floor. Retries a few
 *  times if an invariant fails (regenerate-on-invalid is microseconds at 425 cells). */
export function generateHollowGateFloor(floor: number, isFinalFloor: boolean, dims?: HollowGateFloorDims, rng: () => number = Math.random): HollowGateShrineRun {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const run = tryGenerateFloor(floor, isFinalFloor, dims, rng);
        if (run) return run;
    }
    throw new Error("hollow-gate floor generation failed after retries");
}

/** Carve a chunky chamber inside a BSP leaf: rooms fill ~70-100% of the padded
 *  leaf so chambers feel like ROOMS (the shared bspRoomInNode carves down to 3×3,
 *  which read as closets on the big grid). */
function chamberInLeaf(node: BSPRect, rng: () => number): BSPRect {
    const pad = 1;
    const availW = Math.max(3, node.w - pad * 2);
    const availH = Math.max(3, node.h - pad * 2);
    const minW = Math.max(3, Math.ceil(availW * 0.7));
    const minH = Math.max(3, Math.ceil(availH * 0.7));
    const roomW = minW + Math.floor(rng() * Math.max(1, availW - minW + 1));
    const roomH = minH + Math.floor(rng() * Math.max(1, availH - minH + 1));
    const roomX = node.x + pad + Math.floor(rng() * Math.max(1, node.w - pad * 2 - roomW + 1));
    const roomY = node.y + pad + Math.floor(rng() * Math.max(1, node.h - pad * 2 - roomH + 1));
    return { x: roomX, y: roomY, w: roomW, h: roomH };
}

function tryGenerateFloor(floor: number, isFinalFloor: boolean, dims: HollowGateFloorDims | undefined, rng: () => number): HollowGateShrineRun | null {
    const w = dims?.width ?? HOLLOW_GATE_SHRINE_W;
    const h = dims?.height ?? HOLLOW_GATE_SHRINE_H;
    const total = w * h;
    const at = (x: number, y: number) => y * w + x;

    // ── 1. Rooms via BSP leaves ──────────────────────────────────────────────
    // Depth 3 on 25×17 yields ~6-8 chunky leaves; deeper floors sometimes split
    // once more for a busier, tighter warren. minLeaf 6 keeps every leaf big
    // enough for a real chamber. Compact (event-variant) boards ease both knobs
    // so a 15×11 floor still carves 3-5 real rooms instead of failing retries.
    const compact = w < 20 || h < 13;
    const splitDepth = 3 + (floor >= 3 && !compact && rng() < 0.4 ? 1 : 0);
    const leaves = bspSplit({ x: 0, y: 0, w, h }, splitDepth, compact ? 5 : 6, rng).filter((l) => l.w >= 5 && l.h >= 5);
    const rooms: BSPRect[] = leaves.map((leaf) => chamberInLeaf(leaf, rng));
    if (rooms.length < (compact ? 3 : 4)) return null; // too few rooms → retry

    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    const roomIds: number[] = new Array(total).fill(-1);
    rooms.forEach((r, ri) => {
        for (let y = r.y; y < r.y + r.h; y += 1) {
            for (let x = r.x; x < r.x + r.w; x += 1) {
                if (x >= 0 && y >= 0 && x < w && y < h) { terrain[at(x, y)] = "room_floor"; roomIds[at(x, y)] = ri; }
            }
        }
    });

    const centers = rooms.map(bspRoomCenter);
    const dist2 = (a: number, b: number) => Math.abs(centers[a].x - centers[b].x) + Math.abs(centers[a].y - centers[b].y);

    // ── 2. Connect rooms — Prim's MST over centres + L-corridors (nearest-
    //       neighbour, so corridors don't cross), then one extra edge for a loop.
    const inTree = new Set<number>([0]);
    const treeEdges: Array<[number, number]> = [];
    while (inTree.size < rooms.length) {
        let bestFrom = -1, bestTo = -1, bestD = Infinity;
        for (const a of inTree) {
            for (let b = 0; b < rooms.length; b += 1) {
                if (inTree.has(b)) continue;
                const d = dist2(a, b);
                if (d < bestD) { bestD = d; bestFrom = a; bestTo = b; }
            }
        }
        if (bestTo < 0) break;
        treeEdges.push([bestFrom, bestTo]);
        inTree.add(bestTo);
    }
    for (const [a, b] of treeEdges) bspCarveCorridor(terrain, w, centers[a], centers[b], rng);

    // One loop: shortest non-tree edge → a single cycle (tactical "go around").
    if (rooms.length >= 3 && rng() < 0.7) {
        const hasEdge = (a: number, b: number) => treeEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        let la = -1, lb = -1, lD = Infinity;
        for (let a = 0; a < rooms.length; a += 1) {
            for (let b = a + 1; b < rooms.length; b += 1) {
                if (hasEdge(a, b)) continue;
                const d = dist2(a, b);
                if (d < lD) { lD = d; la = a; lb = b; }
            }
        }
        if (la >= 0) bspCarveCorridor(terrain, w, centers[la], centers[lb], rng);
    }

    // ── Spawn (leftmost room) — needed before the connectivity flood ──────────
    let spawnRoom = 0;
    for (let i = 1; i < rooms.length; i += 1) if (centers[i].x < centers[spawnRoom].x) spawnRoom = i;
    const spawnIdx = at(centers[spawnRoom].x, centers[spawnRoom].y);

    // ── 3. Connectivity guarantee — carve a repair corridor to any unreached
    //       room centre until the whole floor floods from spawn. ────────────────
    ensureConnected(terrain, w, h, centers, spawnIdx, rng);

    // ── 4. Doors at corridor↔room seams (one entry per corridor end) ─────────
    markDoors(terrain, w, h, total);

    // ── 5. Distance map from spawn over walkable terrain ─────────────────────
    const dist = bfsDistances(terrain, w, h, spawnIdx);
    const reachable = (i: number) => dist[i] >= 0;

    // Descend/boss = the DEEPEST reachable room cell (long critical path). Exit
    // (Leave) = the farthest reachable room cell in a DIFFERENT room — a real detour.
    const roomCellsByDepth: number[] = [];
    for (let i = 0; i < total; i += 1) if (terrain[i] === "room_floor" && reachable(i) && i !== spawnIdx) roomCellsByDepth.push(i);
    roomCellsByDepth.sort((a, b) => dist[b] - dist[a]);
    if (roomCellsByDepth.length < 2) return null;
    const targetIdx = roomCellsByDepth[0];
    const targetRoom = roomIds[targetIdx];
    const exitIdx = roomCellsByDepth.find((i) => roomIds[i] !== targetRoom && roomIds[i] !== roomIds[spawnIdx]) ?? roomCellsByDepth[1];

    // ── 6. Content layer — room roles, not scatter ────────────────────────────
    const kinds: HollowGateTileKind[] = new Array(total).fill("empty");
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") kinds[i] = "wall";
    const reserved = new Set<number>([spawnIdx, exitIdx, targetIdx]);
    kinds[exitIdx] = "exit";
    kinds[targetIdx] = isFinalFloor ? "boss" : "descend";

    // Spawn safety: spawn + cardinal neighbours stay empty.
    const protectedCells = new Set<number>([spawnIdx]);
    for (const [dx, dy] of CARD) {
        const nx = centers[spawnRoom].x + dx, ny = centers[spawnRoom].y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && terrain[at(nx, ny)] !== "wall") protectedCells.add(at(nx, ny));
    }

    // Critical path spawn→descend (roll downhill from the target).
    const onPath = criticalPath(dist, w, h, targetIdx, spawnIdx);

    const walkableNeighbors = (i: number) => {
        const x = i % w, y = Math.floor(i / w);
        let n = 0;
        for (const [dx, dy] of CARD) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && terrain[ny * w + nx] !== "wall") n += 1; }
        return n;
    };

    // ── Room roles ────────────────────────────────────────────────────────────
    // door cells belong to their room (markDoors converts the seam ROOM cell).
    const doorsOfRoom = (ri: number): number[] => {
        const out: number[] = [];
        for (let i = 0; i < total; i += 1) if (terrain[i] === "door" && roomIds[i] === ri) out.push(i);
        return out;
    };
    const cellsOfRoom = (ri: number): number[] => {
        const out: number[] = [];
        for (let i = 0; i < total; i += 1) if (roomIds[i] === ri && terrain[i] === "room_floor" && reachable(i)) out.push(i);
        return out;
    };
    const stairRoomId = targetRoom;
    const exitRoomId = roomIds[exitIdx];
    const roomTouchesPath = (ri: number) => cellsOfRoom(ri).some((i) => onPath.has(i)) || doorsOfRoom(ri).some((i) => onPath.has(i));

    // Special rooms come from the rooms with no other job. "Privacy" ranks them:
    // fewest doors first (dead-end chambers), then deepest — the vault hides at
    // the back of the floor, not beside the entrance.
    const spareRooms: number[] = [];
    for (let ri = 0; ri < rooms.length; ri += 1) {
        if (ri === spawnRoom || ri === stairRoomId) continue;
        if (cellsOfRoom(ri).length < 4) continue;
        spareRooms.push(ri);
    }
    spareRooms.sort((a, b) => {
        const doorDiff = doorsOfRoom(a).length - doorsOfRoom(b).length;
        if (doorDiff !== 0) return doorDiff;
        const depth = (ri: number) => Math.max(0, ...cellsOfRoom(ri).map((i) => dist[i]));
        return depth(b) - depth(a);
    });
    // Rooms that still have a job after the special picks host the guard fights.
    // The exit room may be picked as a special room (the Leave seal sharing a
    // vault/sanctum is fine — both are "reward" chambers); the treasury pick
    // prefers a room that ISN'T the exit room when one exists.
    const treasuryRoomId = spareRooms.find((ri) => ri !== exitRoomId && !roomTouchesPath(ri))
        ?? spareRooms.find((ri) => ri !== exitRoomId)
        ?? spareRooms[0] ?? -1;
    const afterTreasury = spareRooms.filter((ri) => ri !== treasuryRoomId);
    const sanctumRoomId = afterTreasury.find((ri) => !roomTouchesPath(ri)) ?? afterTreasury[0] ?? -1;
    const afterSanctum = afterTreasury.filter((ri) => ri !== sanctumRoomId);
    // Keeper prefers a calm room in the SHALLOW half — met early, like a hub NPC.
    const keeperRoomId = [...afterSanctum].sort((a, b) => {
        const depth = (ri: number) => Math.min(...cellsOfRoom(ri).map((i) => dist[i]));
        return depth(a) - depth(b);
    })[0] ?? -1;
    const guardRoomIds = afterSanctum.filter((ri) => ri !== keeperRoomId);

    // Greedy placement with BFS-grid spacing (anti-clump). Candidates are pre-
    // filtered + ordered by the caller; we place up to `count`, then top up from a
    // looser pool so the floor never ends up content-starved.
    const placedByKind: Record<string, number[]> = {};
    function place(kind: HollowGateTileKind, count: number, pool: number[], minGap: number): number {
        const mine = placedByKind[kind] ?? (placedByKind[kind] = []);
        let placed = 0;
        for (const i of pool) {
            if (placed >= count) break;
            if (reserved.has(i) || protectedCells.has(i) || kinds[i] !== "empty") continue;
            if (minGap > 0 && mine.some((p) => manhattan(p, i, w) < minGap)) continue;
            kinds[i] = kind; mine.push(i); placed += 1;
        }
        return placed;
    }
    const shuffle = (a: number[]) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const allReachable = (pred: (i: number) => boolean) => {
        const out: number[] = [];
        for (let i = 0; i < total; i += 1) if (reachable(i) && pred(i)) out.push(i);
        return out;
    };
    const roomCells = allReachable((i) => terrain[i] === "room_floor");
    const corridorCells = allReachable((i) => terrain[i] === "corridor_floor");
    const doorCells = allReachable((i) => terrain[i] === "door");
    const deadEnds = allReachable((i) => (terrain[i] === "corridor_floor" || terrain[i] === "room_floor") && walkableNeighbors(i) <= 1);
    const deepFirst = (cells: number[]) => [...cells].sort((a, b) => dist[b] - dist[a]);
    const offPath = (cells: number[]) => cells.filter((i) => !onPath.has(i));
    const notSpawnRoom = (cells: number[]) => cells.filter((i) => roomIds[i] !== spawnRoom);
    // The entrance chamber is a SAFE room: no hostiles ever spawn in it.
    const hostileSafe = (cells: number[]) => notSpawnRoom(cells);

    // Content grows with depth. Battles ramp to floor 5 then plateau at 9 (the
    // deep floors are dense but still crossable); elites + traps keep climbing
    // (floor 5 → 3 elites, 5 traps) so the full five-floor descent stays tense.
    const battleCount = 4 + Math.min(5, floor);
    const eliteCount = 1 + Math.floor(floor / 2);
    const trapCount = 3 + Math.floor(floor / 2);
    const chestCount = 3;
    const veinCount = 1 + Math.floor(floor / 2);

    // ── Stair guardian: an elite HOLDS the stair room's main doorway ─────────
    const stairDoors = doorsOfRoom(stairRoomId);
    const stairMainDoor = stairDoors.find((i) => onPath.has(i)) ?? stairDoors[0];
    let elitesPlaced = 0;
    if (stairMainDoor != null) elitesPlaced += place("elite", 1, [stairMainDoor], 0);
    // Remaining elites patrol the deep guard rooms, well-spaced.
    const guardRoomCells = guardRoomIds.flatMap(cellsOfRoom);
    elitesPlaced += place("elite", eliteCount - elitesPlaced, deepFirst(hostileSafe([...guardRoomCells, ...cellsOfRoom(stairRoomId)])), 4);
    place("elite", eliteCount - elitesPlaced, deepFirst(hostileSafe(roomCells)), 4); // top-up

    // ── Battles hold chokepoints: doorways of rooms on the path + corridor
    //    junctions — fights that GUARD passage instead of loitering in corners.
    const junctions = corridorCells.filter((i) => walkableNeighbors(i) >= 3);
    const pathDoors = doorCells.filter((i) => onPath.has(i) || CARD.some(([dx, dy]) => onPath.has(((Math.floor(i / w) + dy) * w + (i % w + dx)))));
    const chokepoints = shuffle(hostileSafe([...pathDoors, ...junctions]));
    let battlesPlaced = place("battle", Math.ceil(battleCount * 0.6), chokepoints, 3);
    battlesPlaced += place("battle", battleCount - battlesPlaced, shuffle(hostileSafe(guardRoomCells)), 2);
    place("battle", battleCount - battlesPlaced, shuffle(hostileSafe([...roomCells, ...corridorCells])), 2); // top-up

    // ── Treasury: a locked vault door, chest hoard + shard vein inside ───────
    const treasuryCells = treasuryRoomId >= 0 ? cellsOfRoom(treasuryRoomId) : [];
    const treasuryDoors = treasuryRoomId >= 0 ? doorsOfRoom(treasuryRoomId) : [];
    let chestsPlaced = 0;
    let veinsPlaced = 0;
    if (treasuryRoomId >= 0 && treasuryCells.length >= 3) {
        // The vault door: the treasury's main entrance carries the `locked` seal
        // (needs a Shrine Key — the classic locked-treasure-room beat). Reward
        // tiles cluster in the corner FARTHEST from that door (the hoard).
        const vaultDoor = treasuryDoors.find((i) => !onPath.has(i)) ?? treasuryDoors[0];
        if (vaultDoor != null && treasuryDoors.length <= 1) {
            // Only seal single-entrance vaults — never lock a room the critical
            // path or the connectivity loop may route through.
            place("locked", 1, [vaultDoor], 0);
        } else {
            place("locked", 1, deepFirst(offPath(treasuryCells)), 0);
        }
        const hoardAnchor = deepFirst(treasuryCells)[0];
        const nearHoard = [...treasuryCells].sort((a, b) => manhattan(a, hoardAnchor, w) - manhattan(b, hoardAnchor, w));
        chestsPlaced += place("chest", 2, nearHoard, 1);
        veinsPlaced += place("shard_vein", 1, nearHoard, 1);
    } else {
        place("locked", 1, deepFirst(offPath(roomCells)), 1);
    }
    // Remaining chest rewards exploration: dead-end alcoves and deep off-path rooms.
    chestsPlaced += place("chest", chestCount - chestsPlaced, shuffle([...offPath(deadEnds), ...deepFirst(offPath(roomCells))]), 2);
    place("chest", chestCount - chestsPlaced, shuffle(roomCells), 2); // top-up
    veinsPlaced += place("shard_vein", veinCount - veinsPlaced, shuffle(offPath(notSpawnRoom(roomCells))), 3);
    place("shard_vein", veinCount - veinsPlaced, shuffle(roomCells), 2); // top-up

    // ── Sanctum: the shrine + story tablet share one chamber of lore ─────────
    const sanctumCells = sanctumRoomId >= 0 ? cellsOfRoom(sanctumRoomId) : [];
    let shrinesPlaced = 0;
    let storiesPlaced = 0;
    if (sanctumCells.length >= 2) {
        const sanctumHeart = deepFirst(sanctumCells)[0];
        const nearHeart = [...sanctumCells].sort((a, b) => manhattan(a, sanctumHeart, w) - manhattan(b, sanctumHeart, w));
        shrinesPlaced = place("shrine", 1, nearHeart, 0);
        storiesPlaced = place("story", 1, nearHeart, 1);
    }
    place("shrine", 1 - shrinesPlaced, deepFirst(roomCells), 0);   // top-up
    place("story", 1 - storiesPlaced, shuffle(roomCells), 0);      // top-up

    // ── Keeper: a quiet alcove met on the shallow half of the floor ──────────
    const keeperCells = keeperRoomId >= 0 ? cellsOfRoom(keeperRoomId) : [];
    const keeperPlaced = place("npc", 1, shuffle(offPath(keeperCells)), 0);
    place("npc", 1 - keeperPlaced, shuffle(roomCells), 3);         // top-up

    // ── Traps punish greed and wrong turns: the vault approach, dead-end
    //    alcoves, then off-path corridor stretches. Never on the main line's
    //    doorways (battles own those).
    const vaultApproach: number[] = [];
    for (const d of treasuryDoors) {
        const x = d % w, y = Math.floor(d / w);
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && terrain[at(nx, ny)] === "corridor_floor") vaultApproach.push(at(nx, ny));
        }
    }
    let trapsPlaced = place("trap", 1, shuffle(hostileSafe(vaultApproach)), 0);
    trapsPlaced += place("trap", Math.ceil(trapCount * 0.6) - trapsPlaced, shuffle(hostileSafe(deadEnds)), 2);
    place("trap", trapCount - trapsPlaced, shuffle(hostileSafe(offPath(corridorCells))), 2);

    // ── 7. Invariants — exit + descend wall-reachable from spawn ──────────────
    const walls = wallSet(terrain);
    const reach = hollowGateReachableSet(w, h, spawnIdx, walls);
    if (!reach.has(exitIdx) || !reach.has(targetIdx)) return null; // regenerate
    // The locked vault door must never gate the exit or the stairs: re-check
    // reachability with locked tiles ALSO blocking (keys are optional loot).
    const lockedSet = new Set<number>(walls);
    for (let i = 0; i < total; i += 1) if (kinds[i] === "locked") lockedSet.add(i);
    const reachSansLocked = hollowGateReachableSet(w, h, spawnIdx, lockedSet);
    if (!reachSansLocked.has(exitIdx) || !reachSansLocked.has(targetIdx)) return null; // regenerate

    // ── 8. Decorations + assemble ────────────────────────────────────────────
    const seed = Math.floor(rng() * 0x7fffffff);
    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        decoration: (terrain[i] === "room_floor" && kind === "empty" && !reserved.has(i) && !protectedCells.has(i) && rng() < 0.12) ? Math.floor(rng() * 4) : undefined,
        revealed: i === spawnIdx,
        resolved: i === spawnIdx,
        flavor: i === spawnIdx ? "You stand at the threshold of the Hollow Gate Shrine." : undefined,
    }));
    const roomThemes: Record<number, string> = {};
    for (let ri = 0; ri < rooms.length; ri += 1) roomThemes[ri] = pickRoomTheme(ri, floor, seed);

    return {
        width: w, height: h,
        playerX: centers[spawnRoom].x, playerY: centers[spawnRoom].y,
        tiles, floor, threat: 0, torch: 10, keys: 0, completed: false, roomThemes, seed,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function manhattan(a: number, b: number, w: number): number {
    return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
}

function wallSet(terrain: HollowGateTerrain[]): Set<number> {
    const s = new Set<number>();
    for (let i = 0; i < terrain.length; i += 1) if (terrain[i] === "wall") s.add(i);
    return s;
}

/** BFS step-distance from `start` over non-wall terrain. -1 = unreachable. */
function bfsDistances(terrain: HollowGateTerrain[], w: number, h: number, start: number): number[] {
    const dist = new Array(w * h).fill(-1);
    dist[start] = 0;
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head]; head += 1;
        const x = idx % w, y = Math.floor(idx / w);
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (dist[ni] >= 0 || terrain[ni] === "wall") continue;
            dist[ni] = dist[idx] + 1;
            queue.push(ni);
        }
    }
    return dist;
}

/** Carve repair corridors until every room centre floods from spawn. */
function ensureConnected(terrain: HollowGateTerrain[], w: number, h: number, centers: Array<{ x: number; y: number }>, spawnIdx: number, rng: () => number): void {
    for (let pass = 0; pass <= centers.length; pass += 1) {
        const reach = hollowGateReachableSet(w, h, spawnIdx, wallSet(terrain));
        let unreached = -1;
        for (let i = 0; i < centers.length; i += 1) {
            if (!reach.has(centers[i].y * w + centers[i].x)) { unreached = i; break; }
        }
        if (unreached < 0) return; // fully connected
        // Carve from the unreached centre to the nearest reachable cell.
        let target = -1, bestD = Infinity;
        for (const r of reach) {
            const d = Math.abs((r % w) - centers[unreached].x) + Math.abs(Math.floor(r / w) - centers[unreached].y);
            if (d < bestD) { bestD = d; target = r; }
        }
        if (target < 0) return;
        bspCarveCorridor(terrain, w, centers[unreached], { x: target % w, y: Math.floor(target / w) }, rng);
    }
}

/** Mark exactly one room cell as a door per corridor end that touches a room. */
function markDoors(terrain: HollowGateTerrain[], w: number, h: number, total: number): void {
    const touched = new Set<number>();
    for (let i = 0; i < total; i += 1) {
        if (terrain[i] !== "corridor_floor") continue;
        const x = i % w, y = Math.floor(i / w);
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (terrain[ni] === "room_floor" && !touched.has(ni)) { terrain[ni] = "door"; touched.add(ni); }
        }
    }
}

/** The spawn→target mainline: from target, repeatedly step to a neighbour with
 *  dist-1 (roll downhill) until spawn. Returns the set of indices on the path. */
function criticalPath(dist: number[], w: number, h: number, targetIdx: number, spawnIdx: number): Set<number> {
    const path = new Set<number>([targetIdx]);
    let cur = targetIdx;
    let guard = 0;
    while (cur !== spawnIdx && guard < w * h) {
        guard += 1;
        const x = cur % w, y = Math.floor(cur / w);
        let next = -1;
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (dist[ni] >= 0 && dist[ni] === dist[cur] - 1) { next = ni; break; }
        }
        if (next < 0) break;
        path.add(next);
        cur = next;
    }
    return path;
}
