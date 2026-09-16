import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedFor, invalidateProcCache, __clearProcCache } from './_proc-cache.js';

test('serves the cached value within the TTL (one build)', async () => {
    __clearProcCache();
    let t = 1000;
    const now = () => t;
    let builds = 0;
    const build = async () => { builds++; return builds; };

    const a = await cachedFor('k1', 100, build, now);
    t = 1050; // still inside the 100ms window
    const b = await cachedFor('k1', 100, build, now);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(builds, 1);
});

test('rebuilds after the TTL elapses', async () => {
    __clearProcCache();
    let t = 1000;
    const now = () => t;
    let builds = 0;
    const build = async () => { builds++; return builds; };

    await cachedFor('k2', 100, build, now);
    t = 1100; // exactly at the boundary → stale
    const b = await cachedFor('k2', 100, build, now);
    assert.equal(b, 2);
    assert.equal(builds, 2);
});

test('single-flights concurrent builds (one underlying read)', async () => {
    __clearProcCache();
    const now = () => 1000;
    let builds = 0;
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => { release = r; });
    const build = () => { builds++; return gate; };

    const p1 = cachedFor('k3', 100, build, now);
    const p2 = cachedFor('k3', 100, build, now);
    release(7);
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a, 7);
    assert.equal(b, 7);
    assert.equal(builds, 1);
});

test('does not cache a rejected build', async () => {
    __clearProcCache();
    const now = () => 1000;
    let calls = 0;
    const build = async () => { calls++; if (calls === 1) throw new Error('boom'); return calls; };

    await assert.rejects(cachedFor('k4', 1000, build, now));
    const v = await cachedFor('k4', 1000, build, now); // retries with a live read
    assert.equal(v, 2);
    assert.equal(calls, 2);
});

test('invalidateProcCache forces the next read to rebuild', async () => {
    __clearProcCache();
    const now = () => 1000;
    let builds = 0;
    const build = async () => { builds++; return builds; };

    await cachedFor('k5', 100000, build, now);
    invalidateProcCache('k5');
    const v = await cachedFor('k5', 100000, build, now);
    assert.equal(v, 2);
    assert.equal(builds, 2);
});

test('an invalidated build cannot overwrite the newer completed frame', async () => {
    __clearProcCache();
    let releaseOld!: (value: string) => void;
    const old = cachedFor('race-completed', 10000, () => new Promise(resolve => { releaseOld = resolve; }));
    await Promise.resolve();
    invalidateProcCache('race-completed');
    assert.equal(await cachedFor('race-completed', 10000, async () => 'new'), 'new');
    releaseOld('old');
    assert.equal(await old, 'old', 'existing readers retain their own snapshot');
    assert.equal(await cachedFor('race-completed', 10000, async () => 'unexpected rebuild'), 'new');
});

test('finishing an invalidated build does not delete a newer in-flight build or trigger duplicate work', async () => {
    __clearProcCache();
    let releaseOld!: (value: string) => void;
    let releaseNew!: (value: string) => void;
    let builds = 0;
    const old = cachedFor('race-pending', 10000, () => {
        builds++;
        return new Promise(resolve => { releaseOld = resolve; });
    });
    await Promise.resolve();
    invalidateProcCache('race-pending');
    const fresh = cachedFor('race-pending', 10000, () => {
        builds++;
        return new Promise(resolve => { releaseNew = resolve; });
    });
    await Promise.resolve();
    releaseOld('old');
    await old;
    const joined = cachedFor('race-pending', 10000, async () => { builds++; return 'duplicate'; });
    releaseNew('new');
    assert.deepEqual(await Promise.all([fresh, joined]), ['new', 'new']);
    assert.equal(builds, 2);
});

test('a rejected invalidated build does not erase the replacement single-flight slot', async () => {
    __clearProcCache();
    let rejectOld!: (error: Error) => void;
    let releaseNew!: (value: number) => void;
    const old = cachedFor('race-rejected', 10000, () => new Promise((_, reject) => { rejectOld = reject; }));
    const rejected = assert.rejects(old, /obsolete failure/);
    await Promise.resolve();
    invalidateProcCache('race-rejected');
    const fresh = cachedFor('race-rejected', 10000, () => new Promise(resolve => { releaseNew = resolve; }));
    await Promise.resolve();
    rejectOld(new Error('obsolete failure'));
    await rejected;
    const joined = cachedFor('race-rejected', 10000, async () => -1);
    releaseNew(2);
    assert.deepEqual(await Promise.all([fresh, joined]), [2, 2]);
});

test('invalidation from the builder itself prevents publishing that frame', async () => {
    __clearProcCache();
    assert.equal(await cachedFor('race-self', 10000, async () => {
        invalidateProcCache('race-self');
        return 'invalidated';
    }), 'invalidated');
    assert.equal(await cachedFor('race-self', 10000, async () => 'fresh'), 'fresh');
});
