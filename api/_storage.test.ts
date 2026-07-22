import { describe, it, after, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _makeDiskKv, _makeRoutedKv, _makeRemoteKv, _migrateDiskRoutedKeys, _copyDiskRoutedKeysToBase, _toSqlPattern, _chunkArray, _collectPaginated, type KvLike } from './_storage.js';
import { consumeSingleUseToken } from './_single-use-token.js';

describe('SQL key-pattern escaping', () => {
    it('escapes LIKE metacharacters and escape characters before expanding glob syntax', () => {
        assert.equal(_toSqlPattern(String.raw`save:\alice_%*?`), String.raw`save:\\alice\_\%%_`);
    });
});

// PostgREST silently truncates every response at the project's max-rows setting
// (Supabase default 1000). These pin the pagination/chunking that keeps the REST
// backend's keys()/mget()/del() from silently dropping rows past that cap — the
// live save-snapshot prefix already holds ~880 rows, near the cap.
describe('PostgREST result-limit safety helpers', () => {
    it('_chunkArray splits into bounded, order-preserving, non-overlapping chunks', () => {
        assert.deepEqual(_chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
        assert.deepEqual(_chunkArray([], 3), []);
        assert.deepEqual(_chunkArray([1, 2], 10), [[1, 2]]);
        // Flattening a chunked list must reproduce the input exactly (no dupes/gaps).
        const input = Array.from({ length: 205 }, (_, i) => i);
        assert.deepEqual(_chunkArray(input, 50).flat(), input);
        assert.equal(_chunkArray(input, 50).length, 5); // 50,50,50,50,5
    });

    it('_collectPaginated drains every full page and stops on the first short page', async () => {
        // 2350 synthetic rows behind a 1000-row page cap → 3 pages (1000,1000,350).
        const total = 2350;
        const all = Array.from({ length: total }, (_, i) => `k${i}`);
        const ranges: Array<[number, number]> = [];
        const rows = await _collectPaginated(async (from, to) => {
            ranges.push([from, to]);
            return all.slice(from, to + 1);
        }, 1000);
        assert.equal(rows.length, total);
        assert.deepEqual(rows, all); // order preserved across pages
        assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('_collectPaginated makes a second request when the first page is exactly full', async () => {
        // Exactly one full page then empty — must probe the next page to learn it ended.
        const rows = await _collectPaginated(async (from) => (from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : []), 1000);
        assert.equal(rows.length, 1000);
    });

    it('_collectPaginated single short page → one request only', async () => {
        let calls = 0;
        const rows = await _collectPaginated(async () => { calls += 1; return [1, 2, 3]; }, 1000);
        assert.deepEqual(rows, [1, 2, 3]);
        assert.equal(calls, 1);
    });
});

// The routed KV splits keys across two backends — a disk overlay for the
// disk-routed prefixes ('save:', 'shared:images', 'shared:imgfields') and the
// base store for everything else. save-snapshot: is base-primary with a legacy
// disk fallback. For mget the routing layer must issue ONE
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
        delIfEqual: unused('delIfEqual') as KvLike['delIfEqual'],
        incr: unused('incr') as KvLike['incr'],
        keys: unused('keys') as KvLike['keys'],
        hgetall: unused('hgetall') as KvLike['hgetall'],
        hkeys: unused('hkeys') as KvLike['hkeys'],
        hset: unused('hset') as KvLike['hset'],
        hdel: unused('hdel') as KvLike['hdel'],
    };
}

function memoryKv(initial: Record<string, unknown> = {}): KvLike & { data: Map<string, unknown> } {
    const data = new Map(Object.entries(initial));
    const api: KvLike & { data: Map<string, unknown> } = {
        data,
        async get<T>(key: string) { return (data.has(key) ? data.get(key) : null) as T | null; },
        async set(key, value, options) {
            if (options?.nx && data.has(key)) return null;
            data.set(key, structuredClone(value));
            return 'OK';
        },
        async del(...keys) { let n = 0; for (const key of keys) if (data.delete(key)) n += 1; return n; },
        async delIfEqual(key, expected) { if (data.get(key) !== expected) return false; data.delete(key); return true; },
        async incr(key) { const n = Number(data.get(key) ?? 0) + 1; data.set(key, n); return n; },
        async keys(pattern) {
            const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return [...data.keys()].filter((key) => re.test(key));
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]) { return keys.map((key) => (data.has(key) ? data.get(key) : null)) as (T[number] | null)[]; },
        async hgetall<T>(key: string) { return (data.has(key) ? data.get(key) : null) as T | null; },
        async hkeys(key: string) { const v = data.get(key); return v && typeof v === 'object' ? Object.keys(v) : []; },
        async hset(key, fields) { data.set(key, { ...((data.get(key) as object) ?? {}), ...fields }); return Object.keys(fields).length; },
        async hdel(key, ...fields) { const v = { ...((data.get(key) as object) ?? {}) } as Record<string, unknown>; for (const f of fields) delete v[f]; data.set(key, v); return fields.length; },
    };
    return api;
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

    it('save-snapshot: routes to BASE (separate from live save disk), auth stays on base', async () => {
        const log: string[] = [];
        const base = makeStub('base', { 'auth:alice': 'pw', 'save-snapshot:alice:1700000000000': 'SNAP' }, log);
        const disk = makeStub('disk', { 'save:alice': 'LIVE' }, log);
        const out = await _makeRoutedKv(base, disk).mget('save:alice', 'save-snapshot:alice:1700000000000', 'auth:alice');
        assert.deepEqual(out, ['LIVE', 'SNAP', 'pw']);
        // Snapshot and auth share the base batch; the live save alone hits disk.
        assert.deepEqual([...log].sort(), [
            'base.mget:[save-snapshot:alice:1700000000000,auth:alice]',
            'disk.mget:[save:alice]',
        ].sort());
    });

    it('falls back to a legacy disk snapshot only when the base copy is absent', async () => {
        const log: string[] = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', { 'save-snapshot:alice:1700000000000': 'LEGACY' }, log);
        const out = await _makeRoutedKv(base, disk).mget('save-snapshot:alice:1700000000000');
        assert.deepEqual(out, ['LEGACY']);
        assert.deepEqual(log, [
            'base.mget:[save-snapshot:alice:1700000000000]',
            'disk.mget:[save-snapshot:alice:1700000000000]',
        ]);
    });
});

