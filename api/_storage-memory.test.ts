import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from './_storage.js';

describe('isolated QA memory KV', () => {
    it('preserves JSON isolation and supports NX, counters, patterns, and hashes', async () => {
        const kv = _makeMemoryKv();
        const source = { nested: { value: 1 } };
        assert.equal(await kv.set('save:one', source, { nx: true }), 'OK');
        source.nested.value = 99;
        assert.deepEqual(await kv.get('save:one'), { nested: { value: 1 } });
        assert.equal(await kv.set('save:one', { overwritten: true }, { nx: true }), null);

        assert.equal(await kv.incr('counter'), 1);
        assert.equal(await kv.incr('counter'), 2);
        assert.deepEqual((await kv.keys('save:*')).sort(), ['save:one']);
        assert.deepEqual(await kv.mget('save:one', 'missing'), [{ nested: { value: 1 } }, null]);

        assert.equal(await kv.hset('registry', { one: 1, two: 2 }), 2);
        assert.equal(await kv.hset('registry', { two: 22, three: 3 }), 1);
        assert.deepEqual((await kv.hkeys('registry')).sort(), ['one', 'three', 'two']);
        await kv.hset('image-registry', { good: 'data:image/png;base64,AAAA', empty: '', number: 1 });
        assert.deepEqual(await kv.hkeys('image-registry', { nonEmptyStrings: true }), ['good']);
        assert.equal(await kv.hdel('registry', 'one', 'missing'), 1);
        assert.deepEqual(await kv.hgetall('registry'), { two: 22, three: 3 });
    });

    it('delIfEqual deletes only when the stored value still matches', async () => {
        const kv = _makeMemoryKv();
        await kv.set('lock:x', 'ownerA');
        assert.equal(await kv.delIfEqual('lock:x', 'ownerB'), false, 'wrong token deletes nothing');
        assert.equal(await kv.get('lock:x'), 'ownerA', 'lock survives a non-owner release');
        assert.equal(await kv.delIfEqual('lock:x', 'ownerA'), true, 'owner deletes its own lock');
        assert.equal(await kv.get('lock:x'), null);
        assert.equal(await kv.delIfEqual('missing', 'anything'), false, 'absent key deletes nothing');
    });

    it('compareSet atomically matches the complete JSON value and preserves absence/TTL semantics', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:cas', { z: 2, nested: { b: true, a: [1, 2] } });

        assert.equal(await kv.compareSet(
            'save:cas',
            { nested: { a: [1, 2], b: true }, z: 2 },
            { version: 2 },
            { ex: 2 },
        ), true, 'object key order is not part of JSON equality');
        assert.equal(await kv.compareSet('save:cas', { version: 1 }, { corrupted: true }), false);
        assert.deepEqual(await kv.get('save:cas'), { version: 2 }, 'mismatch changes nothing');
        assert.equal(await kv.compareSet('missing', null, { created: true }), true);
        assert.equal(await kv.compareSet('missing', null, { overwritten: true }), false, 'null means absent, never overwrite');

        const realNow = Date.now;
        const started = realNow();
        Date.now = () => started + 2_001;
        try {
            assert.equal(await kv.compareSet('save:cas', null, { reclaimed: true }), true, 'expired row counts as absent');
        } finally {
            Date.now = realNow;
        }
    });

    it('delIfEqual will not delete a lock re-acquired by a new holder after expiry', async () => {
        // Reproduces the release TOCTOU: an old holder whose lease expired must
        // never delete the NEW holder's freshly-acquired lock.
        const kv = _makeMemoryKv();
        const realNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            assert.equal(await kv.set('lock:save:treasury', 'ownerA', { nx: true, ex: 5 }), 'OK');
            now += 5_001; // A's lease expires
            assert.equal(await kv.set('lock:save:treasury', 'ownerB', { nx: true, ex: 5 }), 'OK', 'B re-acquires');
            // A's late release must be a no-op against B's lock.
            assert.equal(await kv.delIfEqual('lock:save:treasury', 'ownerA'), false);
            assert.equal(await kv.get('lock:save:treasury'), 'ownerB', "B's lock survives A's stale release");
            assert.equal(await kv.delIfEqual('lock:save:treasury', 'ownerB'), true, 'B releases its own lock');
            assert.equal(await kv.get('lock:save:treasury'), null);
        } finally {
            Date.now = realNow;
        }
    });

    it('expires TTL entries and lets NX reclaim them', async () => {
        const kv = _makeMemoryKv();
        const realNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            assert.equal(await kv.set('lease', 'first', { ex: 2, nx: true }), 'OK');
            now += 2_001;
            assert.equal(await kv.get('lease'), null);
            assert.equal(await kv.set('lease', 'second', { nx: true }), 'OK');
            assert.equal(await kv.get('lease'), 'second');
        } finally {
            Date.now = realNow;
        }
    });
});
