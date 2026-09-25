import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    betaDateKey,
    betaLevelBand,
    readBetaMetricsSnapshot,
    recordBetaMetric,
} from './_beta-metrics';

class MemoryKv {
    data = new Map<string, unknown>();
    async get<T = unknown>(key: string): Promise<T | null> {
        return (this.data.get(key) as T | undefined) ?? null;
    }
    async set(key: string, value: unknown): Promise<'OK'> {
        this.data.set(key, value);
        return 'OK';
    }
    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        return keys.map((key) => (this.data.get(key) as T[number] | undefined) ?? null);
    }
}

test('betaDateKey uses UTC calendar days', () => {
    assert.equal(betaDateKey(Date.UTC(2026, 6, 7, 23, 59)), '2026-07-07');
});

test('betaLevelBand buckets early beta progression gates', () => {
    assert.equal(betaLevelBand(1), 'L1-9');
    assert.equal(betaLevelBand(13), 'L10-14');
    assert.equal(betaLevelBand(15), 'L15-19');
    assert.equal(betaLevelBand(20), 'L20-29');
    assert.equal(betaLevelBand(39), 'L30-39');
    assert.equal(betaLevelBand(50), 'L50-79');
    assert.equal(betaLevelBand(80), 'L80-100');
    assert.equal(betaLevelBand(undefined), 'unknown');
});

test('records aggregate beta events, canonical Academy steps, level bands, sources, and reward totals', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await recordBetaMetric({ event: 'account.registered', level: 1, source: 'auth', ts: now }, { kv: store });
    await recordBetaMetric({ event: 'academy.step.reached', academyStep: 'training', level: 1, ts: now }, { kv: store });
    await recordBetaMetric({ event: 'academy.step.reached', academyStep: 'free-text-is-rejected', ts: now }, { kv: store });
    await recordBetaMetric({
        event: 'mission.claimed',
        level: 14,
        source: 'field',
        xp: 120,
        ryo: 80,
        stamina: 5,
        territoryScrolls: 3,
        currencies: { fateShards: 2 },
        ts: now,
    }, { kv: store });
    await recordBetaMetric({
        event: 'bank.interest.claimed',
        level: 20,
        source: 'bank',
        ryo: 200,
        ts: now - 24 * 60 * 60 * 1000,
    }, { kv: store });

    const snapshot = await readBetaMetricsSnapshot(2, { kv: store, now });
    assert.equal(snapshot.days, 2);
    assert.equal(snapshot.daily[0].date, '2026-07-07');
    assert.equal(snapshot.daily[1].date, '2026-07-06');
    assert.equal(snapshot.totals.events['account.registered'], 1);
    assert.equal(snapshot.totals.events['academy.step.reached'], 2);
    assert.deepEqual(snapshot.totals.academySteps, { training: 1 }, 'unknown step keys are not stored');
    assert.deepEqual(snapshot.daily[0].academySteps, { training: 1 });
    assert.equal('academyCohorts' in snapshot.daily[0], false, 'daily output must not repeat the cohort breakdown');
    assert.equal(snapshot.totals.events['mission.claimed'], 1);
    assert.equal(snapshot.totals.events['bank.interest.claimed'], 1);
    assert.equal(snapshot.totals.levelBands['L1-9'], 2);
    assert.equal(snapshot.totals.levelBands['L10-14'], 1);
    assert.equal(snapshot.totals.levelBands['L20-29'], 1);
    assert.equal(snapshot.totals.sources.field, 1);
    assert.equal(snapshot.totals.rewardTotals.xp, 120);
    assert.equal(snapshot.totals.rewardTotals.ryo, 280);
    assert.equal(snapshot.totals.rewardTotals.territoryScrolls, 3);
    assert.equal(snapshot.totals.rewardTotals.fateShards, 2);
});

test('concurrent beta metric records are serialized without lost updates', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await Promise.all(Array.from({ length: 40 }, () => recordBetaMetric({
        event: 'mission.claimed',
        level: 20,
        xp: 5,
        ts: now,
    }, { kv: store })));

    const snapshot = await readBetaMetricsSnapshot(1, { kv: store, now });
    assert.equal(snapshot.totals.events['mission.claimed'], 40);
    assert.equal(snapshot.totals.rewardTotals.xp, 200);
});

test('Academy cohort reach includes later activity days only for starts in the requested window', async () => {
    const store = new MemoryKv();
    const startDay = Date.UTC(2026, 6, 7, 12);
    const nextDay = startDay + 24 * 60 * 60 * 1000;
    await recordBetaMetric({ event: 'academy.started', academyCohortDate: '2026-07-07', ts: startDay }, { kv: store });
    await recordBetaMetric({
        event: 'academy.step.reached',
        academyStep: 'academyIntro',
        academyCohortDate: '2026-07-07',
        ts: startDay,
    }, { kv: store });
    await recordBetaMetric({
        event: 'academy.step.reached',
        academyStep: 'training',
        academyCohortDate: '2026-07-07',
        ts: nextDay,
    }, { kv: store });
    await recordBetaMetric({
        event: 'academy.step.reached',
        academyStep: 'jutsu',
        academyCohortDate: '2026-07-06',
        ts: nextDay,
    }, { kv: store });
    await recordBetaMetric({
        event: 'academy.step.reached',
        academyStep: 'inventory',
        academyCohortDate: '2026-07-06',
        ts: nextDay,
    }, { kv: store });

    const snapshot = await readBetaMetricsSnapshot(2, { kv: store, now: nextDay });
    assert.deepEqual(snapshot.academyCohorts, {
        '2026-07-07': { started: 1, academyIntro: 1, training: 1 },
    });
    assert.deepEqual(snapshot.totals.academySteps, { academyIntro: 1, training: 1, jutsu: 1, inventory: 1 });
});

test('invalid, noncanonical, and future Academy cohort dimensions are discarded', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    for (const [academyStep, academyCohortDate] of [
        ['free-text', '2026-07-07'],
        ['training', '2026-02-30'],
        ['training', '2026-07-08'],
    ]) {
        await recordBetaMetric({ event: 'academy.step.reached', academyStep, academyCohortDate, ts: now }, { kv: store });
    }
    const snapshot = await readBetaMetricsSnapshot(1, { kv: store, now });
    assert.deepEqual(snapshot.academyCohorts, {});
    assert.deepEqual(snapshot.totals.academySteps, { training: 2 }, 'the all-time-window step tally is independent of cohort dimensions');
});

test('cohort aggregation keeps the legacy no-mget store fallback working', async () => {
    const backing = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await recordBetaMetric({ event: 'academy.started', academyCohortDate: '2026-07-07', ts: now }, { kv: backing });
    const storeWithoutMget = {
        get: backing.get.bind(backing),
        set: backing.set.bind(backing),
    };
    const snapshot = await readBetaMetricsSnapshot(1, { kv: storeWithoutMget, now });
    assert.deepEqual(snapshot.academyCohorts, { '2026-07-07': { started: 1 } });
});
