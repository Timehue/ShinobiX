/**
 * Hollow Gate — coherent floor generator (rooms + MST corridors + distance-map
 * content). ONE consistent style varied by per-floor parameters, replacing the old
 * three-styles-at-random roll (which is what made layouts "not make sense").
 *
 * Pipeline (per docs/hollow-gate-loop.md research — Nystrom connectivity + TinyKeep
 * connection graph + RogueBasin Dijkstra-map content):
 *   1. Rooms        — BSP leaves → tidy, non-overlapping rooms (3-7, more deeper).
 *   2. Corridors    — Prim's MINIMUM SPANNING TREE over room centres + L-corridors,
 *                     so every room joins its NEAREST neighbours (no x-sorted
 *                     crossing corridors), then 0-1 extra edge for a single loop.
 *   3. Connectivity — BFS from spawn; carve a repair corridor to any unreached room.
 *                     GUARANTEED connected (vs the old "bail and ship disconnected").
 *   4. Doors        — one door per corridor↔room seam (fog-of-war "what's behind it").
 *   5. Content      — placed off ONE BFS distance map: spawn/descend far apart
 *                     (deepest = descend), mandatory fights on the critical path,
 *                     rewards in deep / off-path / dead-end rooms, depth-scaled,
 *                     spacing-checked so nothing clumps. Only reachable cells used.
 *   6. Invariants   — assert exit + descend reachable; else regenerate (cheap).
 *
 * Pure. Same output shape + tile kinds/terrains + content counts as the legacy
 * generators (balance unchanged — this improves STRUCTURE, not rates). Throws only
 * if every attempt fails (caller falls back to the maze generator).
 */
import { bspSplit, bspRoomInNode, bspRoomCenter, bspCarveCorridor, hollowGateReachableSet, type BSPRect } from "./hollow-gate-bsp";
import { pickRoomTheme } from "../data/hollow-gate-atlas";
import { HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import type { HollowGateShrineRun, HollowGateTile, HollowGateTileKind, HollowGateTerrain } from "../types/character";

const CARD: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Public entry: a fully-connected, intentionally-laid-out floor. Retries a few
 *  times if an invariant fails (regenerate-on-invalid is microseconds at 165 cells). */
export function generateHollowGateFloor(floor: number, isFinalFloor: boolean): HollowGateShrineRun {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const run = tryGenerateFloor(floor, isFinalFloor);
        if (run) return run;
    }
    throw new Error("hollow-gate floor generation failed after retries");
}

