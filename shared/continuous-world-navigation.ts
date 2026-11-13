import { paintedTilePoint, worldDistance, type ContinuousWorldSpace, type WorldPoint } from './continuous-world-space';
import { tileNeighbors, walkableTiles } from './sector-walk-mask';
import type { WorldPosition } from './world-position';
import { frontierSteps, WORLD_FRONTIER_VERSION, type WorldFrontier } from './world-frontier';

export type WorldNode = WorldPoint & { id: string; sector: number; tile?: number; road?: string; land?: true; neighbors: string[] };
export type WorldNavigation = WorldFrontier & { nodes: WorldNode[]; byId: ReadonlyMap<string, WorldNode> };
/** Graph rules owned by this file. `d1`: diagonal steps between grid cells. */
const WORLD_STEP_VERSION = 'd1';
/** Cursors name graph nodes, so a graph rule change must retire every older cursor.
 *  A retired cursor reads as null, and the server falls back to the saved sector tile. */
export const worldGraphVersion = (layoutVersion: string) => `${layoutVersion}.${WORLD_FRONTIER_VERSION}.${WORLD_STEP_VERSION}`;

/** Corridor positions are explicit, never squeezed into a sector tile; open land surrounds both. */
export function buildWorldNavigation(space: ContinuousWorldSpace): WorldNavigation {
    const steps = navigationSteps(space);
    for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

/**
 * The same graph, built between paints: control returns to the browser whenever a
 * slice has run for `budgetMs`, so a phone never freezes while the world loads.
 */
export async function buildWorldNavigationInSlices(space: ContinuousWorldSpace, pause: () => Promise<void>, budgetMs = 8): Promise<WorldNavigation> {
    const steps = navigationSteps(space);
    for (let started = performance.now(); ;) {
        const step = steps.next();
        if (step.done) return step.value;
        if (performance.now() - started >= budgetMs) { await pause(); started = performance.now(); }
    }
}

function* navigationSteps(space: ContinuousWorldSpace): Generator<void, WorldNavigation> {
    const nodes = new Map<string, WorldNode>();
    const tileId = (sector: number, tile: number) => `${sector}:${tile}`;
    for (const chunk of space.chunks) {
        const tiles = new Set(walkableTiles(chunk.sector));
        for (const tile of tiles) {
            const id = tileId(chunk.sector, tile);
            nodes.set(id, { id, sector: chunk.sector, tile, ...paintedTilePoint(chunk, tile),
                neighbors: tileNeighbors(tile).filter(t => tiles.has(t)).map(t => tileId(chunk.sector, t)) });
        }
        yield;
    }
    for (const road of space.roads) {
        yield;
        const key = `${road.a.sector}-${road.b.sector}`;
        let prior = nodes.get(tileId(road.a.sector, road.a.tile));
        if (!prior) throw new Error(`Blocked road mouth ${key}`);
        let distance = 0, serial = 0;
        for (let segment = 1; segment < road.points.length; segment++) {
            const a = road.points[segment - 1]!, b = road.points[segment]!, length = worldDistance(a, b);
            const count = Math.ceil(length);
            for (let step = 1; step <= count; step++) {
                const fraction = step / count, final = segment === road.points.length - 1 && step === count;
                const id = final ? tileId(road.b.sector, road.b.tile) : `road:${key}:${serial++}`;
                const next = final ? nodes.get(id) : { id, road: key,
                    sector: distance + length * fraction < road.length / 2 ? road.a.sector : road.b.sector,
                    x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, neighbors: [] } as WorldNode;
                if (!next) throw new Error(`Blocked destination ${key}`);
                if (!final) nodes.set(id, next);
                prior.neighbors.push(id); next.neighbors.push(prior.id); prior = next;
            }
            distance += length;
        }
    }
    const frontier = yield* frontierSteps(space, nodes);
    yield* diagonalSteps(nodes);
    return { ...frontier, nodes: [...nodes.values()], byId: nodes };
}

/**
 * Diagonal steps between grid cells (sector tiles and open land, never road nodes).
 * Two diagonal cells are joined only when all four sides of their 2x2 square are
 * already steps, so a diagonal never cuts a corner past rock, water, a cliff line,
 * an overpass or an unlinked border: every rule that shaped those four steps holds.
 */
function* diagonalSteps(nodes: Map<string, WorldNode>): Generator<void, void> {
    const cells = new Map<string, WorldNode>(), key = (x: number, y: number) => x + ',' + y;
    for (const node of nodes.values()) {
        const x = Math.floor(node.x), y = Math.floor(node.y);
        if (!node.road && node.x - x === .5 && node.y - y === .5) cells.set(key(x, y), node);
    }
    yield;
    const step = (a: WorldNode, b: WorldNode | undefined) => b !== undefined && a.neighbors.includes(b.id);
    let work = 0;
    for (const a of cells.values()) {
        const x = Math.floor(a.x), y = Math.floor(a.y), across = cells.get(key(x + 1, y));
        for (const dy of [1, -1]) {
            const b = cells.get(key(x + 1, y + dy)), below = cells.get(key(x, y + dy));
            if (b && step(a, across) && step(across!, b) && step(a, below) && step(below!, b) && !step(a, b)) {
                a.neighbors.push(b.id); b.neighbors.push(a.id);
            }
        }
        if (++work % 2048 === 0) yield;
    }
}

/** A* over the world graph. Open land costs a little more, so routes keep to roads where they can. */
export function worldRoute(nodes: ReadonlyMap<string, WorldNode>, from: string, to: string): string[] | null {
    const start = nodes.get(from), goal = nodes.get(to);
    if (!start || !goal) return null;
    const cost = new Map([[from, 0]]), parent = new Map<string, string>();
    const heap: { id: string; rank: number }[] = [{ id: from, rank: worldDistance(start, goal) }];
    while (heap.length) {
        const top = heap[0]!, tail = heap.pop()!;
        if (heap.length) {
            let i = 0;
            for (let child = 1; child < heap.length; child = i * 2 + 1) {
                if (child + 1 < heap.length && heap[child + 1]!.rank < heap[child]!.rank) child++;
                if (heap[child]!.rank >= tail.rank) break;
                heap[i] = heap[child]!; i = child;
            }
            heap[i] = tail;
        }
        const id = top.id;
        if (id === to) {
            const route = [id];
            while (parent.has(route[0]!)) route.unshift(parent.get(route[0]!)!);
            return route;
        }
        const node = nodes.get(id)!;
        if (top.rank > cost.get(id)! + worldDistance(node, goal) + 1e-9) continue;
        for (const neighbor of node.neighbors) {
            const next = nodes.get(neighbor)!;
            const distance = cost.get(id)! + worldDistance(node, next) * (node.land || next.land ? 1.2 : 1);
            if (distance >= (cost.get(neighbor) ?? Infinity)) continue;
            cost.set(neighbor, distance); parent.set(neighbor, id);
            const entry = { id: neighbor, rank: distance + worldDistance(next, goal) };
            let i = heap.push(entry) - 1;
            while (i) { const up = (i - 1) >> 1; if (heap[up]!.rank <= entry.rank) break; heap[i] = heap[up]!; i = up; }
            heap[i] = entry;
        }
    }
    return null;
}

/** Deterministic travel integrator. The renderer does not own movement or zone membership. */
export function createWorldWalker(nodes: ReadonlyMap<string, WorldNode>, start: string, speed = 6.5) {
    let id = start, position: WorldPoint = { ...nodes.get(start)! }, route: string[] = [], paused = false;
    let segmentTarget: string | null = null, travelled = 0;
    // Set while stepping back to the node just left in order to turn there; it is the
    // heading the turn is for, so a presenter can face it instead of the backward step.
    let pivot: WorldPoint | null = null;
    if (!nodes.has(start)) throw new Error('Invalid world start');
    /** The neighbour of `from` best matching `direction`, by the same rule `step` uses. */
    function toward(from: WorldNode, direction: WorldPoint) {
        let best = '', score = .35;
        for (const neighbor of from.neighbors) {
            const next = nodes.get(neighbor)!;
            const rank = ((next.x - from.x) * direction.x + (next.y - from.y) * direction.y) / worldDistance(from, next);
            if (rank > score) { score = rank; best = neighbor; }
        }
        return best;
    }
    return {
        get position() { return { x: position.x, y: position.y }; },
        get node() { return nodes.get(id)!; },
        get moving() { return route.length > 0; },
        get pivot() { return pivot ? { x: pivot.x, y: pivot.y } : null; },
        nextSegment() {
            for (const next of route) {
                const point = nodes.get(next)!;
                const dx = point.x-position.x, dy = point.y-position.y;
                const distance = Math.hypot(dx,dy);
                if (distance > 1e-9) return {dx:dx/distance,dy:dy/distance,distance};
            }
            return null;
        },
        get travelled() { return travelled; },
        cursor(layoutVersion: string): WorldPosition {
            const to = segmentTarget ?? id, a = nodes.get(id)!, b = nodes.get(to)!, length = worldDistance(a, b);
            return { layoutVersion, from: id, to, progress: length ? Math.min(1, worldDistance(a, position) / length) : 0 };
        },
        restore(cursor: WorldPosition) {
            const a = nodes.get(cursor.from), b = nodes.get(cursor.to);
            if (!a || !b || !Number.isFinite(cursor.progress) || cursor.progress < 0 || cursor.progress > 1
                || (a.id === b.id ? cursor.progress !== 0 : !a.neighbors.includes(b.id))) return false;
            const goal = route.at(-1);
            pivot = null;
            id = a.id; segmentTarget = a.id === b.id ? null : b.id;
            position = { x: a.x + (b.x - a.x) * cursor.progress, y: a.y + (b.y - a.y) * cursor.progress };
            route = goal ? [b.id, ...(worldRoute(nodes, b.id, goal)?.slice(1) ?? [])] : [];
            return true;
        },
        go(to: string) {
            const anchor = segmentTarget ?? id;
            const path = worldRoute(nodes, anchor, to);
            if (!path) return false;
            pivot = null;
            // Complete the current segment before replacing a route, avoiding a mid-step jump.
            route = worldDistance(position, nodes.get(anchor)!) > 1e-8 ? [anchor, ...path.slice(1)] : path.slice(1);
            return true;
        },
        step(direction: WorldPoint, allowReverse: boolean) {
            const node = nodes.get(id)!;
            pivot = null;
            if (segmentTarget && allowReverse) {
                const next = nodes.get(segmentTarget)!, length = worldDistance(node, next);
                const along = ((next.x - node.x) * direction.x + (next.y - node.y) * direction.y) / (length || 1);
                // A turn off the edge being walked is taken from whichever end is nearer.
                // Nearer the node just left: step back to it (the same partial-edge reversal
                // a turn-around uses, so every cursor stays on the graph) and turn there,
                // rather than finishing up to a whole tile in the old direction first.
                const backtrack = Math.abs(along) < .35 && length > 0
                    && worldDistance(node, position) < length / 2 && toward(node, direction) !== '';
                if (along < -1e-8 || backtrack) {
                    segmentTarget = id;
                    id = next.id;
                    if (backtrack) pivot = { x: direction.x, y: direction.y };
                }
                route = [segmentTarget];
                return;
            }
            const best = toward(node, direction);
            if (best) this.go(best);
        },
        stop() { route = []; pivot = null; },
        pause(value: boolean) { paused = value; },
        tick(seconds: number) {
            if (paused) return [] as number[];
            let remaining = Math.max(0, Math.min(seconds, .05)) * speed;
            const zones: number[] = [];
            while (route.length && remaining > 0) {
                const target = nodes.get(route[0]!)!, distance = worldDistance(position, target);
                segmentTarget = target.id;
                if (distance > remaining + 1e-9) {
                    travelled += remaining;
                    const t = remaining / distance;
                    position = { x: position.x + (target.x - position.x) * t, y: position.y + (target.y - position.y) * t };
                    break;
                }
                remaining -= distance; travelled += distance;
                if (target.sector !== nodes.get(id)!.sector) zones.push(target.sector);
                id = target.id; position = { x: target.x, y: target.y }; route.shift(); segmentTarget = null;
                if (!route.length) pivot = null;
            }
            return zones;
        },
    };
}
