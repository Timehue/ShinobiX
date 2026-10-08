import { worldDistance, type WorldPoint } from '../../../shared/continuous-world-space';
import type { WorldNode } from '../../../shared/continuous-world-navigation';
import type { WorldRoadCrossing } from '../../../shared/world-road-crossings';

/** Walkable nodes a tap could mean, nearest first. A tap on a bridge deck means
 *  the upper road: the road beneath shares the deck's coordinates but is hidden. */
export function tapCandidates(nodes: Iterable<WorldNode>, point: WorldPoint, crossings: readonly WorldRoadCrossing[]) {
    const deck = crossings.find(c => Math.abs(c.horizontal ? point.x - c.x : point.y - c.y) <= 1.75
        && Math.abs(c.horizontal ? point.y - c.y : point.x - c.x) <= .95);
    return [...nodes].map(node => ({ node, distance: worldDistance(node, point) + (deck && node.road === deck.under ? 3 : 0) }))
        .filter(item => item.distance < 2).sort((a, b) => a.distance - b.distance);
}