function tryGenerateFloor(floor: number, isFinalFloor: boolean): HollowGateShrineRun | null {
    const w = HOLLOW_GATE_SHRINE_W;
    const h = HOLLOW_GATE_SHRINE_H;
    const total = w * h;
    const at = (x: number, y: number) => y * w + x;

    // ── 1. Rooms via BSP leaves ──────────────────────────────────────────────
    // Deeper floors split a touch more (tighter, busier); +1 random for variety.
    const splitDepth = 2 + (floor >= 3 ? 1 : 0) + (Math.random() < 0.4 ? 1 : 0);
    const leaves = bspSplit({ x: 0, y: 0, w, h }, splitDepth, 4).filter((l) => l.w >= 4 && l.h >= 4);
    const rooms: BSPRect[] = leaves.map(bspRoomInNode);
    if (rooms.length < 3) return null; // too few rooms → retry

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
    for (const [a, b] of treeEdges) bspCarveCorridor(terrain, w, centers[a], centers[b]);

    // One loop: shortest non-tree edge → a single cycle (tactical "go around").
    if (rooms.length >= 3 && Math.random() < 0.7) {
        const hasEdge = (a: number, b: number) => treeEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        let la = -1, lb = -1, lD = Infinity;
        for (let a = 0; a < rooms.length; a += 1) {
            for (let b = a + 1; b < rooms.length; b += 1) {
                if (hasEdge(a, b)) continue;
                const d = dist2(a, b);
                if (d < lD) { lD = d; la = a; lb = b; }
            }
        }
        if (la >= 0) bspCarveCorridor(terrain, w, centers[la], centers[lb]);
    }

    // ── Spawn (leftmost room) — needed before the connectivity flood ──────────
    let spawnRoom = 0;
    for (let i = 1; i < rooms.length; i += 1) if (centers[i].x < centers[spawnRoom].x) spawnRoom = i;
    const spawnIdx = at(centers[spawnRoom].x, centers[spawnRoom].y);

    // ── 3. Connectivity guarantee — carve a repair corridor to any unreached
    //       room centre until the whole floor floods from spawn. ────────────────
    ensureConnected(terrain, w, h, centers, spawnIdx);

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

    // ── 6. Content layer ─────────────────────────────────────────────────────
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
    const shuffle = (a: number[]) => { for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const allReachable = (pred: (i: number) => boolean) => {
        const out: number[] = [];
        for (let i = 0; i < total; i += 1) if (reachable(i) && pred(i)) out.push(i);
        return out;
    };
    const roomCells = allReachable((i) => terrain[i] === "room_floor");
    const corridorCells = allReachable((i) => terrain[i] === "corridor_floor");
    const deadEnds = allReachable((i) => (terrain[i] === "corridor_floor" || terrain[i] === "room_floor") && walkableNeighbors(i) <= 1);
    const deepFirst = (cells: number[]) => [...cells].sort((a, b) => dist[b] - dist[a]);
    const offPath = (cells: number[]) => cells.filter((i) => !onPath.has(i));

    // Counts mirror the legacy generators exactly (no balance change).
    const battleCount = 4 + Math.min(3, floor);
    const eliteCount = 1 + Math.floor(floor / 2);
    const trapCount = 3 + Math.floor(floor / 2);
    const chestCount = 3;
    const veinCount = 1 + Math.floor(floor / 2);

    // Mandatory fights gate the descent: bias onto / beside the critical path.
    const nearPath = (cells: number[]) => cells.filter((i) => onPath.has(i) || CARD.some(([dx, dy]) => onPath.has(((Math.floor(i / w) + dy) * w + (i % w + dx)))));
    place("elite", eliteCount, deepFirst(roomCells), 4);                         // elites deep, well-spaced
    const battlePool = shuffle(nearPath([...roomCells, ...corridorCells]));
    const battles = place("battle", battleCount, battlePool, 2);
    place("battle", battleCount - battles, shuffle([...roomCells, ...corridorCells]), 2); // top-up anywhere

    // Rewards reward exploration: deep, off the mainline, in dead-ends.
    place("locked", 1, deepFirst(offPath(roomCells)), 1);                        // gates a side pocket
    const chests = place("chest", chestCount, shuffle([...offPath(deadEnds), ...deepFirst(offPath(roomCells))]), 2);
    place("chest", chestCount - chests, shuffle(roomCells), 2);
    place("shard_vein", veinCount, shuffle(offPath(roomCells)), 2);
    place("shrine", 1, deepFirst(roomCells), 0);
    place("npc", 1, shuffle(roomCells), 3);                                      // Shrine Keeper
    place("story", 1, shuffle(roomCells), 0);

    // Traps punish wrong turns: dead-ends first, then corridors.
    const traps = place("trap", Math.ceil(trapCount * 0.6), shuffle(deadEnds), 1);
    place("trap", trapCount - traps, shuffle([...corridorCells, ...roomCells]), 1);

    // ── 7. Invariants — exit + descend wall-reachable from spawn ──────────────
    const walls = wallSet(terrain);
    const reach = hollowGateReachableSet(w, h, spawnIdx, walls);
    if (!reach.has(exitIdx) || !reach.has(targetIdx)) return null; // regenerate

    // ── 8. Decorations + assemble ────────────────────────────────────────────
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        decoration: (terrain[i] === "room_floor" && kind === "empty" && !reserved.has(i) && !protectedCells.has(i) && Math.random() < 0.12) ? Math.floor(Math.random() * 4) : undefined,
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
function ensureConnected(terrain: HollowGateTerrain[], w: number, h: number, centers: Array<{ x: number; y: number }>, spawnIdx: number): void {
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
        bspCarveCorridor(terrain, w, centers[unreached], { x: target % w, y: Math.floor(target / w) });
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
