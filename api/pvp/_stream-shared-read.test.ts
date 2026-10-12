import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let shared: typeof import('./_stream-shared-read.js');
const KEY = 'pvp:shared-read-test';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    shared = await import('./_stream-shared-read.js');
});

beforeEach(async () => {
    while (shared.__sharedStreamReadState().viewers) shared.releaseSharedStreamRead(KEY);
    shared.releaseSharedStreamRead(KEY);
    await kv.set(KEY, { battleId: 'shared-read-test', turn: 1 });
});

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

test('every viewer woken at once shares one database read', async (t) => {
    const get = t.mock.method(kv, 'get');
    shared.retainSharedStreamRead(KEY);
    const reads = await Promise.all(Array.from({ length: 30 }, () => shared.readSharedStreamSession(KEY)));
    assert.equal(get.mock.callCount(), 1, '30 viewers, one read');
    assert.ok(reads.every((value) => (value as { turn: number }).turn === 1));
    shared.releaseSharedStreamRead(KEY);
});

test('a result is reused briefly, then read again', async (t) => {
    const get = t.mock.method(kv, 'get');
    let clock = 1_000;
    shared.retainSharedStreamRead(KEY);
    await shared.readSharedStreamSession(KEY, () => clock);
    clock += shared.SHARED_READ_TTL_MS - 1;
    await shared.readSharedStreamSession(KEY, () => clock);
    assert.equal(get.mock.callCount(), 1, 'inside the window: reused');
    clock += 1;
    await shared.readSharedStreamSession(KEY, () => clock);
    assert.equal(get.mock.callCount(), 2, 'past the window: a fresh read');
    shared.releaseSharedStreamRead(KEY);
});

test('a write discards the shared result and any read already in flight', async (t) => {
    const original = kv.get.bind(kv);
    const gate = deferred();
    let calls = 0;
    t.mock.method(kv, 'get', async (key: string) => {
        calls += 1;
        const value = await original(key);
        if (calls === 1) await gate.promise; // the first read straddles the write
        return value;
    });
    shared.retainSharedStreamRead(KEY);
    const stale = shared.readSharedStreamSession(KEY);
    await kv.set(KEY, { battleId: 'shared-read-test', turn: 2 });
    shared.forgetSharedStreamRead(KEY); // what the stream's write listener does
    const woken = await shared.readSharedStreamSession(KEY);
    assert.equal((woken as { turn: number }).turn, 2, 'a viewer woken by the write never joins the older read');
    gate.resolve();
    assert.equal(((await stale) as { turn: number }).turn, 1);
    const later = await shared.readSharedStreamSession(KEY);
    assert.equal((later as { turn: number }).turn, 2, 'the older read is never published over the newer one');
    shared.releaseSharedStreamRead(KEY);
});

test('a failed read is not shared with the next viewer', async (t) => {
    let fail = true;
    const original = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (key: string) => {
        if (fail) throw new Error('database unavailable');
        return original(key);
    });
    shared.retainSharedStreamRead(KEY);
    await assert.rejects(shared.readSharedStreamSession(KEY), /database unavailable/);
    fail = false;
    assert.equal(((await shared.readSharedStreamSession(KEY)) as { turn: number }).turn, 1);
    shared.releaseSharedStreamRead(KEY);
});

test('the stream reads only through the shared reader and forgets it on every heard write', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('api/pvp/stream.ts', 'utf8');
    assert.doesNotMatch(source, /kv\.get<unknown>\(key\)/, 'no stream read bypasses the shared reader');
    assert.equal(source.match(/readSharedStreamSession\(key\)/g)?.length, 2, 'the initial read and the tick read');
    assert.match(source, /onKeyWritten\(key, \(\) => \{ forgetSharedStreamRead\(key\); signals\.markDirty\(\); \}\)/);
    assert.match(source, /retainSharedStreamRead\(key\)/);
    assert.match(source, /finally \{\s*stopListening\(\);\s*releaseSharedStreamRead\(key\);/);
});

test('the last viewer out drops the battle state', async () => {
    shared.retainSharedStreamRead(KEY);
    shared.retainSharedStreamRead(KEY);
    await shared.readSharedStreamSession(KEY);
    shared.forgetSharedStreamRead(KEY);
    await shared.readSharedStreamSession(KEY);
    shared.releaseSharedStreamRead(KEY);
    assert.equal(shared.__sharedStreamReadState().entries, 1, 'one viewer still watching');
    shared.releaseSharedStreamRead(KEY);
    assert.deepEqual(shared.__sharedStreamReadState(), { entries: 0, generations: 0, viewers: 0 });
});
