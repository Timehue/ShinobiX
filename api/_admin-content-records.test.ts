import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('combat catalogs share one admin-slot batch and one published-content batch', async t => {
    const { kv } = await import('./_storage.js');
    const { loadAdminCombatContent } = await import('./_admin-content.js');
    const { loadAdminAiObjects } = await import('./_admin-ai-catalog.js');
    const { loadAdminContentRecords } = await import('./_admin-content-records.js');
    await kv.set('save:admin1', {
        creatorJutsus: [{ id: 'j1', name: 'Old', updatedAt: 1 }],
        creatorItems: [{ id: 'i1', name: 'Sword' }],
        creatorAis: [{ id: 'a1', name: 'Guard' }],
    });
    await kv.set('save:admin2', { creatorJutsus: [{ id: 'j1', name: 'Recent', updatedAt: 3 }] });
    await kv.set('content:creatorItems', {
        field: 'creatorItems', version: 1, updatedAt: 1, updatedBy: 'admin1',
        value: [{ id: 'i1', name: '__ADMIN_DELETED_ITEM__' }],
    });
    const batch = t.mock.method(kv, 'mget');
    const read = t.mock.method(kv, 'get');
    const [combat, ais] = await Promise.all([loadAdminCombatContent(), loadAdminAiObjects()]);
    assert.equal(combat.jutsu.get('j1')?.name, 'Recent');
    assert.equal(combat.items.has('i1'), false, 'published tombstones still win');
    assert.equal(ais.get('a1')?.name, 'Guard');
    assert.equal(batch.mock.callCount(), 2);
    assert.equal(read.mock.callCount(), 0);
    assert.equal(batch.mock.calls.filter(call => call.arguments.includes('save:admin1')).length, 1);
    await kv.set('save:admin1', { creatorAis: [{ id: 'a2', name: 'New Guard' }] });
    const records = await loadAdminContentRecords();
    assert.deepEqual(records[0]?.creatorAis, [{ id: 'a2', name: 'New Guard' }], 'the shared reader adds no cache lifetime');
});
