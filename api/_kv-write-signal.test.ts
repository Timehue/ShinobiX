import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let signal: typeof import('./_kv-write-signal.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    signal = await import('./_kv-write-signal.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

test('every kind of committed write to a watched key signals it; other keys and reads do not', async () => {
    const seen: string[] = [];
    const stop = signal.onKeyWritten('watch:a', () => seen.push('a'));
    await kv.get('watch:a');
    await kv.set('watch:other', 1);
    assert.deepEqual(seen, [], 'reads and unrelated keys are silent');

    await kv.set('watch:a', { v: 1 });
    await kv.compareSet('watch:a', { v: 1 }, { v: 2 });
    assert.equal(await kv.compareSet('watch:a', { v: 99 }, { v: 3 }), false);
    await kv.hset('watch:a', { f: 1 });
    await kv.hdel('watch:a', 'f');
    await kv.del('watch:a');
    await kv.incr('watch:a');
    assert.equal(await kv.delIfEqual('watch:a', 'nope'), false);
    await kv.del('watch:a');
    assert.equal(seen.length, 7, 'set, compareSet, hset, hdel, del, incr, del — failed CAS/compare-deletes stay silent');

    stop();
    await kv.set('watch:a', 5);
    assert.equal(seen.length, 7, 'unsubscribed');
    assert.equal(signal.__kvWriteSignalKeysForTest(), 0, 'no listener map is left behind');
});

test('a throwing listener cannot break the write or the other listeners', async () => {
    let calls = 0;
    const stopBad = signal.onKeyWritten('watch:b', () => { throw new Error('boom'); });
    const stopGood = signal.onKeyWritten('watch:b', () => { calls += 1; });
    assert.equal(await kv.set('watch:b', 1), 'OK');
    assert.equal(calls, 1);
    stopBad();
    stopGood();
});