describe('_makeRoutedKv snapshot failure-domain routing', () => {
    it('writes new snapshots to base while live saves remain on disk', async () => {
        const base = memoryKv();
        const disk = memoryKv();
        const routed = _makeRoutedKv(base, disk);

        await routed.set('save:alice', { live: true });
        await routed.set('save-snapshot:alice:100', { backup: true });

        assert.deepEqual(await disk.get('save:alice'), { live: true });
        assert.equal(await base.get('save:alice'), null);
        assert.deepEqual(await base.get('save-snapshot:alice:100'), { backup: true });
        assert.equal(await disk.get('save-snapshot:alice:100'), null);
    });

    it('lists both base-primary and legacy disk snapshots without duplicates', async () => {
        const base = memoryKv({ 'save-snapshot:alice:100': 'base', 'save-snapshot:alice:200': 'both' });
        const disk = memoryKv({ 'save-snapshot:alice:50': 'legacy', 'save-snapshot:alice:200': 'legacy-duplicate' });
        const keys = await _makeRoutedKv(base, disk).keys('save-snapshot:alice:*');
        assert.deepEqual(keys.sort(), [
            'save-snapshot:alice:100',
            'save-snapshot:alice:200',
            'save-snapshot:alice:50',
        ].sort());
    });
});

describe('_migrateDiskRoutedKeys conflict safety', () => {
    it('never overwrites a newer/different overlay value and retains the source', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2, value: 'old' } });
        const overlay = memoryKv({ 'save:alice': { _saveVersion: 9, value: 'new' } });
        const result = await _migrateDiskRoutedKeys(base, overlay, ['save:']);

        assert.deepEqual(result.conflicts, ['save:alice']);
        assert.deepEqual(await overlay.get('save:alice'), { _saveVersion: 9, value: 'new' });
        assert.deepEqual(await base.get('save:alice'), { _saveVersion: 2, value: 'old' });
        assert.equal(result.deleted, 0);
    });

    it('copies with NX, verifies, then deletes an unchanged source', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        const overlay = memoryKv();
        const result = await _migrateDiskRoutedKeys(base, overlay, ['save:']);

        assert.deepEqual(result.migrated, ['save:alice']);
        assert.deepEqual(await overlay.get('save:alice'), { _saveVersion: 2 });
        assert.equal(await base.get('save:alice'), null);
        assert.equal(result.deleted, 1);
    });

    it('recognizes an identical destination and removes only the verified duplicate source', async () => {
        const value = { _saveVersion: 4, character: { name: 'Alice' } };
        const base = memoryKv({ 'save:alice': value });
        const overlay = memoryKv({ 'save:alice': value });
        const result = await _migrateDiskRoutedKeys(base, overlay, ['save:']);

        assert.deepEqual(result.alreadyPresent, ['save:alice']);
        assert.equal(result.conflicts.length, 0);
        assert.equal(await base.get('save:alice'), null);
        assert.deepEqual(await overlay.get('save:alice'), value);
    });

    it('losing the destination NX race reports a conflict without clobbering the winner', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        const backing = memoryKv();
        const overlay: KvLike = {
            ...backing,
            async set(key, _value, options) {
                if (options?.nx) {
                    await backing.set(key, { _saveVersion: 10, writer: 'concurrent' });
                    return null;
                }
                return backing.set(key, _value, options);
            },
        };
        const result = await _migrateDiskRoutedKeys(base, overlay, ['save:']);

        assert.deepEqual(result.conflicts, ['save:alice']);
        assert.deepEqual(await backing.get('save:alice'), { _saveVersion: 10, writer: 'concurrent' });
        assert.notEqual(await base.get('save:alice'), null);
    });

    it('detects a source mutation during copy and does not delete it', async () => {
        const backing = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        let reads = 0;
        const base: KvLike = {
            ...backing,
            async get<T>(key: string) {
                reads += 1;
                if (reads === 2) {
                    await backing.set(key, { _saveVersion: 3, writer: 'concurrent' });
                }
                return backing.get<T>(key);
            },
        };
        const overlay = memoryKv();
        const result = await _migrateDiskRoutedKeys(base, overlay, ['save:']);

        assert.deepEqual(result.conflicts, ['save:alice']);
        assert.deepEqual(await backing.get('save:alice'), { _saveVersion: 3, writer: 'concurrent' });
        assert.equal(result.deleted, 0);
    });
});

