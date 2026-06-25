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
