import { before, test } from 'node:test';
import assert from 'node:assert/strict';
let kv: typeof import('../_storage.js').kv;
let retain: typeof import('./_travel-lease-retention.js').retainTravelLeases;
before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('../_storage.js'));
    ({ retainTravelLeases: retain } = await import('./_travel-lease-retention.js'));
});

test('dry run never writes; applying retains the exact lease past its old expiry', async () => {
    const key = 'world:travel-lease:retention';
    const now = Date.now();
    const raw = { originSector: 12, destinationSector: 13, arrivalAt: now + 3_000, moveId: 'legacy-retention', extra: 'preserved' };
    await kv.set(key, raw, { ex: 60 });
    let writes = 0;
    const store = { keys: kv.keys.bind(kv), get: kv.get.bind(kv), compareSet: (async (...args) => {
        writes++;
        return kv.compareSet(...args);
    }) as typeof kv.compareSet };
    assert.equal((await retain(store)).valid, 1);
    assert.equal(writes, 0);
    assert.equal((await retain(store, true)).retained, 1);
    const realNow = Date.now;
    try {
        Date.now = () => now + 86_400_000;
        assert.deepEqual(await kv.get(key), raw);
    } finally { Date.now = realNow; await kv.del(key); }
});

test('a concurrently settled journey is not resurrected by the migration', async () => {
    const key = 'world:travel-lease:retention-race';
    await kv.set(key, { originSector: 12, destinationSector: 13, arrivalAt: Date.now() });
    const summary = await retain({ keys: kv.keys.bind(kv), get: kv.get.bind(kv), compareSet: async (k, expected, value) => {
        await kv.del(k);
        return kv.compareSet(k, expected, value);
    } }, true);
    assert.equal(summary.changedDuringScan, 1);
    assert.equal(summary.retained, 0);
    assert.equal(await kv.get(key), null);
});

test('invalid rows are reported and left untouched', async () => {
    const key = 'world:travel-lease:retention-invalid';
    await kv.set(key, { destinationSector: 900 });
    const summary = await retain(kv, true);
    assert.equal(summary.invalid, 1);
    assert.equal(summary.retained, 0);
    assert.deepEqual(await kv.get(key), { destinationSector: 900 });
    await kv.del(key);
});
