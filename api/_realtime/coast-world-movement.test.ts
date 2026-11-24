import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coastWalkSpace, sectorPositionModel } from '../_coast-walk-space.js';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation.js';

process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.NODE_ENV = 'test';

test('coast seam uses the saved region, a durable cursor and a coast-only nearby roster', async () => {
    const { applyWorldMovement, nearbyWorldPlayers } = await import('./world-movement-service.js');
    const { onlineStore } = await import('./online-store.js');
    const { readWalkedTile, resumeWorldPositionFor } = await import('./walked-tile.js');
    const { kv } = await import('../_storage.js');
    const graph = buildWorldNavigation(coastWalkSpace), model = sectorPositionModel(101);
    const mouth = graph.nodes.find(n => n.road === '101-111' && n.sector === 101
        && n.neighbors.some(id => graph.byId.get(id)?.sector === 111))!;
    const across = graph.byId.get(mouth.neighbors.find(id => graph.byId.get(id)?.sector === 111)!)!;
    const cursor = (id: string) => ({ layoutVersion: coastWalkSpace.layoutVersion, from: id, to: id, progress: 0 });
    const from = cursor(mouth.id), to = cursor(across.id);
    const name = 'coastwalker';
    const walker = onlineStore.upsert({ name, sector: 101, restoredWorldPosition: from, tile: model.location(from).tile, character: null });
    onlineStore.upsert({ name: 'coastpeer', sector: 111, restoredWorldPosition: to, tile: model.location(to).tile, character: null });
    onlineStore.upsert({ name: 'homepeer', sector: 9, tile: 78, character: null });
    assert.deepEqual(nearbyWorldPlayers(walker).map(p => p.name), ['coastpeer']);
    const move = () => applyWorldMovement(name, { expectedSequence: 0, worldPosition: to });
    const save = (region: number) => kv.set('save:' + name, { character: { level: 85 }, questLines: {
        v: 1, active: {}, done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: region, unlocks: ['boat'] } },
    } });
    await save(1);
    assert.equal((await move()).ok, false);
    assert.deepEqual(onlineStore.get(name)?.worldPosition, from);
    await save(2);
    const accepted = await move();
    assert.ok(accepted.ok, JSON.stringify(accepted));
    assert.equal(accepted.sector, 111);
    assert.deepEqual(accepted.worldPosition, to);
    const { getTravelLease } = await import('./travel-lease.js');
    assert.deepEqual((await getTravelLease(name))?.worldPosition, to);
    // The lease commits before acknowledgement. The regular position checkpoint follows asynchronously.
    await new Promise<void>(resolve => setImmediate(resolve));
    const checkpoint = await readWalkedTile(kv, name);
    assert.deepEqual(resumeWorldPositionFor(checkpoint, 111, undefined), to);
    assert.equal(sectorPositionModel(9).read(to), null);
    assert.equal(model.fallback(9, 78), null);
});
