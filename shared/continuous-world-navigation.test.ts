import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousWorldSpace, worldDistance } from './continuous-world-space';
import { buildWorldNavigation, createWorldWalker, worldGraphVersion, worldRoute } from './continuous-world-navigation';
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
            // A grid diagonal is the longest single step (sqrt 2); anything longer is a jump.
            assert(worldDistance(nodes.get(route[i - 1]!)!, nodes.get(route[i]!)!) <= Math.SQRT2 + 1e-6);
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
const isDiagonal = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) > .5 && Math.abs(a.y - b.y) > .5;
const cellAt = new Map([...nodes.values()].filter(n => !n.road && n.x % 1 !== 0).map(n => [`${Math.floor(n.x)},${Math.floor(n.y)}`, n]));

test('every diagonal step closes a square whose four sides are already steps', () => {
    let diagonals = 0;
    for (const a of nodes.values()) for (const id of a.neighbors) {
        const b = nodes.get(id)!;
        if (a.road || b.road || !isDiagonal(a, b)) continue;
        diagonals++;
        const side1 = cellAt.get(`${Math.floor(b.x)},${Math.floor(a.y)}`), side2 = cellAt.get(`${Math.floor(a.x)},${Math.floor(b.y)}`);
        for (const side of [side1, side2]) {
            assert(side, `${a.id} -> ${b.id} cuts past a missing cell`);
            assert(a.neighbors.includes(side.id) && side.neighbors.includes(b.id), `${a.id} -> ${b.id} cuts the corner at ${side.id}`);
        }
        assert(b.neighbors.includes(a.id), 'diagonal steps are two-way');
    }
    assert(diagonals > 1000, `the world has diagonal steps (${diagonals / 2})`);
});

test('a blocked corner gets no diagonal, an open one does', () => {
    // Find, in sector 46, one open diagonal and one diagonal whose side cell is not a step.
    let open = false, blocked = false;
    for (const a of nodes.values()) {
        if (a.sector !== 46 || a.road || a.land) continue;
        for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
            const b = cellAt.get(`${Math.floor(a.x) + dx},${Math.floor(a.y) + dy}`);
            if (!b || b.sector !== 46) continue;
            const s1 = cellAt.get(`${Math.floor(a.x) + dx},${Math.floor(a.y)}`), s2 = cellAt.get(`${Math.floor(a.x)},${Math.floor(a.y) + dy}`);
            const square = [s1, s2].every(s => s && a.neighbors.includes(s.id) && s.neighbors.includes(b.id));
            assert.equal(a.neighbors.includes(b.id), square, `${a.id} -> ${b.id}`);
            if (square) open = true; else blocked = true;
        }
    }
    assert(open && blocked, 'sector 46 has both an open and a blocked diagonal');
});

test('a tap destination two tiles off on both axes is reached by two diagonal steps', () => {
    // Every chain of two open north-east diagonals in sector 46 is the route a tap takes.
    let checked = 0;
    for (const a of nodes.values()) {
        if (a.sector !== 46 || a.road || a.land) continue;
        const mid = cellAt.get(`${Math.floor(a.x) + 1},${Math.floor(a.y) - 1}`);
        const end = mid && cellAt.get(`${Math.floor(a.x) + 2},${Math.floor(a.y) - 2}`);
        if (!mid || !end || !a.neighbors.includes(mid.id) || !mid.neighbors.includes(end.id)) continue;
        const route = worldRoute(nodes, a.id, end.id)!;
        assert.deepEqual(route, [a.id, mid.id, end.id], `${a.id} -> ${end.id}`);
        checked++;
    }
    assert(checked > 3, `sector 46 has open diagonal chains to check (${checked})`);
});
test('held diagonal keys pick the diagonal step, and slide along a wall when it is shut', () => {
    const walker = createWorldWalker(nodes, '46:66');
    walker.step({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }, true);
    walker.tick(.01);
    assert.equal(walker.cursor('t').to, '46:55', 'north-east from 46:66 is the open diagonal 46:55');
    // 46:55 -> 46:44 is a shut corner (see the tap test): north-east from 46:55 slides
    // onto one of its open straight steps instead of stopping.
    const slide = createWorldWalker(nodes, '46:55');
    assert(!nodes.get('46:55')!.neighbors.includes('46:44'));
    slide.step({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }, true);
    slide.tick(.01);
    assert(['46:43', '46:56'].includes(slide.cursor('t').to), `slid to ${slide.cursor('t').to}`);
    // The held heading leans toward the newest key (held-direction.ts), so at a shut
    // corner with both straight steps open, that key's axis decides the slide.
    const lean = (x: number, y: number) => { const n = Math.hypot(x, y); return { x: x / n, y: y / n }; };
    const corner = [...nodes.values()].find(a => {
        if (a.road || a.land || a.sector !== 46) return false;
        const east = cellAt.get(`${Math.floor(a.x) + 1},${Math.floor(a.y)}`), north = cellAt.get(`${Math.floor(a.x)},${Math.floor(a.y) - 1}`);
        const ne = cellAt.get(`${Math.floor(a.x) + 1},${Math.floor(a.y) - 1}`);
        return east && north && a.neighbors.includes(east.id) && a.neighbors.includes(north.id) && !(ne && a.neighbors.includes(ne.id));
    });
    assert(corner, 'sector 46 has a shut north-east corner with both straight steps open');
    const east = cellAt.get(`${Math.floor(corner.x) + 1},${Math.floor(corner.y)}`)!.id, north = cellAt.get(`${Math.floor(corner.x)},${Math.floor(corner.y) - 1}`)!.id;
    for (const [heading, expected] of [[lean(1, -.98), east], [lean(.98, -1), north]] as const) {
        const walker = createWorldWalker(nodes, corner.id);
        walker.step(heading, true);
        walker.tick(.01);
        assert.equal(walker.cursor('t').to, expected, `from ${corner.id}`);
    }});

test('the graph version names the diagonal rule, so cursors from before it are retired', () => {
    assert.match(worldGraphVersion('cw1-x'), /^cw1-x\.f\d+\.d1$/);
});