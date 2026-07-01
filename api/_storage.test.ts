import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeRoutedKv, type KvLike } from './_storage.js';
import { consumeSingleUseToken } from './_single-use-token.js';

// The routed KV splits keys across two backends — a disk overlay for the
// disk-routed prefixes ('save:', 'save-snapshot:', 'shared:images',
// 'shared:imgfields') and the base store for everything else. For mget the routing layer must issue ONE
// batched call per backend (so the remote/Vercel overlay does a single HTTP
// round-trip, not one per key) and then re-interleave the results back into the
// caller's original key order. These tests pin that contract: same values, same
// order, missing keys → null, and NO per-key get fallback.

// Minimal KvLike that records every mget/get and serves values from a map.
// Unused methods throw so the test fails loudly if mget ever takes the per-key
// path or touches a mutating op.
function makeStub(label: string, store: Record<string, unknown>, log: string[]): KvLike {
    const unused = (m: string) => (): never => { throw new Error(`${label}.${m} should not be called in an mget test`); };
    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            log.push(`${label}.get:${key}`);
            return (key in store ? store[key] : null) as T | null;
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            log.push(`${label}.mget:[${keys.join(',')}]`);
            return keys.map((k) => (k in store ? store[k] : null)) as (T[number] | null)[];
        },
        set: unused('set') as KvLike['set'],
        del: unused('del') as KvLike['del'],
        incr: unused('incr') as KvLike['incr'],
        keys: unused('keys') as KvLike['keys'],
        hgetall: unused('hgetall') as KvLike['hgetall'],
        hkeys: unused('hkeys') as KvLike['hkeys'],
        hset: unused('hset') as KvLike['hset'],
        hdel: unused('hdel') as KvLike['hdel'],
    };
}

describe('_makeRoutedKv.mget', () => {
    it('batches each backend once and re-interleaves into the original key order', async () => {
        const log: string[] = [];
        const base = makeStub('base', { 'presence:bob': 'B', 'queue:1': 'Q' }, log);
        const disk = makeStub('disk', { 'save:alice': 'A', 'save:carol': 'C' }, log);
        const kv = _makeRoutedKv(base, disk);

        // Interleaved disk/base keys; one disk key is absent → expect null in slot.
        const keys = ['save:alice', 'presence:bob', 'save:carol', 'queue:1', 'save:missing'];
        const out = await kv.mget(...keys);

        // Values align to the input order, missing key is null.
        assert.deepEqual(out, ['A', 'B', 'C', 'Q', null]);
        // Exactly one batched call per backend, each preserving sub-order; no per-key gets.
        assert.deepEqual([...log].sort(), [
            'base.mget:[presence:bob,queue:1]',
            'disk.mget:[save:alice,save:carol,save:missing]',
        ].sort());
        assert.equal(log.some((l) => l.includes('.get:')), false);
    });

    it('all disk-routed keys → only the disk backend is queried (one call)', async () => {
        const log: string[] = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', { 'save:a': 1, 'save:b': 2 }, log);
        const out = await _makeRoutedKv(base, disk).mget('save:a', 'save:b');
        assert.deepEqual(out, [1, 2]);
        assert.deepEqual(log, ['disk.mget:[save:a,save:b]']);
    });

    it('all base-routed keys → only the base backend is queried (one call)', async () => {
        const log: string[] = [];
        const base = makeStub('base', { 'x:1': 'x', 'y:2': 'y' }, log);
        const disk = makeStub('disk', {}, log);
        const out = await _makeRoutedKv(base, disk).mget('x:1', 'y:2');
        assert.deepEqual(out, ['x', 'y']);
        assert.deepEqual(log, ['base.mget:[x:1,y:2]']);
    });

    it('empty key list returns [] and queries neither backend', async () => {
        const log: string[] = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', {}, log);
        const out = await _makeRoutedKv(base, disk).mget();
        assert.deepEqual(out, []);
        assert.deepEqual(log, []);
    });

    it('repeated and adjacent same-backend keys keep their order and duplicates', async () => {
        const log: string[] = [];
        const base = makeStub('base', { 'queue:1': 'Q' }, log);
        const disk = makeStub('disk', { 'save:a': 'A' }, log);
        const out = await _makeRoutedKv(base, disk).mget('save:a', 'save:a', 'queue:1', 'save:a');
        assert.deepEqual(out, ['A', 'A', 'Q', 'A']);
    });

    it('save-snapshot: routes to DISK (backups go to cPanel), auth: stays on base', async () => {
        const log: string[] = [];
        const base = makeStub('base', { 'auth:alice': 'pw' }, log);
        const disk = makeStub('disk', { 'save:alice': 'LIVE', 'save-snapshot:alice:1700000000000': 'SNAP' }, log);
        const out = await _makeRoutedKv(base, disk).mget('save:alice', 'save-snapshot:alice:1700000000000', 'auth:alice');
        assert.deepEqual(out, ['LIVE', 'SNAP', 'pw']);
        // The snapshot blob must land in the DISK batch (cPanel), NOT the base
        // store (Supabase) — and 'save:' must not swallow 'save-snapshot:'.
        assert.deepEqual([...log].sort(), [
            'base.mget:[auth:alice]',
            'disk.mget:[save:alice,save-snapshot:alice:1700000000000]',
        ].sort());
    });
});

describe('consumeSingleUseToken', () => {
    it('returns the token when the delete actually consumed it', async () => {
        const token = { playerName: 'rin' };
        const store = {
            async get<T>() { return token as T; },
            async del() { return 1; },
        };

        assert.deepEqual(await consumeSingleUseToken(store, 'token:key'), token);
    });

    it('refuses a raced duplicate when the token was read but delete removed nothing', async () => {
        const store = {
            async get<T>() { return { playerName: 'rin' } as T; },
            async del() { return 0; },
        };

        assert.equal(await consumeSingleUseToken(store, 'token:key'), null);
    });

    it('does not delete when the token is absent', async () => {
        let delCalls = 0;
        const store = {
            async get<T>() { return null as T | null; },
            async del() { delCalls += 1; return 0; },
        };

        assert.equal(await consumeSingleUseToken(store, 'token:key'), null);
        assert.equal(delCalls, 0);
    });
});
