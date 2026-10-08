import type { ContinuousWorldSpace, WorldPoint } from './continuous-world-space';
import type { WorldNode } from './continuous-world-navigation';
import { sectorExits } from './sector-links';
import { nearestInMask, sectorWalkMask } from './sector-walk-mask';
import { worldRoadCrossings } from './world-road-crossings';

/**
 * Open frontier: the painted ground around every sector and beside every road is
 * real, walkable land instead of an invisible wall. Each land cell belongs to the
 * nearest sector or road half. A step between two sectors is only possible where a
 * road already links them, so the server's crossing rule is unchanged; unlinked
 * neighbours keep a closed cliff line. Basic arithmetic only (no Math.hypot or
 * trigonometry), so Node and every browser derive the identical graph.
 */
export const WORLD_FRONTIER_VERSION = 'f1';
const APRON = 4, VERGE = 2, CLEAR = 3;
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const AROUND = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => [dx, dy] as const));
const NONE: readonly WorldNode[] = [];
/** Yield roughly every this many units of work, so a browser can paint between slices. */
const SLICE = 2048;
/** Ground kinds on the frontier grid: 0 closed cliff, 1 walkable land or road, 2 painted sector. */
export type WorldTerrain = { kind(x: number, y: number): number };
/** Midpoint of a cell edge where walking ground changes sector. `horizontal` lines run along x. */
export type WorldBoundary = WorldPoint & { horizontal: boolean };
export type WorldFrontier = { terrain: WorldTerrain; boundaries: WorldBoundary[]; walls: WorldBoundary[] };

function hash(x: number, y: number) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth deterministic wobble of about one tile, so aprons read as terrain, not boxes. */
function wobble(x: number, y: number) {
    const gx = Math.floor(x / 5), gy = Math.floor(y / 5), fx = x / 5 - gx, fy = y / 5 - gy;
    const a = hash(gx, gy), b = hash(gx + 1, gy), c = hash(gx, gy + 1), d = hash(gx + 1, gy + 1);
    return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy - .5) * 2.4;
}

