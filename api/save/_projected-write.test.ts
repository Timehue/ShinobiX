import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let projected: typeof import('./_projected-write.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    projected = await import('./_projected-write.js');
});

const record = (version: number, ryo: number) => ({ _saveVersion: version, character: { name: 'proj', ryo } });

test('commits over the exact row it read', async () => {
    const key = 'save:projcommit';
    const previous = record(3, 10);
    await kv.set(key, previous);
    await projected.writeSaveProjected(key, record(4, 25), previous);
    assert.deepEqual(await kv.get(key), record(4, 25));
});

test('a row changed by another writer is never overwritten; the caller gets a conflict', async () => {
    const key = 'save:projconflict';
    const previous = record(3, 10);
    await kv.set(key, previous);
    // Another writer committed after `previous` was read (its lock had expired).
    await kv.set(key, record(4, 1000));
    await assert.rejects(
        projected.writeSaveProjected(key, record(4, 25), previous),
        (error: unknown) => projected.isPlayerSaveVersionConflict(error),
    );
    assert.deepEqual(await kv.get(key), record(4, 1000), 'the other writer\'s commit survives');
});

test('a lost response is recognised by read-back, any other transport error is rethrown', async (t) => {
    const key = 'save:projlost';
    const previous = record(3, 10);
    await kv.set(key, previous);
    const realCompareSet = kv.compareSet.bind(kv);
    let landed = true;
    t.mock.method(kv, 'compareSet', async (k: string, expected: unknown, value: unknown) => {
        if (landed) await realCompareSet(k, expected, value);
        throw new Error('socket hang up');
    });
    await projected.writeSaveProjected(key, record(4, 25), previous);
    assert.deepEqual(await kv.get(key), record(4, 25), 'the write landed, so the call succeeds');

    landed = false;
    await assert.rejects(projected.writeSaveProjected(key, record(5, 40), record(4, 25)), /socket hang up/);
});