// The overlay→base copy that retires the disk overlay / cPanel. Unlike the
// migrate-TO-overlay path it must NEVER delete the source (rollback = re-point
// env at the intact overlay) and must OVERWRITE stale base copies (overlay is
// the source of truth). Every write is read back and compared.
describe('_copyDiskRoutedKeysToBase — retire-the-overlay copy', () => {
    it('copies every disk-routed key into base, verifies, and leaves the overlay intact', async () => {
        const overlay = memoryKv({
            'save:alice': { _saveVersion: 5, ryo: 100 },
            'save:bob': { _saveVersion: 2, ryo: 7 },
            'shared:images:cat': { a: 1 },
            'other:ignored': { keep: true },   // not a disk-routed prefix → untouched
        });
        const base = memoryKv();

        const r = await _copyDiskRoutedKeysToBase(overlay, base, ['save:', 'shared:images', 'shared:imgfields']);

        assert.equal(r.sourceCount, 3);
        assert.equal(r.copied, 3);
        assert.equal(r.verified, 3);
        assert.deepEqual(r.mismatches, []);
        // Base now holds byte-identical copies.
        assert.deepEqual(await base.get('save:alice'), { _saveVersion: 5, ryo: 100 });
        assert.deepEqual(await base.get('shared:images:cat'), { a: 1 });
        // Non-routed key was never copied.
        assert.equal(await base.get('other:ignored'), null);
        // Overlay is fully intact — cutover stays reversible.
        assert.deepEqual(await overlay.get('save:alice'), { _saveVersion: 5, ryo: 100 });
        assert.equal((await overlay.keys('save:*')).length, 2);
    });

    it('overwrites a stale legacy value already in base (overlay wins)', async () => {
        const overlay = memoryKv({ 'save:alice': { _saveVersion: 9, ryo: 999 } });
        const base = memoryKv({ 'save:alice': { _saveVersion: 1, ryo: 1 } }); // stale legacy copy

        const r = await _copyDiskRoutedKeysToBase(overlay, base, ['save:']);

        assert.equal(r.copied, 1);
        assert.deepEqual(r.mismatches, []);
        assert.deepEqual(await base.get('save:alice'), { _saveVersion: 9, ryo: 999 });
    });

    it('dryRun writes nothing to base but reports what would copy', async () => {
        const overlay = memoryKv({ 'save:alice': { ryo: 100 }, 'save:bob': { ryo: 7 } });
        const base = memoryKv();

        const r = await _copyDiskRoutedKeysToBase(overlay, base, ['save:'], { dryRun: true });

        assert.equal(r.copied, 2);
        assert.equal(r.verified, 0);      // nothing actually written/verified
        assert.equal(base.data.size, 0);  // base untouched
    });

    it('reports a mismatch when a base write does not read back equal (never silent)', async () => {
        const overlay = memoryKv({ 'save:alice': { ryo: 100 } });
        // A base whose set is a no-op → read-back is null → must be flagged, not counted as copied.
        const brokenBase: KvLike = {
            ...memoryKv(),
            async set() { return 'OK'; },
            async get() { return null; },
        };

        const r = await _copyDiskRoutedKeysToBase(overlay, brokenBase, ['save:']);

        assert.equal(r.copied, 0);
        assert.equal(r.verified, 0);
        assert.deepEqual(r.mismatches, ['save:alice']);
    });
});

