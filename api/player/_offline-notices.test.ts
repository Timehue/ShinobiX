process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let kv: typeof import('../_storage.js').kv;
let mod: typeof import('./_offline-notices.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mod = await import('./_offline-notices.js');
});

test('pushOfflineNotice appends in order; takeOfflineNotices delivers once and clears', async () => {
    await mod.pushOfflineNotice('Vic-Tim', { kind: 'sleeper-kill', by: 'Raiden', sector: 17, at: 100 });
    await mod.pushOfflineNotice('vic-tim', { kind: 'merc-raid', by: 'Frostfang mercenaries', village: 'Frostfang', sector: 9, at: 200 });

    const stored = await kv.get<unknown[]>(mod.offlineNoticesKey('vic-tim'));
    assert.equal(stored?.length, 2);

    const taken = await mod.takeOfflineNotices('vic-tim');
    assert.deepEqual(taken.map((n) => [n.kind, n.by, n.sector]), [
        ['sleeper-kill', 'Raiden', 17],
        ['merc-raid', 'Frostfang mercenaries', 9],
    ]);
    assert.equal(taken[1].village, 'Frostfang');

    assert.deepEqual(await mod.takeOfflineNotices('vic-tim'), [], 'one-shot: second take is empty');
    assert.equal(await kv.get(mod.offlineNoticesKey('vic-tim')), null, 'key deleted on delivery');
});

test('inbox is capped at 10 — oldest notices drop first', async () => {
    for (let i = 0; i < 13; i++) {
        await mod.pushOfflineNotice('capped', { kind: 'sleeper-kill', by: `a${i}`, sector: 1, at: i });
    }
    const taken = await mod.takeOfflineNotices('capped');
    assert.equal(taken.length, mod.OFFLINE_NOTICES_CAP);
    assert.equal(taken[0].by, 'a3');
    assert.equal(taken[9].by, 'a12');
});

test('malformed entries in the stored array are ignored', async () => {
    await kv.set(mod.offlineNoticesKey('junk'), [{ kind: 'nope' }, 'x', { kind: 'merc-raid', by: 'M', sector: 2, at: 5 }]);
    const taken = await mod.takeOfflineNotices('junk');
    assert.equal(taken.length, 1);
    assert.equal(taken[0].by, 'M');
    assert.deepEqual(mod.parseOfflineNotices(null), []);
    assert.deepEqual(mod.parseOfflineNotices('garbage'), []);
});

test('concurrent pushes under the key lock do not lose entries', async () => {
    await Promise.all(
        Array.from({ length: 5 }, (_, i) => mod.pushOfflineNotice('race', { kind: 'merc-raid', by: `m${i}`, sector: 3, at: i })),
    );
    const taken = await mod.takeOfflineNotices('race');
    assert.equal(taken.length, 5);
});


test('bounty notices round-trip with their amount/total fields', async () => {
    await mod.pushOfflineNotice('hunted', { kind: 'bounty-placed', by: 'Rill', sector: 0, at: 1, amount: 5_000, total: 12_000 });
    await mod.pushOfflineNotice('hunted', { kind: 'bounty-claimed', by: 'Kenji', sector: 0, at: 2, amount: 12_000 });
    const taken = await mod.takeOfflineNotices('hunted');
    assert.deepEqual(taken.map((n) => [n.kind, n.by, n.amount, n.total]), [
        ['bounty-placed', 'Rill', 5_000, 12_000],
        ['bounty-claimed', 'Kenji', 12_000, undefined],
    ]);
});
