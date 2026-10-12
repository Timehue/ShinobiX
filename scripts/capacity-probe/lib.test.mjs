import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    EdgeCache,
    StatsBook,
    assertTargetAllowed,
    isErrorStatus,
    isProbeAccountName,
    parseStepPlan,
    probeAccountName,
    sMaxAgeMs,
    syntheticIp,
} from './lib.mjs';

test('StatsBook percentiles, error classification and merge', () => {
    const a = new StatsBook(() => 0.5);
    for (let i = 1; i <= 100; i += 1) a.record('heartbeat', i, 200);
    a.record('heartbeat', 500, 503);
    a.record('save', 10, 409);
    const b = new StatsBook(() => 0.5);
    b.record('save', 30, 200);
    b.record('save', 40, 0);
    a.merge(JSON.parse(JSON.stringify(b.toJSON())));
    const rows = Object.fromEntries(a.summary().map((r) => [r.label, r]));
    assert.equal(rows.heartbeat.n, 101);
    assert.equal(rows.heartbeat.errors, 1);
    assert.equal(rows.heartbeat.p50, 51);
    assert.equal(rows.heartbeat.max, 500);
    assert.equal(rows.save.n, 3);
    assert.equal(rows.save.errors, 1, '409 is a designed answer; a transport failure is an error');
    assert.deepEqual(rows.save.statuses, { 409: 1, 200: 1, 0: 1 });
});

test('isErrorStatus treats 409/429 as designed answers', () => {
    assert.equal(isErrorStatus(200), false);
    assert.equal(isErrorStatus(409), false);
    assert.equal(isErrorStatus(429), false);
    assert.equal(isErrorStatus(401), true);
    assert.equal(isErrorStatus(500), true);
    assert.equal(isErrorStatus(0), true);
});

test('EdgeCache serves hits per POP inside s-maxage and collapses concurrent misses', async () => {
    let now = 0;
    const cache = new EdgeCache({ pops: 2, now: () => now });
    let originCalls = 0;
    const origin = async () => { originCalls += 1; await new Promise((r) => setTimeout(r, 5)); return { value: originCalls, ttlMs: 5_000 }; };

    const [x, y] = await Promise.all([cache.get(0, '/a', origin), cache.get(0, '/a', origin)]);
    assert.equal(originCalls, 1, 'two players at one POP share one origin fetch');
    assert.equal(x.hit, false);
    assert.equal(y.hit, true);
    assert.equal((await cache.get(0, '/a', origin)).hit, true);
    assert.equal((await cache.get(1, '/a', origin)).hit, false, 'another POP has its own copy');
    assert.equal(originCalls, 2);
    now = 5_001;
    assert.equal((await cache.get(0, '/a', origin)).hit, false, 'expired copy refetches');
    assert.equal(originCalls, 3);
});

test('EdgeCache never stores an uncacheable response', async () => {
    const cache = new EdgeCache({ pops: 1, now: () => 0 });
    let calls = 0;
    const origin = async () => { calls += 1; return { value: calls, ttlMs: null }; };
    await cache.get(0, '/x', origin);
    await cache.get(0, '/x', origin);
    assert.equal(calls, 2);
});

test('sMaxAgeMs reads s-maxage, falls back to max-age, and refuses private/no-store', () => {
    assert.equal(sMaxAgeMs('s-maxage=5, stale-while-revalidate=5'), 5_000);
    assert.equal(sMaxAgeMs('s-maxage=30, stale-while-revalidate=30'), 30_000);
    assert.equal(sMaxAgeMs('public, max-age=60, stale-while-revalidate=120'), 60_000);
    assert.equal(sMaxAgeMs('max-age=600, s-maxage=10'), 10_000, 's-maxage wins');
    assert.equal(sMaxAgeMs('public, max-age=0'), null);
    assert.equal(sMaxAgeMs('no-cache'), null);
    assert.equal(sMaxAgeMs('private, no-store'), null);
    assert.equal(sMaxAgeMs('no-store'), null);
    assert.equal(sMaxAgeMs(''), null);
    assert.equal(sMaxAgeMs(undefined), null);
});

test('syntheticIp stays inside the RFC 2544 benchmark range and is unique', () => {
    const seen = new Set();
    for (let i = 0; i < 20_000; i += 1) {
        const ip = syntheticIp(i);
        const [a, b] = ip.split('.').map(Number);
        assert.equal(a, 198);
        assert.ok(b === 18 || b === 19, ip);
        seen.add(ip);
    }
    assert.equal(seen.size, 20_000);
});

test('probe account names are fixed-width and only match their own run', () => {
    assert.equal(probeAccountName('a1', 7), 'lta100007');
    assert.equal(isProbeAccountName('lta100007', 'a1'), true);
    assert.equal(isProbeAccountName('lta200007', 'a1'), false);
    assert.equal(isProbeAccountName('rill', 'a1'), false);
    assert.equal(isProbeAccountName('lta1000071', 'a1'), false);
});

test('assertTargetAllowed demands the exact host, and production needs its own opt-in', () => {
    assert.equal(assertTargetAllowed({ targetUrl: 'http://127.0.0.1:4000' }).loopback, true);
    assert.throws(() => assertTargetAllowed({ targetUrl: 'http://shinobix.railway.internal:8080' }), /CAPACITY_CONFIRM_HOST/);
    assert.throws(() => assertTargetAllowed({ targetUrl: 'http://a.example', confirmHost: 'b.example' }), /CAPACITY_CONFIRM_HOST/);
    const prod = ['shinobix.railway.internal'];
    assert.throws(
        () => assertTargetAllowed({ targetUrl: 'http://shinobix.railway.internal:8080', confirmHost: 'shinobix.railway.internal', productionHosts: prod }),
        /CAPACITY_ALLOW_PRODUCTION/,
    );
    const ok = assertTargetAllowed({ targetUrl: 'http://shinobix.railway.internal:8080', confirmHost: 'shinobix.railway.internal', productionHosts: prod, allowProduction: true });
    assert.equal(ok.production, true);
    assert.throws(() => assertTargetAllowed({ targetUrl: 'ftp://x' }), /http/);
});

test('parseStepPlan accepts explicit steps and ramps', () => {
    assert.deepEqual(parseStepPlan('50:300, 100:120'), [{ players: 50, seconds: 300 }, { players: 100, seconds: 120 }]);
    assert.deepEqual(parseStepPlan('100-300/100@60'), [
        { players: 100, seconds: 60 }, { players: 200, seconds: 60 }, { players: 300, seconds: 60 },
    ]);
    assert.throws(() => parseStepPlan('nope'), /Bad step/);
});