// Transport resilience for the remote (cPanel) proxy overlay. The proxy box is
// bounced on every deploy and can be OOM-killed under load, dropping an in-flight
// response as a Passenger 502 — the GET /api/save/clan-* error this hardening
// targets. call() retries transient failures (502/503/504, network throw) but
// must NOT retry non-idempotent ops (a set with nx is a check-then-write claim).
describe('_makeRemoteKv transport resilience', () => {
    const realFetch = globalThis.fetch;
    let calls: string[] = [];

    // Queue-driven fake fetch: each entry is a status number (→ a Response with
    // that status) or 'throw' (→ a network error). The last entry repeats once
    // the queue is exhausted, so [502] means "502 forever".
    function installFetch(script: Array<number | 'throw'>): void {
        let i = 0;
        calls = [];
        globalThis.fetch = (async () => {
            const step = script[Math.min(i, script.length - 1)];
            i += 1;
            calls.push(String(step));
            if (step === 'throw') throw new Error('network down');
            return {
                ok: step >= 200 && step < 300,
                status: step,
                json: async () => ({ value: 'V', result: 'OK', count: 1 }),
                text: async () => `HTTP ${step} body`,
            };
        }) as unknown as typeof fetch;
    }

    afterEach(() => { globalThis.fetch = realFetch; });

    const kv = (): KvLike => _makeRemoteKv(
        'https://proxy.example/api/kv',
        'tok',
        { allowedHosts: new Set(['proxy.example']) },
    );

    it('rejects unapproved, insecure, and ambiguous proxy destinations before fetch', () => {
        for (const url of [
            'http://theravensark.com/api/kv',
            'https://evil.example/api/kv',
            'https://theravensark.com.evil.example/api/kv',
            'https://user:pass@theravensark.com/api/kv',
            'https://theravensark.com:444/api/kv',
            'https://theravensark.com/api/kv?next=evil',
            'https://theravensark.com/api/not-kv',
        ]) {
            assert.throws(() => _makeRemoteKv(url, 'tok'));
        }
        assert.doesNotThrow(() => _makeRemoteKv('https://theravensark.com/api/kv/', 'tok'));
    });

    it('retries a transient 502 and succeeds on a later attempt', async () => {
        installFetch([502, 502, 200]);
        assert.equal(await kv().get('save:clan-x'), 'V');
        assert.equal(calls.length, 3); // two retries, third attempt wins
    });

    it('gives up after 3 attempts when every try is a 502', async () => {
        installFetch([502]);
        await assert.rejects(kv().get('save:clan-x'), /HTTP 502/);
        assert.equal(calls.length, 3);
    });

    it('does NOT retry a deterministic 500 (fails fast, one call)', async () => {
        installFetch([500]);
        await assert.rejects(kv().get('save:clan-x'), /HTTP 500/);
        assert.equal(calls.length, 1);
    });

    it('retries a thrown network error', async () => {
        installFetch(['throw', 200]);
        assert.equal(await kv().get('save:clan-x'), 'V');
        assert.equal(calls.length, 2);
    });

    it('a plain set retries a transient 502', async () => {
        installFetch([502, 200]);
        assert.equal(await kv().set('save:clan-x', { a: 1 }), 'OK');
        assert.equal(calls.length, 2);
    });

    it('a set with nx is NOT retried — check-then-write is not idempotent', async () => {
        installFetch([502]);
        await assert.rejects(kv().set('save:clan-x', { a: 1 }, { nx: true }), /HTTP 502/);
        assert.equal(calls.length, 1); // single attempt only
    });

    it('filtered hkeys requires a proxy capability acknowledgement during rolling deploys', async () => {
        let sentBody = '';
        globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
            sentBody = String(init?.body ?? '');
            return {
                ok: true,
                status: 200,
                json: async () => ({ fields: ['good'], nonEmptyStringsApplied: true }),
                text: async () => '',
            };
        }) as unknown as typeof fetch;
        assert.deepEqual(await kv().hkeys('shared:imgfields:event', { nonEmptyStrings: true }), ['good']);
        assert.equal(JSON.parse(sentBody).options.nonEmptyStrings, true);

        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ fields: ['good', 'empty'] }),
            text: async () => '',
        })) as unknown as typeof fetch;
        await assert.rejects(
            kv().hkeys('shared:imgfields:event', { nonEmptyStrings: true }),
            /does not support filtered hkeys/,
        );
    });
});

