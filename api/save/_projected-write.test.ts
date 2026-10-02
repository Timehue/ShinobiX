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

test('a lost response is still recognised when Postgres hands back the JSON form of the record', async (t) => {
    // Production reads come from Postgres jsonb: an undefined field is gone and
    // -0 is 0. mergePreservingImages keeps both, so `intended` carries them.
    const key = 'save:projlostjson';
    const previous = record(3, 10);
    await kv.set(key, previous);
    const realCompareSet = kv.compareSet.bind(kv);
    const realGet = kv.get.bind(kv);
    t.mock.method(kv, 'compareSet', async (k: string, expected: unknown, value: unknown) => {
        await realCompareSet(k, expected, value);
        throw new Error('socket hang up');
    });
    t.mock.method(kv, 'get', async (k: string) => {
        const stored = await realGet(k);
        return stored === null ? null : JSON.parse(JSON.stringify(stored));
    });
    const next = { _saveVersion: 4, character: { name: 'proj', ryo: 25, title: undefined, shield: -0 } };
    await projected.writeSaveProjected(key, next, previous);
    assert.deepEqual(await kv.get(key), { _saveVersion: 4, character: { name: 'proj', ryo: 25, shield: 0 } },
        'the write landed, so the call succeeds');
});
