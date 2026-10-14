import { worldDistance, type WorldPoint } from '../../../shared/continuous-world-space';
import type { WorldNode } from '../../../shared/continuous-world-navigation';
import type { WorldRoadCrossing } from '../../../shared/world-road-crossings';

/** A tap means a node closer than this. */
const TAP_REACH = 2;

/** Walkable nodes a tap could mean, nearest first. A tap on a bridge deck means
 *  the upper road: the road beneath shares the deck's coordinates but is hidden. */
export function tapCandidates(nodes: Iterable<WorldNode>, point: WorldPoint, crossings: readonly WorldRoadCrossing[]) {
    const deck = tapDeck(point, crossings);
    return [...nodes].map(node => ({ node, distance: worldDistance(node, point) + (deck && node.road === deck.under ? 3 : 0) }))
        .filter(item => item.distance < TAP_REACH).sort((a, b) => a.distance - b.distance);
}

function tapDeck(point: WorldPoint, crossings: readonly WorldRoadCrossing[]) {
    return crossings.find(c => Math.abs(c.horizontal ? point.x - c.x : point.y - c.y) <= 1.75
        && Math.abs(c.horizontal ? point.y - c.y : point.x - c.x) <= .95);
}

/**
 * tapCandidates over a whole world graph without scanning it: the world has
 * tens of thousands of nodes, and every tap used to measure (and allocate an
 * entry for) each one, a visible stall on a phone. Nodes are bucketed by whole
 * cell once; a tap measures only the cells within reach. The answer is exactly
 * tapCandidates': the same nodes, and the same order among equal distances
 * (the graph's own order, which a stable sort of the full scan kept).
 */
export function createTapIndex(nodes: Iterable<WorldNode>) {
    const cells = new Map<string, Array<{ node: WorldNode; order: number }>>();
    let order = 0;
    for (const node of nodes) {
        const key = `${Math.floor(node.x)},${Math.floor(node.y)}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push({ node, order }); else cells.set(key, [{ node, order }]);
        order++;
    }
    return (point: WorldPoint, crossings: readonly WorldRoadCrossing[]) => {
        const deck = tapDeck(point, crossings);
        const found: Array<{ node: WorldNode; distance: number; order: number }> = [];
        const x0 = Math.floor(point.x), y0 = Math.floor(point.y);
        for (let y = y0 - TAP_REACH; y <= y0 + TAP_REACH; y++) for (let x = x0 - TAP_REACH; x <= x0 + TAP_REACH; x++) {
            for (const { node, order: at } of cells.get(`${x},${y}`) ?? []) {
                const distance = worldDistance(node, point) + (deck && node.road === deck.under ? 3 : 0);
                if (distance < TAP_REACH) found.push({ node, distance, order: at });
            }
        }
        return found.sort((a, b) => a.distance - b.distance || a.order - b.order).map(({ node, distance }) => ({ node, distance }));
    };
}
