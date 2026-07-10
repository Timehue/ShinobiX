/**
 * Hollow Gate — click-to-move pathfinding over KNOWN tiles.
 *
 * The dungeon moves like a sector now: tap a tile and the avatar walks there.
 * The path is a plain BFS shortest path, but it only routes through tiles the
 * player KNOWS — currently visible (room-flood / corridor torchlight) or
 * previously revealed — so the walker can never leak information about the
 * fog. It also treats every known walkable tile uniformly (no dodging
 * disguised traps/ambushes): pathing must not be smarter than the player.
 *
 * Pure helpers — no App state, unit-tested in hollow-gate-path.test.ts.
 */
import { computeHollowGateVisible } from "./hollow-gate-dungeon";
import type { HollowGateShrineRun } from "../types/character";

const CARD: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Everything the player can currently see plus everything already explored
 *  (stepped on OR ever seen — the persisted map memory). */
export function hollowGateKnownSet(run: HollowGateShrineRun): Set<number> {
    const known = run.diviner
        ? new Set(run.tiles.map((_, i) => i))       // Diviner's Eye — whole floor known
        : computeHollowGateVisible(run);
    run.tiles.forEach((t, i) => { if (t.revealed || t.seen) known.add(i); });
    return known;
}

/**
 * Stamp `seen: true` on every tile in the current visibility flood — the
 * persisted map memory (survives leaving the room + save/resume). Returns the
 * same run object when nothing new was seen, so callers can setState with it
 * without spurious re-renders. Call after each committed move.
 */
export function markHollowGateSeen(run: HollowGateShrineRun): HollowGateShrineRun {
    const visible = computeHollowGateVisible(run);
    let dirty = false;
    for (const i of visible) {
        const t = run.tiles[i];
        if (t && !t.seen) { dirty = true; break; }
    }
    if (!dirty) return run;
    const tiles = run.tiles.slice();
    for (const i of visible) {
        const t = tiles[i];
        if (t && !t.seen) tiles[i] = { ...t, seen: true };
    }
    return { ...run, tiles };
}

/**
 * BFS shortest path player→target over known, non-wall tiles.
 * Returns the step sequence of tile indices EXCLUDING the start tile
 * ([] when already there), or null when the target is unknown/unreachable.
 */
export function findHollowGatePath(
    run: HollowGateShrineRun,
    targetIdx: number,
    known: Set<number> = hollowGateKnownSet(run),
): number[] | null {
    const w = run.width, h = run.height;
    const start = run.playerY * w + run.playerX;
    if (targetIdx === start) return [];
    if (targetIdx < 0 || targetIdx >= run.tiles.length) return null;
    const walkable = (i: number) => {
        const t = run.tiles[i];
        return !!t && t.terrain !== "wall" && t.kind !== "wall" && known.has(i);
    };
    if (!walkable(targetIdx)) return null;

    const prev = new Map<number, number>();
    const queue: number[] = [start];
    const seen = new Set<number>([start]);
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head]; head += 1;
        if (idx === targetIdx) break;
        const x = idx % w, y = Math.floor(idx / w);
        for (const [dx, dy] of CARD) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (seen.has(ni) || !walkable(ni)) continue;
            seen.add(ni);
            prev.set(ni, idx);
            queue.push(ni);
        }
    }
    if (!prev.has(targetIdx)) return null;

    const path: number[] = [];
    for (let cur = targetIdx; cur !== start; cur = prev.get(cur)!) path.push(cur);
    path.reverse();
    return path;
}
