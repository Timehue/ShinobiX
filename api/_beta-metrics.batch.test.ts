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
