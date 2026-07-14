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
        assert.equal(await kv.hdel('registry', 'one', 'missing'), 1);
        assert.deepEqual(await kv.hgetall('registry'), { two: 22, three: 3 });
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
