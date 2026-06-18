/**
 * Hollow Gate — random-maze floor generator.
 *
 * Recursive-backtracker carve over the grid, then:
 *   • punch ~14% loops so there are multiple routes + shortcuts (a perfect maze
 *     is all dead-ends and tedious to backtrack),
 *   • carve a few small rooms (spawn / vault / a mid set-piece) so it's not all
 *     1-wide corridors,
 *   • place content with a dead-end bias — chests/veins/traps reward (or punish)
 *     exploring the branches.
 *
 * Pure. Throws on the (shouldn't-happen) reachability failure so the caller can
 * fall back to the BSP generator. Visibility is handled by computeHollowGateVisible
 * (corridor flood is distance-capped so the maze keeps its fog).
 */
import { hollowGateReachableSet } from "./hollow-gate-bsp";
import { pickRoomTheme } from "../data/hollow-gate-atlas";
import { HOLLOW_GATE_SHRINE_W, HOLLOW_GATE_SHRINE_H } from "../constants/game";
import type { HollowGateShrineRun, HollowGateTile, HollowGateTileKind, HollowGateTerrain } from "../types/character";

export function generateHollowGateMazeRun(floor: number, isFinalFloor: boolean): HollowGateShrineRun {
    const w = HOLLOW_GATE_SHRINE_W, h = HOLLOW_GATE_SHRINE_H, total = w * h;
    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    const roomIds: number[] = new Array(total).fill(-1);
    const at = (x: number, y: number) => y * w + x;
    const cellOk = (x: number, y: number) => x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2;

    // ── 1. Recursive-backtracker maze on odd cells (walls between) ──────────
    terrain[at(1, 1)] = "corridor_floor";
    const stack: Array<[number, number]> = [[1, 1]];
    const dirs: Array<[number, number]> = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const open = dirs
            .map(([dx, dy]) => [cx + dx, cy + dy] as [number, number])
            .filter(([nx, ny]) => cellOk(nx, ny) && terrain[at(nx, ny)] === "wall");
        if (!open.length) { stack.pop(); continue; }
        const [nx, ny] = open[Math.floor(Math.random() * open.length)];
        terrain[at((cx + nx) / 2, (cy + ny) / 2)] = "corridor_floor";
        terrain[at(nx, ny)] = "corridor_floor";
        stack.push([nx, ny]);
    }

    // ── 2. Loops — knock through ~14% of walls dividing two passages ────────
    for (let y = 1; y <= h - 2; y += 1) {
        for (let x = 1; x <= w - 2; x += 1) {
            if (terrain[at(x, y)] !== "wall") continue;
            const horiz = terrain[at(x - 1, y)] === "corridor_floor" && terrain[at(x + 1, y)] === "corridor_floor";
            const vert = terrain[at(x, y - 1)] === "corridor_floor" && terrain[at(x, y + 1)] === "corridor_floor";
            if ((horiz || vert) && Math.random() < 0.14) terrain[at(x, y)] = "corridor_floor";
        }
    }

    // ── 3. Carve rooms (spawn, vault, mid) over the connected maze ──────────
    let nextRoom = 0;
    const carveRoom = (cx: number, cy: number) => {
        const id = nextRoom; nextRoom += 1;
        for (let yy = cy - 1; yy <= cy + 1; yy += 1) for (let xx = cx - 1; xx <= cx + 1; xx += 1) {
            if (cellOk(xx, yy)) { terrain[at(xx, yy)] = "room_floor"; roomIds[at(xx, yy)] = id; }
        }
        return at(cx, cy);
    };
    const spawnIdx = carveRoom(2, 2);
    const targetIdx = carveRoom(w - 3, h - 3);
    const midX = 3 + 2 * Math.floor(Math.random() * Math.max(1, (w - 6) / 2));
    const midY = 3 + 2 * Math.floor(Math.random() * Math.max(1, (h - 6) / 2));
    const exitIdx = carveRoom(midX, midY);

    // ── 4. Mark doors where a corridor first meets a room ───────────────────
    {
        const touched = new Set<number>();
        for (let i = 0; i < total; i += 1) {
            if (terrain[i] !== "corridor_floor") continue;
            const x = i % w, y = Math.floor(i / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const ni = ny * w + nx;
                if (terrain[ni] === "room_floor" && !touched.has(ni)) { terrain[ni] = "door"; touched.add(ni); }
            }
        }
    }

    // ── 5. Content layer ────────────────────────────────────────────────────
    const kinds: HollowGateTileKind[] = new Array(total).fill("empty");
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") kinds[i] = "wall";
    const reserved = new Set<number>([spawnIdx, exitIdx, targetIdx]);
    kinds[exitIdx] = "exit";
    kinds[targetIdx] = isFinalFloor ? "boss" : "descend";

    const px = spawnIdx % w, py = Math.floor(spawnIdx / w);
    const protectedRadius = new Set<number>([spawnIdx]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nIdx = (py + dy) * w + (px + dx);
        if (terrain[nIdx] && terrain[nIdx] !== "wall") protectedRadius.add(nIdx);
    }
    const walkableNeighbors = (i: number) => {
        const x = i % w, y = Math.floor(i / w); let n = 0;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && terrain[ny * w + nx] !== "wall") n += 1;
        }
        return n;
    };
    const placeAtDeadEnds = (kind: HollowGateTileKind, max: number) => {
        const ends: number[] = [];
        for (let i = 0; i < total; i += 1) {
            if (reserved.has(i) || protectedRadius.has(i) || kinds[i] !== "empty") continue;
            if (terrain[i] !== "corridor_floor" && terrain[i] !== "room_floor") continue;
            if (walkableNeighbors(i) <= 1) ends.push(i);
        }
        ends.sort(() => Math.random() - 0.5);
        let placed = 0;
        for (const i of ends) { if (placed >= max) break; kinds[i] = kind; placed += 1; }
        return placed;
    };
    const placeIn = (allowed: HollowGateTerrain[], kind: HollowGateTileKind, count: number) => {
        let placed = 0, safety = 0;
        while (placed < count && safety < 500) {
            safety += 1;
            const i = Math.floor(Math.random() * total);
            if (reserved.has(i) || protectedRadius.has(i) || kinds[i] !== "empty") continue;
            if (!allowed.includes(terrain[i])) continue;
            kinds[i] = kind; placed += 1;
        }
    };

    const trapCount = 3 + Math.floor(floor / 2);
    const chestCount = 3;
    // Dead-ends are the maze's payoff: bias chests + traps there first.
    const deTraps = placeAtDeadEnds("trap", Math.ceil(trapCount * 0.6));
    const deChests = placeAtDeadEnds("chest", Math.ceil(chestCount * 0.6));
    placeIn(["corridor_floor", "room_floor"], "battle", 4 + Math.min(3, floor));
    placeIn(["corridor_floor", "room_floor"], "trap", Math.max(0, trapCount - deTraps));
    placeIn(["corridor_floor", "room_floor"], "elite", 1 + Math.floor(floor / 2));
    placeIn(["corridor_floor", "room_floor"], "chest", Math.max(0, chestCount - deChests));
    placeIn(["corridor_floor", "room_floor"], "shard_vein", 1 + Math.floor(floor / 2));
    placeIn(["room_floor", "corridor_floor"], "shrine", 1);
    placeIn(["room_floor", "corridor_floor"], "story", 1);
    placeIn(["room_floor", "corridor_floor"], "locked", 1);
    placeIn(["room_floor", "corridor_floor"], "npc", 1);

    // ── 6. Validate reachability ────────────────────────────────────────────
    // If a locked tile sits on the only path to the exit/descent, relocate it
    // onto a free cell (with maze loops this is rare).
    const blockers = new Set<number>();
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall" || kinds[i] === "locked") blockers.add(i);
    const reach = hollowGateReachableSet(w, h, spawnIdx, blockers);
    if (!reach.has(exitIdx) || !reach.has(targetIdx)) {
        const locked = kinds.flatMap((k, i) => k === "locked" ? [i] : []);
        const free = kinds.flatMap((k, i) => (k === "empty" && !reserved.has(i) && terrain[i] !== "wall") ? [i] : []);
        if (locked.length && free.length) {
            kinds[locked[0]] = "empty";
            kinds[free[Math.floor(Math.random() * free.length)]] = "locked";
        }
    }
    // Structural check (walls only) — throw so the caller falls back to BSP if
    // the maze is somehow disconnected (shouldn't happen — carve is connected).
    const walls = new Set<number>();
    for (let i = 0; i < total; i += 1) if (terrain[i] === "wall") walls.add(i);
    const wallReach = hollowGateReachableSet(w, h, spawnIdx, walls);
    if (!wallReach.has(exitIdx) || !wallReach.has(targetIdx)) {
        throw new Error("hollow-gate maze failed reachability");
    }

    // ── 7. Decorations + build run ──────────────────────────────────────────
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const tiles: HollowGateTile[] = kinds.map((kind, i) => ({
        kind,
        terrain: terrain[i],
        roomId: roomIds[i] >= 0 ? roomIds[i] : null,
        decoration: (terrain[i] === "room_floor" && kind === "empty" && !reserved.has(i) && !protectedRadius.has(i) && Math.random() < 0.12) ? Math.floor(Math.random() * 4) : undefined,
        revealed: i === spawnIdx,
        resolved: i === spawnIdx,
        flavor: i === spawnIdx ? "You stand at the threshold of the Hollow Gate Shrine." : undefined,
    }));
    const roomThemes: Record<number, string> = {};
    for (let id = 0; id < nextRoom; id += 1) roomThemes[id] = pickRoomTheme(id, floor, seed);

    return {
        width: w, height: h, playerX: px, playerY: py, tiles, floor,
        threat: 0, torch: 10, keys: 0, completed: false, roomThemes, seed,
    };
}
