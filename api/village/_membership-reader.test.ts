import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectKvValue } from '../_storage-projection.js';
import type { KvLike } from '../_storage.js';
import { createVillageMembershipReader } from './_membership-reader.js';

test('membership batches project only villages, deduplicate concurrent names, and re-read after a change', async () => {
    const saves: Record<string, unknown> = {
        'save:one': { character: { village: 'Frostfang Village', inventory: ['private'] }, creatorEvents: ['large'] },
        'save:two': { character: { village: 'Moonshadow Village' } },
    };
    const batches: string[][] = [];
    const store: Pick<KvLike, 'get' | 'mget' | 'mgetProjected'> = {
        get: async () => { throw new Error('valid membership must not read a full save'); },
        mget: async () => { throw new Error('projection supported'); },
        mgetProjected: async (keys, projection) => {
            assert.deepEqual(projection, { village: ['character', 'village'] });
            batches.push(keys);
            return keys.map(key => projectKvValue(saves[key], projection));
        },
    };
    const reader = createVillageMembershipReader(store);
    assert.deepEqual(await Promise.all([reader.get('save:one'), reader.get('save:two'), reader.get('save:one')]), [
        { character: { village: 'Frostfang Village' } }, { character: { village: 'Moonshadow Village' } },
        { character: { village: 'Frostfang Village' } },
    ]);
    assert.deepEqual(batches, [['save:one', 'save:two']]);
    saves['save:one'] = { character: { village: 'Stormveil Village' } };
    delete saves['save:two'];
    assert.deepEqual(await Promise.all([reader.get('save:one'), reader.get('save:two')]), [
        { character: { village: 'Stormveil Village' } }, null,
    ]);
    assert.equal(batches.length, 2, 'settled membership results never become a save cache');
});

test('membership failures reject all joined reads and a later read retries', async () => {
    let fail = true;
    const reader = createVillageMembershipReader({
        get: async () => null,
        mget: async () => [],
        mgetProjected: async () => {
            if (fail) throw new Error('storage unavailable');
            return [{ village: 'Frostfang Village' }];
        },
    });
    const failed = await Promise.allSettled([reader.get('save:one'), reader.get('save:two'), reader.get('save:one')]);
    assert.ok(failed.every(result => result.status === 'rejected' && result.reason.message === 'storage unavailable'));
    fail = false;
    assert.deepEqual(await reader.get('save:one'), { character: { village: 'Frostfang Village' } });
});

test('compatibility stores batch full reads and preserve missing-village legacy semantics', async () => {
    const records: Record<string, unknown> = {
        'save:one': { character: { village: 'Frostfang Village' }, private: 'omitted' },
        'save:legacy': { character: {} }, 'save:missing-character': {},
    };
    let batches = 0;
    const direct: string[] = [];
    const reader = createVillageMembershipReader({
        get: async <T>(key: string) => { direct.push(key); return (records[key] ?? null) as T | null; },
        mget: async <T extends unknown[]>(...keys: string[]) => {
            batches++;
            return keys.map(key => (records[key] ?? null) as T[number] | null);
        },
    });
    assert.deepEqual(await Promise.all(Object.keys(records).map(key => reader.get(key))), [
        { character: { village: 'Frostfang Village' } }, { character: {} }, {},
    ]);
    assert.equal(batches, 1);
    assert.deepEqual(direct, ['save:legacy', 'save:missing-character']);
    assert.deepEqual(records['save:one'], { character: { village: 'Frostfang Village' }, private: 'omitted' });
});