// Regression (2026-07-09): disk-overlay hset/hdel are read-modify-write over a
// single JSON file. Unserialized, N parallel hsets all read the same snapshot
// and the last write wins — concurrently-published images vanished from the
// shared:imgfields:<cat> id manifest (GET /api/images?cat=X&ids=1) while
// remaining individually servable via their own shared:img:<id> keys. These
// tests hammer the ops that must now serialize per key (_withDiskKeyLock).
describe('_makeDiskKv concurrent RMW', () => {
    const root = mkdtempSync(join(tmpdir(), 'shinobix-diskkv-'));
    after(() => rmSync(root, { recursive: true, force: true }));

    it('N parallel hset calls land all N fields (no lost updates)', async () => {
        const kv = _makeDiskKv(root);
        const N = 25;
        await Promise.all(Array.from({ length: N }, (_, i) =>
            kv.hset('shared:imgfields:shrine', { [`shrine:tile-${i}`]: `img-${i}` }),
        ));
        const keys = await kv.hkeys('shared:imgfields:shrine');
        assert.equal(keys.length, N, `manifest lost ${N - keys.length} of ${N} concurrent fields`);
    });

    it('parallel hsets across TWO instances on the same root land all fields', async () => {
        // kv's _diskOverlay and the /api/kv proxy's _diskKvForProxy are separate
        // _makeDiskKv instances over one root in the same process — the
        // serialization must be shared between them, not per-instance.
        const a = _makeDiskKv(root);
        const b = _makeDiskKv(root);
        await Promise.all(Array.from({ length: 10 }, (_, i) =>
            (i % 2 ? a : b).hset('shared:imgfields:pet', { [`pet:${i}`]: 'x' }),
        ));
        assert.equal((await a.hkeys('shared:imgfields:pet')).length, 10);
    });

    it('filtered hkeys excludes empty/non-string tombstones without changing normal hash semantics', async () => {
        const kv = _makeDiskKv(root);
        await kv.hset('shared:imgfields:event-filter', { good: 'data:image/png;base64,AAAA', empty: '', number: 1 });
        assert.deepEqual((await kv.hkeys('shared:imgfields:event-filter')).sort(), ['empty', 'good', 'number']);
        assert.deepEqual(await kv.hkeys('shared:imgfields:event-filter', { nonEmptyStrings: true }), ['good']);
    });

    it('concurrent hset + hdel settle to the exact expected field set', async () => {
        const kv = _makeDiskKv(root);
        await kv.hset('h:mix', { a: 1, b: 2 });
        await Promise.all([kv.hdel('h:mix', 'a'), kv.hset('h:mix', { c: 3 })]);
        const all = await kv.hgetall<Record<string, number>>('h:mix');
        assert.deepEqual(Object.keys(all ?? {}).sort(), ['b', 'c']);
    });

    it('set nx: exactly one of N concurrent claimers wins', async () => {
        const kv = _makeDiskKv(root);
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
            kv.set('claim:one', `owner-${i}`, { nx: true }),
        ));
        assert.equal(results.filter((r) => r === 'OK').length, 1);
    });

    it('hset preserves untouched fields and hdel removes only the named ones', async () => {
        const kv = _makeDiskKv(root);
        await kv.hset('h:basic', { keep: 'k', drop: 'd' });
        await kv.hset('h:basic', { added: 'a' });
        await kv.hdel('h:basic', 'drop');
        assert.deepEqual(await kv.hgetall('h:basic'), { keep: 'k', added: 'a' });
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
