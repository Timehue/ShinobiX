import type { WorldRoad, WorldPoint } from './continuous-world-space';
export type WorldRoadCrossing = WorldPoint & { over: string; under: string; horizontal: boolean };
const roadId = (road: WorldRoad) => `${road.a.sector}-${road.b.sector}`;
/** An intersection in the painting is an overpass, never a new walk-graph junction. */
export function worldRoadCrossings(roads: readonly WorldRoad[]): WorldRoadCrossing[] {
    const result: WorldRoadCrossing[] = [];
    for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
        const under = roads[i]!, over = roads[j]!;
        for (let a = 1; a < under.points.length; a++) for (let b = 1; b < over.points.length; b++) {
            const p = under.points[a - 1]!, q = under.points[a]!, r = over.points[b - 1]!, s = over.points[b]!;
            const horizontal = r.y === s.y;
            if ((p.y === q.y) === horizontal) continue;
            const h = horizontal ? [r, s] : [p, q], v = horizontal ? [p, q] : [r, s];
            const x = v[0]!.x, y = h[0]!.y;
            if (x <= Math.min(h[0]!.x, h[1]!.x) || x >= Math.max(h[0]!.x, h[1]!.x)
                || y <= Math.min(v[0]!.y, v[1]!.y) || y >= Math.max(v[0]!.y, v[1]!.y)) continue;
            result.push({ x, y, horizontal, over: roadId(over), under: roadId(under) });
        }
    }
    return result;
}
