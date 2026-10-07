import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousWorldSpace, worldDistance } from './continuous-world-space';
import { buildWorldNavigation, createWorldWalker, worldRoute } from './continuous-world-navigation';

const space = buildContinuousWorldSpace();
const nodes = new Map(buildWorldNavigation(space).nodes.map(node => [node.id, node]));

test('all 93 roads have continuous reversible walkable connections', () => {
    for (const road of space.roads) {
        const a = `${road.a.sector}:${road.a.tile}`, b = `${road.b.sector}:${road.b.tile}`;
        const route = worldRoute(nodes, a, b);
        assert(route, road.a.id);
        assert(worldRoute(nodes, b, a));
        for (let i = 1; i < route.length; i++) {
            assert(worldDistance(nodes.get(route[i - 1]!)!, nodes.get(route[i]!)!) <= 1.000001);
        }
    }
});

test('a following camera can cross invisible zones without any position jump', () => {
    const road = space.roads.find(r => r.a.sector === 9 || r.b.sector === 9)!;
    const a = `${road.a.sector}:${road.a.tile}`, b = `${road.b.sector}:${road.b.tile}`;
    const walker = createWorldWalker(nodes, a);
    assert(walker.go(b));
    let crossed = false, frames = 0;
    while (walker.moving && frames++ < 30000) {
        const prior = walker.position;
        const zones = walker.tick(1 / 60);
        crossed = crossed || zones.length > 0;
        assert(worldDistance(prior, walker.position) <= 6.5 / 60 + 1e-8);
    }
    assert(crossed); assert.equal(walker.node.id, b); assert(!walker.moving);
});

test('pause and cancel halt travel; unreachable requests do not replace a valid route', () => {
    const road = space.roads[0]!, a = `${road.a.sector}:${road.a.tile}`, b = `${road.b.sector}:${road.b.tile}`;
    const walker = createWorldWalker(nodes, a);
    walker.go(b); walker.tick(.05); walker.pause(true);
    const paused = walker.position;
    walker.tick(.05); assert.deepEqual(walker.position, paused);
    assert.equal(walker.go('99:78'), false);
    walker.pause(false); walker.tick(.05); assert.notDeepEqual(walker.position, paused);
    walker.stop(); const stopped = walker.position;
    walker.tick(.05); assert.deepEqual(walker.position, stopped);
});

test('crossing roads never invent an adjacency between unrelated sector pairs', () => {
    for (const node of nodes.values()) for (const id of node.neighbors) {
        const next = nodes.get(id)!;
        if (node.road && next.road) assert.equal(node.road, next.road);
        assert(next.neighbors.includes(node.id));
    }
});

test('a cursor restores the exact intermediate position after a reload', () => {
    const road = space.roads[0]!, a = `${road.a.sector}:${road.a.tile}`, b = `${road.b.sector}:${road.b.tile}`;
    const walker = createWorldWalker(nodes, a); walker.go(b); walker.tick(.05);
    const cursor = walker.cursor('test-layout');
    assert(cursor.progress > 0 && cursor.progress < 1);
    const restored = createWorldWalker(nodes, b);
    assert(restored.restore(cursor)); assert.deepEqual(restored.position, walker.position);
    assert.equal(restored.restore({ ...cursor, to: '99:78' }), false);
});
