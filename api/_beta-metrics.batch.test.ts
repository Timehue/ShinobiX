import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// Records on the shared store are queued and written in batches, so a reward
// claim no longer waits on (or queues behind) the day's global telemetry lock.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let metrics: typeof import('./_beta-metrics.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    metrics = await import('./_beta-metrics.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

test('recording returns before any database work, and the flush writes it', async () => {
    const key = metrics.betaMetricKey('2026-09-19');
    await kv.del(key);
    await metrics.recordBetaMetric({ event: 'mission.claimed', level: 12, source: 'missions', ts: NOW });
    assert.equal(await kv.get(key), null, 'the caller did not wait for the write');
    await metrics.flushBetaMetrics();
    const snapshot = await metrics.readBetaMetricsSnapshot(1, { now: NOW });
    assert.equal(snapshot.totals.events['mission.claimed'], 1);
});

test('a burst of 50 records takes the day lock once and loses nothing', async (t) => {
    const key = metrics.betaMetricKey('2026-09-19');
    await kv.del(key);
    const set = t.mock.method(kv, 'set');
    await Promise.all(Array.from({ length: 50 }, (_, i) => metrics.recordBetaMetric({
        event: 'pvp.settled', level: 20, source: 'pvp', ts: NOW + i, ryo: 10,
    })));
    await metrics.flushBetaMetrics();
    const lockTakes = set.mock.calls.filter((call) => String(call.arguments[0]).startsWith('lock:')).length;
    const dayWrites = set.mock.calls.filter((call) => call.arguments[0] === key).length;
    assert.equal(lockTakes, 1, 'one lock acquisition for the whole burst');
    assert.equal(dayWrites, 1, 'one day-document write for the whole burst');
    const snapshot = await metrics.readBetaMetricsSnapshot(1, { now: NOW });
    assert.equal(snapshot.totals.events['pvp.settled'], 50);
    assert.equal(snapshot.totals.rewardTotals.ryo, 500);
});

test('a batch that fails before its write is tried once more instead of dropped', async (t) => {
    const key = metrics.betaMetricKey('2026-09-19');
    await kv.del(key);
    const originalGet = kv.get.bind(kv);
    let failures = 0;
    t.mock.method(kv, 'get', async (k: string) => {
        if (k === key && failures === 0) {
            failures += 1;
            throw new Error('connection reset');
        }
        return originalGet(k);
    });
    await Promise.all(Array.from({ length: 5 }, (_, i) => metrics.recordBetaMetric({
        event: 'mission.claimed', level: 12, source: 'missions', ts: NOW + i,
    })));
    await metrics.flushBetaMetrics();
    t.mock.restoreAll();
    const snapshot = await metrics.readBetaMetricsSnapshot(1, { now: NOW });
    assert.equal(failures, 1);
    assert.equal(snapshot.totals.events['mission.claimed'], 5, 'nothing was written, so nothing is lost or doubled');
});

test('a batch whose write fails is dropped, never written twice', async (t) => {
    const key = metrics.betaMetricKey('2026-09-19');
    await kv.del(key);
    const originalSet = kv.set.bind(kv);
    let dayWrites = 0;
    t.mock.method(kv, 'set', async (k: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (k === key) {
            dayWrites += 1;
            // The write may have committed even though it reported failure.
            throw new Error('acknowledgement lost');
        }
        return originalSet(k, value, options);
    });
    t.mock.method(console, 'error', () => undefined);
    await metrics.recordBetaMetric({ event: 'mission.claimed', level: 12, source: 'missions', ts: NOW });
    await metrics.flushBetaMetrics();
    assert.equal(dayWrites, 1, 'a second try could count the same events twice');
});
