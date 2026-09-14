import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { _makeMemoryKv, _pgKvForTest, closeStoragePool } from './_storage.js';
import { projectKvValue, readKvProjection, type KvProjection } from './_storage-projection.js';

const gallery = { ownerName: ['character', 'name'], savedBloodlines: ['savedBloodlines'] } satisfies KvProjection;

test('JSON projection retains explicit null and omits missing paths and unrelated save data', () => {
    const save = { character: { name: 'Akari', inventory: ['private'] }, savedBloodlines: null, savedImages: { large: 'x'.repeat(100_000) } };
    assert.deepEqual(projectKvValue(save, gallery), { ownerName: 'Akari', savedBloodlines: null });
    assert.deepEqual(projectKvValue({ character: {} }, gallery), {});
    for (const malformed of [null, 1, 'text', []]) assert.equal(projectKvValue(malformed, gallery), null);
    assert.deepEqual(projectKvValue(Object.create({ character: { name: 'inherited' } }), gallery), {});
    assert.equal(save.character.inventory[0], 'private');
});

test('compatibility projection preserves batch ordering, duplicates, missing/expired rows, and full-save authority', async t => {
    const store = _makeMemoryKv();
    const save = { _saveVersion: 7, character: { name: 'Akari', ryo: 123 }, savedBloodlines: [] };
    await store.set('save:a', save);
    await store.set('save:expired', save, { ex: -1 });
    const batch = t.mock.method(store, 'mget');
    assert.deepEqual(await readKvProjection(store, ['save:a', 'save:missing', 'save:a', 'save:expired'], gallery), [
        { ownerName: 'Akari', savedBloodlines: [] }, null, { ownerName: 'Akari', savedBloodlines: [] }, null,
    ]);
    assert.equal(batch.mock.callCount(), 1);
    assert.deepEqual(await store.get('save:a'), save);
    assert.deepEqual(await readKvProjection(store, [], gallery), []);
    assert.equal(batch.mock.callCount(), 1);
});

test('projection read errors propagate instead of publishing an empty successful snapshot', async () => {
    const store = _makeMemoryKv();
    store.mget = async () => { throw new Error('storage unavailable'); };
    await assert.rejects(readKvProjection(store, ['save:a'], gallery), /storage unavailable/);
});

test('Postgres projects in one parameterized query and never seeds a partial full-value cache', async t => {
    process.env.DATABASE_URL = 'postgresql://projection-test:projection-test@127.0.0.1/projection-test';
    t.after(closeStoragePool);
    const full = { character: { name: 'Akari', ryo: 321 }, savedBloodlines: [], privateData: 'kept' };
    const alias = "name'); DROP TABLE kv_store; --";
    const field = "weird'path";
    let selects = 0;
    const query = t.mock.method(pg.Pool.prototype, 'query', async (sql: string, params: unknown[]) => {
        selects++;
        if (sql.startsWith('SELECT key, CASE')) {
            assert.match(sql, /jsonb_typeof\(value\) = 'object'/);
            assert.match(sql, /key = ANY\(\$1::text\[\]\)/);
            assert.match(sql, /expires_at IS NULL OR expires_at > now\(\)/);
            assert.match(sql, /value #> \$3::text\[\] IS NULL/);
            assert.ok(!sql.includes(alias) && !sql.includes(field));
            assert.deepEqual(params, [['projection:a', 'projection:missing', 'projection:a'], alias, ['character', field]]);
            return { rows: [{ key: 'projection:a', value: { [alias]: 'projected' } }] };
        }
        assert.match(sql, /^SELECT value, expires_at/);
        return { rows: [{ value: full, expires_at: null }] };
    });
    const selected = await readKvProjection(_pgKvForTest, ['projection:a', 'projection:missing', 'projection:a'], { [alias]: ['character', field] });
    assert.deepEqual(selected, [{ [alias]: 'projected' }, null, { [alias]: 'projected' }]);
    assert.equal(selects, 1);
    assert.deepEqual(await _pgKvForTest.get('projection:a'), full);
    assert.equal(selects, 2, 'the later full read must hit storage');
    // Even a warmed full-value cache cannot delay an explicit projected read.
    await readKvProjection(_pgKvForTest, ['projection:a', 'projection:missing', 'projection:a'], { [alias]: ['character', field] });
    assert.equal(query.mock.callCount(), 3);
});
