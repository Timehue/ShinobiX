import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUOUS_WORLD_SPACE } from '../../../shared/continuous-world-layout';
import { buildWorldNavigation } from '../../../shared/continuous-world-navigation';
import { worldRoadCrossings } from '../../../shared/world-road-crossings';
import { tapCandidates } from './world-tap';

const nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes;
const crossings = worldRoadCrossings(CONTINUOUS_WORLD_SPACE.roads);

test('a tap on any bridge deck chooses the upper road, never the road beneath', () => {
    assert.equal(crossings.length, 13);
    for (const crossing of crossings) for (const offset of [-1.2, 0, 1.2]) {
        const point = crossing.horizontal ? { x: crossing.x + offset, y: crossing.y + .2 } : { x: crossing.x + .2, y: crossing.y + offset };
        const candidates = tapCandidates(nodes, point, crossings);
        // Some decks start at a painting's edge, where the painted tile is the nearer meaning.
        if (offset === 0) assert.equal(candidates[0]?.node.road, crossing.over, `${crossing.over} over ${crossing.under}`);
        assert(!candidates.some(c => c.node.road === crossing.under), `${crossing.under} under ${crossing.over} at ${offset}`);
    }
});

test('away from a deck the nearest ground still wins', () => {
    const tile = nodes.find(n => n.id === '14:66')!;
    assert.equal(tapCandidates(nodes, { x: tile.x + .1, y: tile.y }, crossings)[0]!.node.id, '14:66');
});
