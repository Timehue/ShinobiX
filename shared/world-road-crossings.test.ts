import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUOUS_WORLD_SPACE } from './continuous-world-layout';
import { worldRoadCrossings } from './world-road-crossings';
import { buildWorldNavigation } from './continuous-world-navigation';

test('every proper road intersection has one deliberate overpass and no invented junction', () => {
    const crossings = worldRoadCrossings(CONTINUOUS_WORLD_SPACE.roads);
    assert.equal(crossings.length, 13);
    assert.equal(new Set(crossings.map(c => `${c.x}:${c.y}:${c.over}:${c.under}`)).size, crossings.length);
    const nodes = new Map(buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes.map(n => [n.id, n]));
    for (const crossing of crossings) {
        assert.notEqual(crossing.over, crossing.under);
        const at = [...nodes.values()].filter(n => Math.hypot(n.x - crossing.x, n.y - crossing.y) < .01);
        assert(at.some(n => n.road === crossing.over)); assert(at.some(n => n.road === crossing.under));
        for (const node of at) for (const neighbor of node.neighbors) {
            if (nodes.get(neighbor)!.road) assert.equal(nodes.get(neighbor)!.road, node.road);
        }
    }
});
