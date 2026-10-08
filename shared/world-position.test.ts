import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTINUOUS_WORLD_SPACE, WORLD_LAYOUT_VERSION, worldPositionModel } from './continuous-world-layout';
import { buildWorldNavigation, worldGraphVersion } from './continuous-world-navigation';
import { sectorWalkMask } from './sector-walk-mask';
import { sectorExits } from './sector-links';
const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes;

test('admitted world version includes exact geometry, collision masks and graph rules', () => {
    const masks = CONTINUOUS_WORLD_SPACE.chunks.map(c => [c.sector, sectorWalkMask(c.sector)]);
    const { chunks, roads } = CONTINUOUS_WORLD_SPACE;
    const hash = createHash('sha256').update(JSON.stringify({ space: { chunks, roads }, masks })).digest('hex').slice(0, 20);
    assert.equal(WORLD_LAYOUT_VERSION, worldGraphVersion(`cw1-${hash}`));
    assert.equal(CONTINUOUS_WORLD_SPACE.layoutVersion, WORLD_LAYOUT_VERSION);
});

test('a cursor saved under the corridor-only graph falls back to its sector tile', () => {
    const p = model.fallback(14, 66)!;
    assert.equal(model.read({ ...p, layoutVersion: `cw1-${WORLD_LAYOUT_VERSION.slice(4, 24)}` }), null);
});

test('old saves initialize on valid existing tiles; special locations remain separate', () => {
    for (const c of CONTINUOUS_WORLD_SPACE.chunks) {
        const p = model.fallback(c.sector, 78); assert(p); assert(model.read(p));
        assert.equal(model.location(p).sector, c.sector);
    }
    assert.equal(model.fallback(0, 78), null); assert.equal(model.fallback(99, 78), null); assert.equal(model.fallback(54, 78), null);
});

test('malformed, obsolete and disconnected position claims fail closed', () => {
    const p = model.fallback(9, 78)!;
    for (const invalid of [null, [], {}, { ...p, layoutVersion: 'old' }, { ...p, progress: NaN }, { ...p, progress: Infinity }, { ...p, progress: -1 }, { ...p, progress: 2 }, { ...p, progress: '.5' }, { ...p, to: '15:78' }, { ...p, from: '__proto__' }, { ...p, progress: .5 }]) assert.equal(model.read(invalid), null);
    assert.deepEqual(model.read({ ...p, currency: 999999 }), p);
});

test('distance is measured along connected ground, including reverse movement', () => {
    const a = nodes.find(n => n.road && n.neighbors.length === 2)!;
    const b = a.neighbors[0]!;
    const p = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b, progress: .25 };
    const q = { ...p, progress: .75 };
    assert.equal(model.distanceWithin(p, q, .4), null);
    assert(Math.abs(model.distanceWithin(p, q, 1)! - .5) < 1e-8);
    assert.equal(model.distanceWithin(p, { ...p, from: b, to: a.id, progress: .75 }, 0), 0);
    assert.equal(model.distanceWithin(p, model.fallback(27, 78)!, 2), null);
});

test('sector membership is derived from the marked sector boundary, with a valid legacy tile', () => {
    const lookup = new Map(nodes.map(n => [n.id, n]));
    const roadsCrossed = new Set<string>();
    for (const a of nodes) for (const bId of a.neighbors) {
        const b = lookup.get(bId)!;
        if (a.sector === b.sector || a.id > b.id) continue;
        assert(sectorExits(a.sector).some(e => e.destinationSector === b.sector), `${a.id} -> ${b.id}`);
        const p = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b.id, progress: .49 };
        assert.equal(model.location(p).sector, a.sector);
        assert.equal(model.location({ ...p, progress: .51 }).sector, b.sector);
        assert.notEqual(model.location(p).tile, undefined); assert.notEqual(model.location({ ...p, progress: .51 }).tile, undefined);
        if (a.road && a.road === b.road) roadsCrossed.add(a.road);
    }
    // Every corridor still changes owner along its own length, as before the open land.
    assert.equal(roadsCrossed.size, CONTINUOUS_WORLD_SPACE.roads.filter(r => r.length > 2).length);
});
