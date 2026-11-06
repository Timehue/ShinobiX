/**
 * Hollow Gate — secret passages.
 *
 * Each floor hides one side area behind a cracked wall. The area is one the
 * generator already built: a dead-end branch, reached through a single doorway
 * or corridor cell, that holds optional rewards (the sanctum's Hidden Chamber
 * shrine first, otherwise a chest or shard vein) and nothing the floor needs to
 * be finished. This pass only marks that one tile `secret`; the renderer draws
 * it as cracked rock and sight stops at it, until the player walks into it,
 * which breaks the wall open.
 *
 * Nothing about the floor's rules changes. The doorway keeps its terrain and
 * kind, so the server's walkable mask, node counts, reward contents and
 * connectivity checks see exactly the floor they always did. The pass is
 * deterministic (no RNG), so a seeded floor redrawn during recovery hides the
 * same chamber again.
 */
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";

const CARD: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
/** Tiles a sealed area may never hold: the floor's goals and its keeper. (A
 *  treasury's locked vault door may sit behind it: the lock gates loot, not
 *  progress, so a cracked wall before a locked vault is a fair double secret.) */
const REQUIRED = new Set(["exit", "descend", "boss", "npc"]);
const REWARD_SCORE: Record<string, number> = { shrine: 4, chest: 2, shard_vein: 2, story: 1 };

const walkable = (tile: HollowGateTile | undefined) => !!tile && tile.kind !== "wall" && tile.terrain !== "wall" && !tile.solid;

/** True while a secret doorway has not been broken open (stepped on). */
export function hollowGateSecretSealed(tile: HollowGateTile | undefined): boolean {
    return !!tile?.secret && !tile.revealed;
}

/** Walkable tiles reachable from spawn when `blocked` is treated as rock. */
function reachableWithout(run: HollowGateShrineRun, blocked: number): Set<number> {
    const { width: w, height: h, tiles } = run;
    const start = run.playerY * w + run.playerX;
    const seen = new Set<number>([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
        const i = queue[head];
        const x = i % w, y = Math.floor(i / w);
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (n === blocked || seen.has(n) || !walkable(tiles[n])) continue;
            seen.add(n);
            queue.push(n);
        }
    }
    return seen;
}

/**
 * Mark one secret doorway on a freshly generated floor. Returns the run
 * unchanged when it already has one, when no chamber qualifies, or when the
 * floor has branching wings (their seals already gate those rooms).
 */
export function sealHollowGateSecretPassage(run: HollowGateShrineRun): HollowGateShrineRun {
    const { tiles } = run;
    if (tiles.some((tile) => tile.secret) || tiles.some((tile) => tile.wing !== undefined)) return run;
    const spawn = run.playerY * run.width + run.playerX;
    const everything = reachableWithout(run, -1);
    // A side area, not half the floor: at most a quarter of the walkable cells.
    const maxSealed = Math.max(8, Math.floor(everything.size / 4));
    let best: { tile: number; score: number; size: number; door: boolean } | null = null;
    for (let index = 0; index < tiles.length; index += 1) {
        const tile = tiles[index];
        // A doorway, or a corridor cell (which has no room to flood-light).
        const door = tile.terrain === "door";
        if (!door && tile.terrain !== "corridor_floor") continue;
        if (tile.kind !== "empty" || index === spawn || !everything.has(index)) continue;
        const reach = reachableWithout(run, index);
        // Everything this one tile cuts off from the spawn.
        const sealed = [...everything].filter((i) => i !== index && !reach.has(i));
        // One cell is enough: a lone chest at a corridor's end is the classic.
        if (sealed.length < 1 || sealed.length > maxSealed || sealed.includes(spawn)) continue;
        if (sealed.some((i) => REQUIRED.has(tiles[i].kind))) continue;
        const score = sealed.reduce((sum, i) => sum + (REWARD_SCORE[tiles[i].kind] ?? 0), 0);
        if (score <= 0) continue;
        // Best rewards first; then a doorway over a corridor cell; then the
        // smaller, more alcove-like area; then the lowest index (deterministic).
        const better = !best || score > best.score
            || (score === best.score && door && !best.door)
            || (score === best.score && door === best.door && sealed.length < best.size);
        if (better) best = { tile: index, score, size: sealed.length, door };
    }
    if (!best) return carveSecretNook(run, everything) ?? run;
    const next = tiles.slice();
    next[best.tile] = { ...tiles[best.tile], secret: true };
    return { ...run, tiles: next };
}

/**
 * Fallback for floors with no optional dead end: dig a two-cell pocket into
 * solid rock off a corridor (a cracked wall, then an alcove) and move one of the
 * floor's ordinary chests into it. The chest count and its contents are
 * unchanged; only where that chest sits moves. The treasury's chests stay put.
 */
function carveSecretNook(run: HollowGateShrineRun, reachable: Set<number>): HollowGateShrineRun | null {
    const { width: w, height: h, tiles } = run;
    const lockedRooms = new Set(tiles.filter((t) => t.kind === "locked" && t.roomId != null).map((t) => t.roomId));
    const chest = tiles.findIndex((t) => t.kind === "chest" && !t.resolved && !(t.roomId != null && lockedRooms.has(t.roomId)));
    if (chest < 0) return null;
    const rock = (x: number, y: number) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1 && tiles[y * w + x]?.terrain === "wall" && tiles[y * w + x]?.kind === "wall";
    // Step distance from spawn, to tuck the nook into the far reaches.
    const start = run.playerY * w + run.playerX;
    const dist = new Map<number, number>([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
        const i = queue[head];
        for (const [dx, dy] of CARD) {
            const nx = i % w + dx, ny = Math.floor(i / w) + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (dist.has(n) || !walkable(tiles[n])) continue;
            dist.set(n, dist.get(i)! + 1);
            queue.push(n);
        }
    }
    let best: { wall: number; alcove: number; depth: number } | null = null;
    for (let approach = 0; approach < tiles.length; approach += 1) {
        const a = tiles[approach];
        if (a.terrain !== "corridor_floor" || a.kind !== "empty" || a.secret || !reachable.has(approach) || approach === start) continue;
        const ax = approach % w, ay = Math.floor(approach / w);
        for (const [dx, dy] of CARD) {
            const wx = ax + dx, wy = ay + dy, nx = wx + dx, ny = wy + dy;
            // The cracked wall and the alcove behind it are both solid rock, and
            // the rock around them is too, so the pocket opens only at one end.
            if (!rock(wx, wy) || !rock(nx, ny)) continue;
            if (!rock(wx + dy, wy + dx) || !rock(wx - dy, wy - dx)) continue;
            if (!rock(nx + dy, ny + dx) || !rock(nx - dy, ny - dx) || !rock(nx + dx, ny + dy)) continue;
            const depth = dist.get(approach) ?? 0;
            const wall = wy * w + wx;
            if (!best || depth > best.depth || (depth === best.depth && wall < best.wall)) best = { wall, alcove: ny * w + nx, depth };
        }
    }
    if (!best) return null;
    const next = tiles.slice();
    const pocket = { terrain: "corridor_floor" as const, roomId: null, revealed: false, resolved: false };
    next[best.wall] = { ...pocket, kind: "empty", secret: true };
    next[best.alcove] = { ...pocket, kind: "chest" };
    next[chest] = { ...tiles[chest], kind: "empty", flavor: undefined };
    return { ...run, tiles: next };
}
