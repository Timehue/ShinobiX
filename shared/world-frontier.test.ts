import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUOUS_WORLD_SPACE } from './continuous-world-layout';
import { buildWorldNavigation, buildWorldNavigationInSlices, worldRoute } from './continuous-world-navigation';
import { sectorExits } from './sector-links';
import { walkableTiles } from './sector-walk-mask';
import { worldRoadCrossings } from './world-road-crossings';

const navigation = buildWorldNavigation(CONTINUOUS_WORLD_SPACE);
const nodes = new Map(navigation.nodes.map(n => [n.id, n]));
const at = (x: number, y: number) => navigation.nodes.filter(n => Math.abs(n.x - x) < .01 && Math.abs(n.y - y) < .01);

test('open land surrounds sectors and roads, and every step is a unit cardinal move', () => {
    const land = navigation.nodes.filter(n => n.land);
    assert(land.length > 15_000, `${land.length} land cells`);
    for (const node of navigation.nodes) for (const id of node.neighbors) {
        const next = nodes.get(id)!;
        assert(next.neighbors.includes(node.id), `${node.id} -> ${id} is one-way`);
        assert(Math.abs(Math.abs(next.x - node.x) + Math.abs(next.y - node.y) - 1) < 1e-9, `${node.id} -> ${id} is not one step`);
    }
    for (const node of land) {
        assert.equal(node.tile !== undefined && walkableTiles(node.sector).includes(node.tile), true, `${node.id} has no legacy tile`);
    }
});

test('a step into another sector only exists where a road already links the two', () => {
    let crossings = 0;
    for (const node of navigation.nodes) for (const id of node.neighbors) {
        const next = nodes.get(id)!;
        if (next.sector === node.sector) continue;
        crossings++;
        assert(sectorExits(node.sector).some(e => e.destinationSector === next.sector), `${node.id} (${node.sector}) -> ${id} (${next.sector})`);
    }
    assert(crossings > 186);
    assert.equal(navigation.boundaries.length * 2, crossings, 'one dotted seam per sector-changing step');
});

test('painting edges open onto land instead of invisible walls', () => {
    let outward = 0, open = 0;
    for (const chunk of CONTINUOUS_WORLD_SPACE.chunks) for (const tile of walkableTiles(chunk.sector)) {
        const col = tile % 12, row = Math.floor(tile / 12), node = nodes.get(`${chunk.sector}:${tile}`)!;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            if (col + dc >= 0 && col + dc < 12 && row + dr >= 0 && row + dr < 12) continue;
            outward++;
            const x = chunk.x + col + dc + .5, y = chunk.y + row + dr + .5;
            if (node.neighbors.some(id => { const next = nodes.get(id)!; return Math.abs(next.x - x) < .01 && Math.abs(next.y - y) < .01; })) open++;
        }
    }
    assert(open / outward > .97, `${open}/${outward} outward steps open`);
    // Sector 1's south edge (row 12, column 7) and sector 14's west grass, from the audit.
    assert(nodes.get('1:138')!.neighbors.some(id => nodes.get(id)!.land));
    for (const tile of [12, 24, 36, 48, 72, 84, 96, 108]) {
        assert(nodes.get(`14:${tile}`)!.neighbors.some(id => !id.startsWith('14:')), `sector 14 tile ${tile} is walled in`);
    }
});

test('the road beside a painting can be stepped onto from that painting', () => {
    const road = nodes.get('road:14-15:2')!;
    assert(road.neighbors.includes('14:36'));
    assert(worldRoute(nodes, '14:72', '14:12'));
});

test('overpasses stay grade-separated: no land near a deck and no side step on it', () => {
    for (const crossing of worldRoadCrossings(CONTINUOUS_WORLD_SPACE.roads)) {
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            assert(!at(crossing.x + dx, crossing.y + dy).some(n => n.land), `land beside deck ${crossing.over}`);
        }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const node of at(crossing.x + dx, crossing.y + dy)) {
            if (!node.road) continue;
            const road = CONTINUOUS_WORLD_SPACE.roads.find(r => `${r.a.sector}-${r.b.sector}` === node.road)!;
            const mouths = [`${road.a.sector}:${road.a.tile}`, `${road.b.sector}:${road.b.tile}`];
            for (const id of node.neighbors) assert(nodes.get(id)!.road === node.road || mouths.includes(id), `${node.id} side-steps to ${id}`);
        }
    }
});

test('no invisible walls: walkable ground either steps across or shows a rock line', () => {
    const decks = worldRoadCrossings(CONTINUOUS_WORLD_SPACE.roads);
    const onDeck = (x: number, y: number) => decks.some(c => Math.abs(Math.floor(c.x) - x) <= 1 && Math.abs(Math.floor(c.y) - y) <= 1);
    const cells = new Map<string, typeof navigation.nodes>();
    for (const n of navigation.nodes) { const key = `${Math.floor(n.x)}:${Math.floor(n.y)}`; (cells.get(key) ?? cells.set(key, []).get(key)!).push(n); }
    const drawn = new Set(navigation.walls.map(w => `${w.x}:${w.y}`));
    let seams = 0;
    for (const [key, here] of cells) {
        const [x, y] = key.split(':').map(Number) as [number, number];
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const there = cells.get(`${x + dx}:${y + dy}`);
            if (!there || onDeck(x, y) || onDeck(x + dx, y + dy) || here.some(a => there.some(b => a.neighbors.includes(b.id)))) continue;
            seams++;
            assert(drawn.has(`${x + .5 + dx / 2}:${y + .5 + dy / 2}`), `invisible wall between ${here[0]!.id} and ${there[0]!.id}`);
        }
    }
    assert.equal(navigation.walls.length, seams);
    assert(seams < 20, `${seams} walled seams`);
});

test('the browser build pauses often and still returns the identical graph', async () => {
    let pauses = 0;
    const sliced = await buildWorldNavigationInSlices(CONTINUOUS_WORLD_SPACE, async () => { pauses++; }, 0);
    // Each step does at most a couple of thousand cells of work, so a phone gets
    // frequent chances to paint instead of one long freeze.
    assert(pauses > 150, `${pauses} slices`);
    assert.deepEqual(sliced.nodes.map(n => [n.id, n.sector, n.tile, n.neighbors]), navigation.nodes.map(n => [n.id, n.sector, n.tile, n.neighbors]));
    assert.deepEqual(sliced.boundaries, navigation.boundaries);
    assert.deepEqual(sliced.walls, navigation.walls);
    assert.equal(sliced.byId.size, sliced.nodes.length);
    for (const node of sliced.nodes) assert.equal(sliced.byId.get(node.id), node);
});

test('the frontier is derived identically on every build', () => {
    const again = buildWorldNavigation(CONTINUOUS_WORLD_SPACE);
    assert.deepEqual(again.nodes.map(n => [n.id, n.sector, n.tile, n.neighbors]), navigation.nodes.map(n => [n.id, n.sector, n.tile, n.neighbors]));
    assert.deepEqual(again.boundaries, navigation.boundaries);
});

test('walkable land is never drawn as cliff, and closed ground is', () => {
    for (const node of navigation.nodes) if (node.land || node.road) assert.equal(navigation.terrain.kind(node.x, node.y), 1, node.id);
    const chunk = CONTINUOUS_WORLD_SPACE.chunks[0]!;
    assert.equal(navigation.terrain.kind(chunk.x + 6, chunk.y + 6), 2);
    assert.equal(navigation.terrain.kind(-10_000, -10_000), 0);
});
