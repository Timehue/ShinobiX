import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildBetaPopulationSnapshot,
    buildDailyBetaReport,
    formatDailyBetaReport,
} from './_beta-report.js';
import type { BetaMetricsSnapshot } from './_beta-metrics.js';

const metrics = (events: Record<string, number> = {}): BetaMetricsSnapshot => ({
    generatedAt: Date.UTC(2026, 6, 14, 12),
    days: 1,
    daily: [],
    totals: { events, levelBands: {}, sources: {}, rewardTotals: { xp: 50, ryo: 25 } },
});

test('population report is aggregate-only and calculates progression/economy risk signals', () => {
    const population = buildBetaPopulationSnapshot([
        { character: { name: 'secret-a', level: 20, rank: 'Genin', village: 'Leaf', ryo: 5, bankRyo: 100, hospitalized: true, academyTrialClaimed: true } },
        { character: { name: 'secret-b', level: 39, rank: 'Chunin', profession: 'healer', village: 'Mist', ryo: 500, bankRyo: 900, academyChecklistClaimed: true, battleTowerBestFloor: 2 } },
        null,
    ]);

    assert.equal(population.savesScanned, 3);
    assert.equal(population.malformedSaves, 1);
    assert.equal(population.examHolds['level-20-genin-exam'], 1);
    assert.equal(population.examHolds['level-39-chunin-exam'], 1);
    assert.equal(population.hospitalSoftLockRisk, 1);
    assert.equal(population.walletRyoPercentiles.p50, 5);
    assert.equal(population.walletRyoPercentiles.max, 500);
    assert.equal(population.towerPlayers, 1);
    assert.equal(JSON.stringify(population).includes('secret-a'), false);
    assert.equal(JSON.stringify(population).includes('secret-b'), false);
});

test('daily report highlights duplicates, failures, unresolved sessions, and save risks', () => {
    const population = buildBetaPopulationSnapshot([null]);
    const report = buildDailyBetaReport(metrics({
        'reward.duplicate_rejected': 2,
        'reward.claim_failed': 1,
        'combat.session_unresolved': 3,
    }), population);

    assert.equal(report.alerts.length, 4);
    const text = formatDailyBetaReport(report);
    assert.match(text, /duplicate reward attempt/);
    assert.match(text, /unresolved combat session/);
    assert.match(text, /Saves scanned: 1 \(1 malformed\)/);
});
