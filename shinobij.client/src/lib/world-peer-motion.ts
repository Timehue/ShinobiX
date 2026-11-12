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

/** The destination records the speed at which the owner travelled the incoming edge. */
export type PeerWaypoint = WorldPoint & { rate?: number };

/** Hold a planted pose across a short packet gap without advancing its ground position. */
export function peerPoseInMotion(lastMovementAt: number | undefined, now: number): boolean {
    return lastMovementAt !== undefined && now >= lastMovementAt && now - lastMovementAt < 200;
}

export function advanceTimedPeerPath(points: PeerWaypoint[], seconds: number, fixedRate?: number): PeerWaypoint | null {
    while (points.length > 1) {
        const a = points[0]!, b = points[1]!, length = worldDistance(a, b);
        const rate = fixedRate ?? b.rate ?? 1;
        const duration = length / rate;
        if (duration > seconds) {
            if (seconds <= 0) break;
            const t = seconds / duration;
            const point: PeerWaypoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            if (b.rate !== undefined) point.rate = b.rate;
            points[0] = point;
            break;
        }
        seconds -= duration;
        points.shift();
    }
    return points[0] ?? null;
}

export function advancePeerPath(points: WorldPoint[], distance: number): WorldPoint | null {
    return advanceTimedPeerPath(points, distance, 1);
}
