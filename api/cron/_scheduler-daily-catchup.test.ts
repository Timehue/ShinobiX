process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * A restart across 03:00 UTC used to skip every daily job except the snapshot
 * and the village-war day until the next 03:00. The pass now stamps a dated
 * completion marker, and a boot check runs it when today's is missing.
 */
let kv: typeof import('../_storage.js').kv;
let scheduler: typeof import('./_scheduler.js');
before(async () => {
    ({ kv } = await import('../_storage.js'));
    scheduler = await import('./_scheduler.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.DISABLE_SCHEDULED_JOBS; });

test('the pass is due only after 03:00 UTC on a day with no marker', () => {
    const { dailyPassDue } = scheduler;
    assert.equal(dailyPassDue(Date.UTC(2026, 10, 4, 2, 59), null), false, 'before 03:00 the regular timer will run it');
    assert.equal(dailyPassDue(Date.UTC(2026, 10, 4, 3, 0), null), true);
    assert.equal(dailyPassDue(Date.UTC(2026, 10, 4, 23, 59), null), true, 'a restart late in the day still catches up');
    assert.equal(dailyPassDue(Date.UTC(2026, 10, 4, 9), { completedAt: 1 }), false, 'a completed pass is not repeated');
});

test('the marker is keyed by the UTC date the pass started', () => {
    assert.equal(scheduler.dailyPassMarkerKey(Date.UTC(2026, 10, 4, 3)), 'cron:daily-pass:2026-11-04');
    assert.equal(scheduler.dailyPassMarkerKey(Date.UTC(2026, 10, 4, 23, 59, 59)), 'cron:daily-pass:2026-11-04');
});

test('an interrupted start marker must not suppress catch-up', () => {
    assert.equal(scheduler.dailyPassDue(Date.UTC(2026, 10, 4, 9), { startedAt: 1 }), true);
});

test('a pass whose job leases fail does not publish completion', async (t) => {
    const now = Date.UTC(2026, 10, 4, 9);
    t.mock.timers.enable({ apis: ['Date'], now });
    await kv.del(scheduler.dailyPassMarkerKey(now));
    const set = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: any) => {
        if (key.startsWith('cron:lease:')) throw new Error('injected lease outage');
        return set(key, value, options);
    });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), true);
    assert.equal(await kv.get(scheduler.dailyPassMarkerKey(now)), null);
});

test('the boot check does nothing when today already ran, when the marker cannot be read, or when jobs are off', async (t) => {
    const now = Date.UTC(2026, 10, 4, 9);
    await kv.set(scheduler.dailyPassMarkerKey(now), { startedAt: now - 1000, completedAt: now - 1 });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), false);
    await kv.del(scheduler.dailyPassMarkerKey(now));

    const get = t.mock.method(kv, 'get', async () => { throw new Error('storage down'); });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), false, 'an unreadable marker never starts a pass');
    get.mock.restore();

    process.env.DISABLE_SCHEDULED_JOBS = '1';
    t.mock.method(kv, 'get', async () => { throw new Error('the kill switch must not touch storage'); });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), false);
    delete process.env.DISABLE_SCHEDULED_JOBS;
});

test('the boot timer arms and clears with the scheduler', () => {
    const source = readFileSync('api/cron/_scheduler.ts', 'utf8');
    assert.match(source, /_dailyPassCatchUpBootTimeout = setTimeout\(/);
    assert.match(source, /clearTimeout\(_dailyPassCatchUpBootTimeout\)/);
});

test('held job leases are not mistaken for completed jobs', async (t) => {
    const now = Date.UTC(2026, 10, 4, 9);
    t.mock.timers.enable({ apis: ['Date'], now });
    await kv.del(scheduler.dailyPassMarkerKey(now));
    const set = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: any) => {
        if (key.startsWith('cron:lease:')) return null;
        return set(key, value, options);
    });
    assert.equal(await scheduler.fireDailyPassCatchUp(now), true);
    assert.equal(await kv.get(scheduler.dailyPassMarkerKey(now)), null);
});

test('a successful pass publishes completion for its starting UTC day', async (t) => {
    const now = Date.UTC(2026, 10, 6, 9);
    t.mock.timers.enable({ apis: ['Date'], now });
    process.env.DISABLE_SNAPSHOT_CRON = '1';
    try {
        assert.equal(await scheduler.fireDailyPassCatchUp(now), true);
        assert.equal((await kv.get<{ completedAt: number }>(scheduler.dailyPassMarkerKey(now)))?.completedAt, now);
        assert.equal(await scheduler.fireDailyPassCatchUp(now), false);
    } finally { delete process.env.DISABLE_SNAPSHOT_CRON; }
});
