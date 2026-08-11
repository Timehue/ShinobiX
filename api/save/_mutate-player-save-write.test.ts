import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let writeVersionedPlayerSave: typeof import('./_mutate-player-save.js').writeVersionedPlayerSave;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ writeVersionedPlayerSave } = await import('./_mutate-player-save.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('versioned player saves fence the exact predecessor and recover only ambiguous committed writes', { concurrency: false }, async () => {
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);

    const rejectedKey = 'save:writeackreject';
    const rejectedRecord = { _saveVersion: 1, character: { name: 'writeackreject', ryo: 10 } };
    await originalSet(rejectedKey, rejectedRecord);
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === rejectedKey) return null as never;
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    await assert.rejects(
        writeVersionedPlayerSave(rejectedKey, rejectedRecord, { name: 'writeackreject', ryo: 20 }),
        /player-save-version-conflict/,
    );
    assert.deepEqual(await kv.get(rejectedKey), rejectedRecord);

    const committedThrowKey = 'save:writeackthrow';
    const committedThrowRecord = { _saveVersion: 5, character: { name: 'writeackthrow', ryo: 50 } };
    await originalSet(committedThrowKey, committedThrowRecord);
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        const result = await originalCompareSet(key, expected, value, options);
        if (key === committedThrowKey) throw new Error('lost-save-write-ack');
        return result;
    }) as typeof kv.compareSet;
    const committedThrow = await writeVersionedPlayerSave(
        committedThrowKey,
        committedThrowRecord,
        { name: 'writeackthrow', ryo: 60 },
    );
    assert.equal(committedThrow._saveVersion, 6);

    const precommitThrowKey = 'save:writeackprecommit';
    const precommitThrowRecord = { _saveVersion: 7, character: { name: 'writeackprecommit', ryo: 70 } };
    await originalSet(precommitThrowKey, precommitThrowRecord);
    kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
        if (key === precommitThrowKey) throw new Error('save-write-before-commit');
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    await assert.rejects(
        writeVersionedPlayerSave(precommitThrowKey, precommitThrowRecord, { name: 'writeackprecommit', ryo: 80 }),
        /save-write-before-commit/,
    );
    assert.deepEqual(await kv.get(precommitThrowKey), precommitThrowRecord);

    kv.compareSet = originalCompareSet as typeof kv.compareSet;
});
