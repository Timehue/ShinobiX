import type { WorldNode } from './continuous-world-navigation';
import { worldDistance, type WorldPoint, type WorldRoad } from './continuous-world-space';
import { nearestWalkableTile } from './sector-walk-mask';

/** Server-owned cursor on a versioned, walkable world edge. Never raw client x/y. */
export type WorldPosition = { layoutVersion: string; from: string; to: string; progress: number };

export function createWorldPositionModel(layoutVersion: string, nodes: ReadonlyMap<string, WorldNode>, roads: readonly WorldRoad[]) {
    const roadById = new Map(roads.map(r => [`${r.a.sector}-${r.b.sector}`, r]));
    const read = (value: unknown): WorldPosition | null => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const p = value as Partial<WorldPosition>;
        if (p.layoutVersion !== layoutVersion || typeof p.from !== 'string' || typeof p.to !== 'string'
            || typeof p.progress !== 'number' || !Number.isFinite(p.progress) || p.progress < 0 || p.progress > 1) return null;
        const a = nodes.get(p.from), b = nodes.get(p.to);
        if (!a || !b || (a.id === b.id ? p.progress !== 0 : !a.neighbors.includes(b.id))) return null;
        return { layoutVersion, from: a.id, to: b.id, progress: p.progress };
    };
    const point = (p: WorldPosition): WorldPoint => {
        const a = nodes.get(p.from)!, b = nodes.get(p.to)!;
        return { x: a.x + (b.x - a.x) * p.progress, y: a.y + (b.y - a.y) * p.progress };
    };
    const location = (p: WorldPosition) => {
        const a = nodes.get(p.from)!, b = nodes.get(p.to)!, node = p.progress < .5 ? a : b;
        const road = roadById.get(a.road ?? b.road ?? '');
        const tile = node.tile ?? (road?.a.sector === node.sector ? road.a.tile : road?.b.tile);
        return { sector: node.sector, tile };
    };
    const fallback = (sector: number, tile: number): WorldPosition | null => {
        const id = `${sector}:${nearestWalkableTile(sector, tile)}`;
        return nodes.has(id) ? { layoutVersion, from: id, to: id, progress: 0 } : null;
    };
    /** Bounded graph distance prevents a short XY jump across two unrelated roads. */
    const distanceWithin = (from: WorldPosition, to: WorldPosition, budget: number): number | null => {
        if (!read(from) || !read(to) || !Number.isFinite(budget) || budget < 0) return null;
        const a = nodes.get(from.from)!, b = nodes.get(from.to)!, c = nodes.get(to.from)!, d = nodes.get(to.to)!;
        let best = Infinity;
        if (a.id === c.id && b.id === d.id) best = Math.abs(from.progress - to.progress) * worldDistance(a, b);
        else if (a.id === d.id && b.id === c.id) best = Math.abs(from.progress - (1 - to.progress)) * worldDistance(a, b);
        const sourceLength = worldDistance(a, b), targetLength = worldDistance(c, d);
        const costs = new Map<string, number>();
        for (const [id, cost] of [[a.id, from.progress * sourceLength], [b.id, (1 - from.progress) * sourceLength]] as const) {
            costs.set(id, Math.min(cost, costs.get(id) ?? Infinity));
        }
        const targetCost = new Map<string, number>();
        for (const [id, cost] of [[c.id, to.progress * targetLength], [d.id, (1 - to.progress) * targetLength]] as const) {
            targetCost.set(id, Math.min(cost, targetCost.get(id) ?? Infinity));
        }
        const open = new Set(costs.keys());
        while (open.size) {
            let id = '', rank = Infinity;
            for (const candidate of open) if (costs.get(candidate)! < rank) { id = candidate; rank = costs.get(candidate)!; }
            open.delete(id);
            if (rank > Math.min(budget, best)) continue;
            if (targetCost.has(id)) best = Math.min(best, rank + targetCost.get(id)!);
            const node = nodes.get(id)!;
            for (const nextId of node.neighbors) {
                const cost = rank + worldDistance(node, nodes.get(nextId)!);
                if (cost > Math.min(budget, best) || cost >= (costs.get(nextId) ?? Infinity)) continue;
                costs.set(nextId, cost); open.add(nextId);
            }
        }
        return best <= budget + 1e-8 ? best : null;
    };
    return { read, point, location, fallback, distanceWithin };
}
