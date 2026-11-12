import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousWorldSpace, worldDistance } from './continuous-world-space';
import { buildWorldNavigation, createWorldWalker, worldRoute } from './continuous-world-navigation';
import { sectorExits } from './sector-links';
import { worldRoadCrossings } from './world-road-crossings';

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
    const crossings = worldRoadCrossings(space.roads);
    const nearDeck = (n: { x: number; y: number }) => crossings.some(c => Math.abs(c.x - n.x) <= 3 && Math.abs(c.y - n.y) <= 3);
    for (const node of nodes.values()) for (const id of node.neighbors) {
        const next = nodes.get(id)!;
        // Side-by-side corridors may be stepped between, but never at an overpass,
        // and only where the two sectors already share a road.
        if (node.road && next.road && node.road !== next.road) {
            assert(!nearDeck(node) && !nearDeck(next), `${node.id} joins ${id} at an overpass`);
            assert(node.sector === next.sector || sectorExits(node.sector).some(e => e.destinationSector === next.sector), `${node.id} -> ${id}`);
        }
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

test('manual movement can turn back along a partly travelled edge without changing position', () => {
    const a = nodes.get('46:66')!;
    const b = a.neighbors.map(id => nodes.get(id)!).find(n => n.x > a.x && Math.abs(n.y-a.y) < .001)!;
    const walker = createWorldWalker(nodes, a.id);
    walker.step({x:1,y:0}, true);
    walker.tick(.025);
    walker.stop();
    const before = walker.cursor('test');
    assert.equal(before.to, b.id);
    const at = walker.position;
    walker.step({x:-1,y:0}, true);
    const reversed = walker.cursor('test');
    assert.deepEqual(walker.position, at);
    assert.equal(reversed.from, b.id);
    assert.equal(reversed.to, a.id);
    assert.ok(Math.abs(before.progress + reversed.progress - 1) < 1e-8);
    walker.tick(.01);
    assert.ok(walker.position.x < at.x);
});

test('fitted motion settles at a road node despite subpixel roundoff', () => {
    const walker = createWorldWalker(nodes,'46:66');
    walker.step({x:1,y:0},true);
    const edge = walker.nextSegment()!;
    for (let remaining=edge.distance; remaining>0; remaining-=.25)
        walker.tick((Math.min(.25,remaining)-1e-12)/6.5);
    assert.equal(walker.nextSegment(),null);
    assert.equal(walker.moving,false);
    walker.step({x:1,y:0},true);
    assert(walker.nextSegment());
});

test('a turn early on an edge steps back to the node just left and turns there', () => {
    const a = nodes.get('46:66')!;
    const east = a.neighbors.map(id => nodes.get(id)!).find(n => n.x > a.x && Math.abs(n.y - a.y) < .001)!;
    const north = a.neighbors.map(id => nodes.get(id)!).find(n => n.y < a.y && Math.abs(n.x - a.x) < .001)!;
    assert(east && north, 'tile 66 needs east and north neighbours for this test');
    const walker = createWorldWalker(nodes, a.id);
    walker.step({ x: 1, y: 0 }, true);
    walker.tick(.3 / 6.5); // 0.3 of a tile east
    walker.stop();
    walker.step({ x: 0, y: -1 }, true);
    assert.deepEqual(walker.pivot, { x: 0, y: -1 }, 'the pivot carries the heading it turns to');
    assert.equal(walker.cursor('test').to, a.id, 'it walks back toward the node it left');
    for (let i = 0; i < 20 && walker.moving; i++) walker.tick(.05);
    assert.equal(walker.node.id, a.id);
    assert.equal(walker.pivot, null, 'arriving ends the pivot');
    walker.step({ x: 0, y: -1 }, true);
    walker.tick(.01);
    assert.equal(walker.cursor('test').to, north.id, 'and then takes the new road from there');
});

test('a turn late on an edge, or with no road from the near node, finishes the edge', () => {
    const a = nodes.get('46:66')!;
    const east = a.neighbors.map(id => nodes.get(id)!).find(n => n.x > a.x && Math.abs(n.y - a.y) < .001)!;
    const late = createWorldWalker(nodes, a.id);
    late.step({ x: 1, y: 0 }, true);
    for (let left = .7; left > 1e-9; left -= .25) late.tick(Math.min(.25, left) / 6.5); // ticks are capped at 0.05 s
    late.stop();
    late.step({ x: 0, y: -1 }, true);
    assert.equal(late.pivot, null);
    assert.equal(late.cursor('test').to, east.id, 'past halfway it carries on to the far node');
    // A node with no neighbour in the turn's heading never pivots back to it.
    const deadEnd = [...nodes.values()].find(n => n.sector === 46 && n.tile !== undefined
        && !n.neighbors.some(id => nodes.get(id)!.y < n.y - .5)
        && n.neighbors.some(id => { const m = nodes.get(id)!; return m.x > n.x + .5 && Math.abs(m.y - n.y) < .001; }));
    assert(deadEnd, 'sector 46 needs a tile with an east road and none north');
    const blocked = createWorldWalker(nodes, deadEnd.id);
    blocked.step({ x: 1, y: 0 }, true);
    blocked.tick(.2 / 6.5);
    blocked.stop();
    blocked.step({ x: 0, y: -1 }, true);
    assert.equal(blocked.pivot, null);
    assert.notEqual(blocked.cursor('test').to, deadEnd.id);
});

test('a reversal is still a plain turn-around, not a pivot', () => {
    const walker = createWorldWalker(nodes, '46:66');
    walker.step({ x: 1, y: 0 }, true);
    walker.tick(.2 / 6.5);
    walker.stop();
    walker.step({ x: -1, y: 0 }, true);
    assert.equal(walker.pivot, null);
    assert.equal(walker.cursor('test').to, '46:66');
});