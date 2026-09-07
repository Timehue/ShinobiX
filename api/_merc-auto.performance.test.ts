import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('merc candidate selection reads live saves and cooldowns in two batches, preserving order and eligibility', async t => {
    const { kv } = await import('./_storage.js');
    const { liveMercTargets } = await import('./_merc-auto.js');
    const { isMercTargetOnCooldown } = await import('./_merc-roam.js');
    await kv.set('save:enemyone', { character: { village: 'Moonshadow', hp: 20, maxHp: 100 } });
    await kv.set('save:enemytwo', { character: { village: 'Moonshadow', hp: 80, maxHp: 100 } });
    await kv.set('save:friend', { character: { village: 'Stormveil', hp: 1, maxHp: 100 } });
    await kv.set('merc:target-cd:enemytwo', 2000);
    const get = t.mock.method(kv, 'get');
    const batch = t.mock.method(kv, 'mget');
    const names = ['Enemy One', 'Enemy Two', 'Friend', 'Missing'];
    assert.deepEqual(await liveMercTargets(names, 'Moonshadow', 1000), [
        { name: 'enemyone', village: 'Moonshadow', hp: 20, maxHp: 100 },
    ]);
    assert.equal(batch.mock.callCount(), 2);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(await isMercTargetOnCooldown('Enemy Two', 1000), true, 'the locked deployment still has its independent gate');
    const expired = await liveMercTargets(names, 'Moonshadow', 2000);
    assert.deepEqual(expired.map(target => target.name), ['enemyone', 'enemytwo']);
    assert.deepEqual(await liveMercTargets([], 'Moonshadow', 2000), []);
    assert.equal(batch.mock.callCount(), 4, 'empty candidates perform no reads');
});