/** The frontier build as resumable steps; the result is identical however it is driven. */
export function* frontierSteps(space: ContinuousWorldSpace, nodes: Map<string, WorldNode>): Generator<void, WorldFrontier> {
    let work = 0;
    const x0 = Math.min(...space.chunks.map(c => c.x)) - 10, y0 = Math.min(...space.chunks.map(c => c.y)) - 10;
    const w = Math.max(...space.chunks.map(c => c.x + c.size)) + 10 - x0, h = Math.max(...space.chunks.map(c => c.y + c.size)) + 10 - y0;
    const at = (x: number, y: number) => x < x0 || y < y0 || x >= x0 + w || y >= y0 + h ? -1 : (y - y0) * w + x - x0;
    const painted = new Uint8Array(w * h), land = new Uint8Array(w * h), cleared = new Uint8Array(w * h);
    const owner = new Int16Array(w * h).fill(-1), slot = new Int32Array(w * h).fill(-1);
    const lists: WorldNode[][] = [], listCells: number[] = [], links = new Set<number>();
    const nodesAt = (i: number) => i >= 0 && slot[i]! >= 0 ? lists[slot[i]!]! : NONE;
    for (const chunk of space.chunks) {
        for (const exit of sectorExits(chunk.sector)) links.add(chunk.sector * 256 + exit.destinationSector);
        for (let y = chunk.y; y < chunk.y + chunk.size; y++) for (let x = chunk.x; x < chunk.x + chunk.size; x++) painted[at(x, y)] = 1;
    }
    const linked = (a: number, b: number) => a === b || links.has(a * 256 + b);
    for (const node of nodes.values()) {
        const i = at(Math.floor(node.x), Math.floor(node.y));
        if (slot[i]! < 0) { slot[i] = lists.length; lists.push([]); listCells.push(i); }
        lists[slot[i]!]!.push(node);
        if (++work % SLICE === 0) yield;
    }
    // Open land keeps clear of each overpass; only the deck's own road cells refuse side steps.
    for (const c of worldRoadCrossings(space.roads)) for (let dy = -CLEAR; dy <= CLEAR; dy++) for (let dx = -CLEAR; dx <= CLEAR; dx++) {
        const i = at(Math.floor(c.x) + dx, Math.floor(c.y) + dy);
        if (i >= 0) cleared[i] = Math.max(cleared[i]!, Math.max(dx, -dx, dy, -dy) <= 1 ? 2 : 1);
    }
    const cells: number[] = [];
    const claim = (i: number) => { if (i >= 0 && !land[i] && !painted[i] && slot[i]! < 0) { land[i] = 1; cells.push(i); } };
    for (const chunk of space.chunks) {
        for (let y = chunk.y - APRON - 2; y < chunk.y + chunk.size + APRON + 2; y++) for (let x = chunk.x - APRON - 2; x < chunk.x + chunk.size + APRON + 2; x++) {
            const dx = Math.max(chunk.x - x - .5, 0, x + .5 - chunk.x - chunk.size), dy = Math.max(chunk.y - y - .5, 0, y + .5 - chunk.y - chunk.size);
            const r = APRON + wobble(x, y);
            if (r > 0 && dx * dx + dy * dy <= r * r) claim(at(x, y));
        }
        yield;
    }
    for (const node of nodes.values()) {
        if (node.road) for (let dy = -VERGE; dy <= VERGE; dy++) for (let dx = -VERGE; dx <= VERGE; dx++) claim(at(Math.floor(node.x) + dx, Math.floor(node.y) + dy));
        if (++work % SLICE === 0) yield;
    }
    const xOf = (i: number) => i % w + x0, yOf = (i: number) => Math.floor(i / w) + y0;
    for (const i of cells) {
        // Overpasses stay grade-separated, and a painted obstacle on a sector's
        // edge continues one step outward instead of ending in open grass.
        if (cleared[i] || STEPS.some(([dx, dy]) => { const j = at(xOf(i) + dx, yOf(i) + dy); return j >= 0 && painted[j] === 1 && slot[j]! < 0; })) land[i] = 0;
        if (++work % SLICE === 0) yield;
    }
    // Nearest owner by breadth-first growth from every sector tile and road half.
    const queue = listCells.slice();
    for (const i of queue) owner[i] = lists[slot[i]!]![0]!.sector;
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q]!;
        for (const [dx, dy] of STEPS) {
            const j = at(xOf(i) + dx, yOf(i) + dy);
            if (j >= 0 && land[j] && owner[j]! < 0) { owner[j] = owner[i]!; queue.push(j); }
        }
        if (++work % SLICE === 0) yield;
    }
    const clash = (sector: number, j: number) => slot[j]! >= 0 ? nodesAt(j).some(n => !linked(sector, n.sector))
        : land[j] === 1 && owner[j]! >= 0 && !linked(sector, owner[j]!);
    // Unlinked neighbours meet at a closed cliff line, never an open seam.
    const close: number[] = [];
    for (const i of cells) {
        if (land[i] && (owner[i]! < 0
            || AROUND.some(([dx, dy]) => { const j = at(xOf(i) + dx, yOf(i) + dy); return j >= 0 && clash(owner[i]!, j); }))) close.push(i);
        if (++work % SLICE === 0) yield;
    }
    for (const i of close) land[i] = 0;

    const chunks = new Map(space.chunks.map(c => [c.sector, c])), anchors = new Map<number, number>();
    const index = new Int32Array(w * h).fill(-1), created: WorldNode[] = [];
    for (const i of cells) {
        if (++work % SLICE === 0) yield;
        if (!land[i]) continue;
        const x = xOf(i), y = yOf(i), sector = owner[i]!, chunk = chunks.get(sector)!;
        const key = sector * 144 + Math.max(0, Math.min(11, y - chunk.y)) * 12 + Math.max(0, Math.min(11, x - chunk.x));
        let tile = anchors.get(key);
        if (tile === undefined) { tile = nearestInMask(sectorWalkMask(sector), key % 144); anchors.set(key, tile); }
        const node: WorldNode = { id: `l:${x}:${y}`, sector, tile, land: true, x: x + .5, y: y + .5, neighbors: [] };
        index[i] = created.length; nodes.set(node.id, node); created.push(node);
    }
    // Every land pair and land/ground pair is visited once, so only the road pass
    // below can meet an existing edge. Reference adjacency avoids id lookups.
    const edges: WorldNode[] = [], near: WorldNode[][] = created.map(() => []);
    const join = (a: WorldNode, b: WorldNode, fresh: boolean) => {
        if (!linked(a.sector, b.sector) || (!fresh && a.neighbors.includes(b.id))) return;
        a.neighbors.push(b.id); b.neighbors.push(a.id); edges.push(a, b);
    };
    const isolated = (n: WorldNode) => n.road !== undefined && cleared[at(Math.floor(n.x), Math.floor(n.y))] === 2;
    for (let k = 0; k < created.length; k++) {
        const node = created[k]!, x = Math.floor(node.x), y = Math.floor(node.y);
        for (const [dx, dy] of STEPS) {
            const j = at(x + dx, y + dy), next = j < 0 ? -1 : index[j]!;
            if (next >= 0) {
                if (dx + dy > 0 && linked(node.sector, created[next]!.sector)) { join(node, created[next]!, true); near[k]!.push(created[next]!); near[next]!.push(node); }
                continue;
            }
            for (const other of nodesAt(j)) if (!isolated(other) && linked(node.sector, other.sector)) { join(node, other, true); near[k]!.push(other); }
        }
        if (++work % SLICE === 0) yield;
    }
    // A road that runs beside a painting, or beside another road, can be stepped onto.
    // Corridors only meet away from overpasses, so a bridge never becomes a junction.
    for (const i of listCells) {
        for (const node of lists[slot[i]!]!) {
            if (!node.road || isolated(node)) continue;
            for (const [dx, dy] of STEPS) {
                const j = at(xOf(i) + dx, yOf(i) + dy);
                for (const other of nodesAt(j)) if (!other.road || (!cleared[i] && !cleared[j])) join(node, other, false);
            }
        }
        if (++work % SLICE === 0) yield;
    }
    // Drop pockets that touch no sector tile or road.
    const kept = new Uint8Array(created.length), stack: number[] = [];
    for (let k = 0; k < created.length; k++) if (near[k]!.some(m => !m.land)) { kept[k] = 1; stack.push(k); }
    while (stack.length) {
        for (const next of near[stack.pop()!]!) {
            const k = next.land ? index[at(Math.floor(next.x), Math.floor(next.y))]! : -1;
            if (k >= 0 && !kept[k]) { kept[k] = 1; stack.push(k); }
        }
        if (++work % SLICE === 0) yield;
    }
    const live = (n: WorldNode) => !n.land || kept[index[at(Math.floor(n.x), Math.floor(n.y))]!] === 1;
    for (let k = 0; k < created.length; k++) if (!kept[k]) { nodes.delete(created[k]!.id); land[at(Math.floor(created[k]!.x), Math.floor(created[k]!.y))] = 0; }
    yield;
    const boundaries: WorldBoundary[] = [];
    const mark = (a: WorldNode, b: WorldNode) => { if (a.sector !== b.sector) boundaries.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: a.y !== b.y }); };
    for (let k = 0; k < edges.length; k += 2) {
        const a = edges[k]!, b = edges[k + 1]!;
        if ((a.land || b.land) && live(a) && live(b)) mark(a, b);
        if (++work % SLICE === 0) yield;
    }
    // Corridors change owner between two road nodes, or at a very short road's mouth.
    for (const node of nodes.values()) {
        if (node.road) for (const id of node.neighbors) {
            const next = nodes.get(id)!;
            if (!next.land && (!next.road || node.sector < next.sector)) mark(node, next);
        }
        if (++work % SLICE === 0) yield;
    }
    // Where two walkable cells touch without a step between them (a corridor beside an
    // unlinked sector, or beside a bridge approach), the renderer draws a rock line.
    const walls: WorldBoundary[] = [];
    const walkable = (i: number) => i >= 0 && (land[i] === 1 || slot[i]! >= 0);
    for (const i of [...listCells, ...cells]) {
        if (++work % SLICE === 0) yield;
        if (!walkable(i) || cleared[i] === 2) continue;
        const here = land[i] ? [nodes.get(`l:${xOf(i)}:${yOf(i)}`)!] : nodesAt(i);
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const j = at(xOf(i) + dx, yOf(i) + dy);
            if (!walkable(j) || cleared[j] === 2) continue;
            const there = land[j] ? [nodes.get(`l:${xOf(j)}:${yOf(j)}`)!] : nodesAt(j);
            if (here.some(a => there.some(b => a.neighbors.includes(b.id)))) continue;
            walls.push({ x: xOf(i) + .5 + dx / 2, y: yOf(i) + .5 + dy / 2, horizontal: dy === 1 });
        }
    }
    const terrain: WorldTerrain = { kind(x, y) {
        const i = at(Math.floor(x), Math.floor(y));
        return i < 0 ? 0 : painted[i] ? 2 : land[i] || slot[i]! >= 0 ? 1 : 0;
    } };
    return { terrain, boundaries, walls };
}
