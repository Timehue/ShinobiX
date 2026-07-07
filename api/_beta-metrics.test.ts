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

test('records aggregate beta events, level bands, sources, and reward totals', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await recordBetaMetric({ event: 'account.registered', level: 1, source: 'auth', ts: now }, { kv: store });
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
    assert.equal(snapshot.totals.events['mission.claimed'], 1);
    assert.equal(snapshot.totals.events['bank.interest.claimed'], 1);
    assert.equal(snapshot.totals.levelBands['L1-9'], 1);
    assert.equal(snapshot.totals.levelBands['L10-14'], 1);
    assert.equal(snapshot.totals.levelBands['L20-29'], 1);
    assert.equal(snapshot.totals.sources.field, 1);
    assert.equal(snapshot.totals.rewardTotals.xp, 120);
    assert.equal(snapshot.totals.rewardTotals.ryo, 280);
    assert.equal(snapshot.totals.rewardTotals.territoryScrolls, 3);
    assert.equal(snapshot.totals.rewardTotals.fateShards, 2);
});
