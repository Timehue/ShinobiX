import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv, _toSqlPattern } from './_storage.js';
import { makeGuardedRestKv, StorageLockCapabilityError, type GuardedRestRequest } from './_storage-lock-rest.js';
import { withKvLeaseContext, LockOwnershipLostError } from './_kv-lock-context.js';
import { onKeyWritten, signalKeyWritten } from './_kv-write-signal.js';

test('unlocked REST calls retain their original behavior without probing or requiring the RPC', async () => {
    let calls = 0;
    const store = makeGuardedRestKv(_makeMemoryKv(), async () => { calls++; throw new Error('uninstalled'); }, _toSqlPattern);
    await store.set('public-data', 3); assert.equal(await store.get('public-data'), 3);
    assert.equal(calls, 0);
});

test('all held REST operations send owners and exact arguments to one guarded RPC', async () => {
    const requests: GuardedRestRequest[] = [];
    const store = makeGuardedRestKv(_makeMemoryKv(), async request => {
        requests.push(request);
        return { data: request.p_operation === 'incr' ? '3' : null, error: null };
    }, _toSqlPattern);
    await withKvLeaseContext('lock:outer', 'outer-owner', () => withKvLeaseContext('lock:inner', 'inner-owner', async () => {
        await store.get('item'); await store.hgetall('hash'); await store.set('item', { n: 1 }, { nx: true, ex: 10 });
        await store.compareSet('item', null, 2); await store.del('a', 'b'); await store.delIfEqual('a', { id: 1 });
        assert.equal(await store.incr('counter'), 3); await store.keys('a_%*'); await store.mget('a', 'missing', 'a');
        await store.hkeys('hash', { nonEmptyStrings: true }); await store.hset('hash', { field: 'value' }); await store.hdel('hash', 'field');
    }));
    assert.equal(requests.length, 12);
    for (const request of requests) assert.deepEqual(request.p_leases, [
        { key: 'lock:inner', owner: 'inner-owner' }, { key: 'lock:outer', owner: 'outer-owner' },
    ]);
    assert.equal(requests[2].p_args.nx, true);
    assert.ok(typeof requests[2].p_args.expiresAt === 'string');
    assert.deepEqual(requests[3].p_args, { key: 'item', expected: null, value: 2, expiresAt: null });
    assert.deepEqual(requests[8].p_args.keys, ['a', 'missing', 'a']);
    assert.equal(requests[7].p_args.pattern, 'a\\_\\%%');
});

test('missing RPC fails protected calls closed; the wrapper never falls back to an unsafe write', async () => {
    const raw = _makeMemoryKv(); let calls = 0;
    const store = makeGuardedRestKv(raw, async () => { calls++; return { data: null, error: { code: 'PGRST202' } }; }, _toSqlPattern);
    await withKvLeaseContext('lock:save:player', 'owner', async () => {
        await assert.rejects(store.set('save:player', 10), StorageLockCapabilityError);
        await assert.rejects(store.set('save:player', 20), StorageLockCapabilityError);
    });
    assert.equal(calls, 1, 'a poisoned callback must not issue another request');
    assert.equal(await raw.get('save:player'), null);
});

test('expired-owner and ambiguous response errors poison subsequent reads and writes without replay', async () => {
    for (const error of [{ code: '55000', message: 'KV_LOCK_LOST' }, { code: 'NETWORK', message: 'lost response' }]) {
        let calls = 0;
        const store = makeGuardedRestKv(_makeMemoryKv(), async () => { calls++; return { data: null, error }; }, _toSqlPattern);
        await withKvLeaseContext('lock:balance', 'owner', async () => {
            await assert.rejects(store.set('balance', 1), error.code === '55000' ? LockOwnershipLostError : Error);
            await assert.rejects(store.get('balance'));
        });
        assert.equal(calls, 1);
    }
});

test('assigned adapter mocks remain compatible and detached protected callbacks are rejected', async () => {
    const raw = _makeMemoryKv();
    const store = makeGuardedRestKv(raw, async () => assert.fail('assigned mock must not call RPC'), _toSqlPattern);
    store.get = async <T>() => 7 as T;
    await withKvLeaseContext('lock:test', 'owner', async () => assert.equal(await store.get('item'), 7));
    const strict = makeGuardedRestKv(_makeMemoryKv(), async () => assert.fail('closed scope must not call RPC'), _toSqlPattern);
    let release!: () => void;
    const delay = new Promise<void>(resolve => { release = resolve; });
    let detached!: Promise<unknown>;
    await withKvLeaseContext('lock:test', 'owner', async () => { detached = delay.then(() => strict.set('item', 1)); });
    const rejected = assert.rejects(detached, /completed lock callback/);
    release(); await rejected;
});

test('guarded REST wakes registered key listeners only after a confirmed committed mutation', async t => {
    const key = 'pvp:guarded-rest-commit';
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let notifications = 0;
    t.after(onKeyWritten(key, () => { notifications++; }));
    const store = makeGuardedRestKv(_makeMemoryKv(), async () => {
        await gate;
        return { data: 'OK', error: null };
    }, _toSqlPattern, signalKeyWritten);
    await withKvLeaseContext('lock:pvp:guarded-rest-commit', 'owner', async () => {
        const write = store.set(key, { status: 'done' });
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(notifications, 0, 'pending RPC cannot optimistically wake a stream');
        release();
        await write;
        assert.equal(notifications, 1);
    });
});

test('guarded REST conditions and reads do not signal writes, while successful CAS and bulk deletion do', async t => {
    const keys = ['pvp:guarded-rest-a', 'pvp:guarded-rest-b'];
    const notified: string[] = [];
    for (const key of keys) t.after(onKeyWritten(key, () => { notified.push(key); }));
    let data: unknown = null;
    const store = makeGuardedRestKv(_makeMemoryKv(), async () => ({ data, error: null }), _toSqlPattern, signalKeyWritten);
    await withKvLeaseContext('lock:pvp:guarded-rest-conditions', 'owner', async () => {
        await store.set(keys[0], 1, { nx: true });
        data = false; await store.compareSet(keys[0], 0, 1); await store.delIfEqual(keys[0], 0);
        data = 0; await store.del(...keys); await store.get(keys[0]);
        assert.deepEqual(notified, []);
        data = true; await store.compareSet(keys[0], 0, 1);
        data = 2; await store.del(...keys);
        assert.deepEqual(notified, [keys[0], ...keys]);
    });
});

test('ambiguous guarded REST mutation responses do not wake listeners or replay', async t => {
    const key = 'pvp:guarded-rest-ambiguous';
    let notifications = 0;
    let requests = 0;
    t.after(onKeyWritten(key, () => { notifications++; }));
    const store = makeGuardedRestKv(_makeMemoryKv(), async () => {
        requests++;
        throw new Error('response lost after possible commit');
    }, _toSqlPattern, signalKeyWritten);
    await withKvLeaseContext('lock:pvp:guarded-rest-ambiguous', 'owner', async () => {
        await assert.rejects(store.set(key, 1));
        await assert.rejects(store.set(key, 1));
    });
    assert.equal(notifications, 0);
    assert.equal(requests, 1);
});
