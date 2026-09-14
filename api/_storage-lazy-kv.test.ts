/*
 * The KV backend is chosen on FIRST USE, and `kv` must still behave like the
 * plain object 435 modules treat it as.
 *
 * This file is itself the regression case: the flag below is set AFTER a static
 * import that reaches `_storage`. ES imports are hoisted, so under the old
 * eager selection that ordering lost every time — the suite bound itself to the
 * real Supabase client and died with "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * must be set" on any machine without production credentials. If the selection
 * ever goes eager again, the very first assertion here fails.
 *
 * The rest pins what the lazy layer has to preserve, because `kv` is not only
 * called — it is spread, assigned to, deleted from, and probed for an optional
 * member. A hand-written delegate broke all four; these are the traps that must
 * keep working.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { KvLike } from './_storage.js';
// A STATIC value import that reaches _storage transitively — the whole point.
import { versionedPlayerRecord } from './save/_mutate-player-save.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: KvLike;

before(async () => {
    ({ kv } = await import('./_storage.js'));
});

describe('lazy KV backend selection', () => {
    it('honours a flag set after a static import reached _storage', async () => {
        // The static import above is real and load-bearing; keep it referenced so
        // no tidy-up removes the very thing this file exists to prove.
        assert.equal(typeof versionedPlayerRecord, 'function');
        // If the backend had been chosen at import time this would throw about
        // missing Supabase credentials rather than answering from memory.
        await kv.set('lazy-kv:probe', { ok: true });
        assert.deepEqual(await kv.get('lazy-kv:probe'), { ok: true });
        await kv.del('lazy-kv:probe');
        assert.equal(await kv.get('lazy-kv:probe'), null);
    });

    it('exposes stable method identities, so callers may cache them', () => {
        assert.equal(typeof kv.get, 'function');
        assert.equal(kv.get, kv.get, 'a fresh binding per access would break identity comparisons');
    });

    it('can be spread and assigned back, which real tests do', async () => {
        // api/save/_save-attempt-rate-limit.test.ts snapshots with { ...kv } and
        // restores with Object.assign; api/_content-store.test.ts spreads to
        // build a partial override. Both need the backend's real own-keys.
        const snapshot = { ...kv };
        assert.ok(Object.keys(snapshot).length > 0, 'spreading kv produced nothing');
        assert.equal(typeof snapshot.get, 'function');
        assert.equal(typeof snapshot.set, 'function');

        // `get` is generic (`get<T>(key): Promise<T | null>`), so a fixed-shape stub
        // needs the cast to satisfy it — the same one real overriding tests use.
        const stubGet = (async () => ({ overridden: true })) as KvLike['get'];
        const overridden: KvLike = { ...kv, get: stubGet };
        assert.deepEqual(await overridden.get('anything'), { overridden: true });
        // The override must not have leaked into the shared instance.
        assert.equal(await kv.get('lazy-kv:absent'), null);
    });

    it('reports membership through `in`', () => {
        assert.ok('get' in kv);
        assert.ok('hgetall' in kv);
        assert.equal('definitelyNotAKvMethod' in kv, false);
    });

    it('keeps the OPTIONAL mgetProjected assignable, probeable and deletable', async () => {
        // api/_storage-projection.ts branches on `if (store.mgetProjected)`, and
        // only pgKv implements it — so on this backend it must read as absent.
        // api/player/roster.performance.test.ts assigns and deletes it directly.
        const initial = kv.mgetProjected;
        assert.equal(initial, undefined, 'the memory backend has no projected read');

        kv.mgetProjected = async () => [{ stubbed: true }];
        assert.equal(typeof kv.mgetProjected, 'function');
        assert.deepEqual(await kv.mgetProjected!(['k'], {} as never), [{ stubbed: true }]);

        delete kv.mgetProjected;
        assert.equal(kv.mgetProjected, undefined, 'delete must reach the backend, not a shim');
        assert.equal('mgetProjected' in kv, false);
    });

    it('accepts a node:test mock installed via defineProperty', async (t) => {
        // `t.mock.method` installs through Object.defineProperty, NOT assignment.
        // Without a defineProperty trap the spy lands on the proxy target, the
        // real method keeps running, and every "reads in ONE batch" performance
        // test silently sees a call count of 0 — which is exactly how this
        // regressed (api/_era.performance.test.ts and four siblings).
        const spy = t.mock.method(kv, 'mget');
        await kv.mget('lazy-kv:a', 'lazy-kv:b');
        assert.equal(spy.mock.callCount(), 1, 'the mock must intercept the real call');
        t.mock.restoreAll();
        assert.equal(typeof kv.mget, 'function', 'restore must put the backend method back');
        assert.deepEqual(await kv.mget('lazy-kv:absent'), [null]);
    });

    it('resolves the backend once, not per call', async () => {
        // A re-resolving layer would hand back a fresh in-memory store and lose
        // the write between these two lines.
        await kv.set('lazy-kv:sticky', 1);
        assert.equal(await kv.get('lazy-kv:sticky'), 1);
        assert.equal(await kv.get('lazy-kv:sticky'), 1);
        await kv.del('lazy-kv:sticky');
    });

    after(async () => {
        await kv.del('lazy-kv:probe', 'lazy-kv:sticky');
    });
});
