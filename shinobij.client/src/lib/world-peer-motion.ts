import { worldRoute, type WorldNode } from '../../../shared/continuous-world-navigation';
import { worldDistance, type WorldPoint } from '../../../shared/continuous-world-space';
import type { WorldPosition } from '../../../shared/world-position';

/** Follow the actual walk graph between snapshots, including partial edges. */
export function peerWorldPath(nodes: ReadonlyMap<string, WorldNode>, from: WorldPosition, to: WorldPosition): WorldPoint[] | null {
    const point = (p: WorldPosition) => {
        const a = nodes.get(p.from)!, b = nodes.get(p.to)!;
        return { x: a.x + (b.x - a.x) * p.progress, y: a.y + (b.y - a.y) * p.progress };
    };
    if (![from.from, from.to, to.from, to.to].every(id => nodes.has(id))) return null;
    const start = point(from), end = point(to);
    if (from.from === to.from && from.to === to.to || from.from === to.to && from.to === to.from) return [start, end];
    let best: WorldPoint[] | null = null, cost = Infinity;
    for (const a of new Set([from.from, from.to])) for (const b of new Set([to.from, to.to])) {
        const route = worldRoute(nodes, a, b);
        if (!route) continue;
        const points = [start, ...route.map(id => nodes.get(id)!), end];
        const length = points.slice(1).reduce((sum, p, i) => sum + worldDistance(points[i]!, p), 0);
        if (length < cost) { cost = length; best = points; }
    }
    return best;
}

export function advancePeerPath(points: WorldPoint[], distance: number): WorldPoint | null {
    while (points.length > 1) {
        const a = points[0]!, b = points[1]!, length = worldDistance(a, b);
        if (length > distance) {
            const t = distance / length;
            points[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            break;
        }
        distance -= length; points.shift();
    }
    return points[0] ?? null;
}
