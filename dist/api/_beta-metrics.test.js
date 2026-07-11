"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _beta_metrics_1 = require("./_beta-metrics");
class MemoryKv {
    data = new Map();
    async get(key) {
        return this.data.get(key) ?? null;
    }
    async set(key, value) {
        this.data.set(key, value);
        return 'OK';
    }
}
(0, node_test_1.test)('betaDateKey uses UTC calendar days', () => {
    strict_1.default.equal((0, _beta_metrics_1.betaDateKey)(Date.UTC(2026, 6, 7, 23, 59)), '2026-07-07');
});
(0, node_test_1.test)('betaLevelBand buckets early beta progression gates', () => {
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(1), 'L1-9');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(13), 'L10-14');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(15), 'L15-19');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(20), 'L20-29');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(39), 'L30-39');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(50), 'L50-79');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(80), 'L80-100');
    strict_1.default.equal((0, _beta_metrics_1.betaLevelBand)(undefined), 'unknown');
});
(0, node_test_1.test)('records aggregate beta events, level bands, sources, and reward totals', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await (0, _beta_metrics_1.recordBetaMetric)({ event: 'account.registered', level: 1, source: 'auth', ts: now }, { kv: store });
    await (0, _beta_metrics_1.recordBetaMetric)({
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
    await (0, _beta_metrics_1.recordBetaMetric)({
        event: 'bank.interest.claimed',
        level: 20,
        source: 'bank',
        ryo: 200,
        ts: now - 24 * 60 * 60 * 1000,
    }, { kv: store });
    const snapshot = await (0, _beta_metrics_1.readBetaMetricsSnapshot)(2, { kv: store, now });
    strict_1.default.equal(snapshot.days, 2);
    strict_1.default.equal(snapshot.daily[0].date, '2026-07-07');
    strict_1.default.equal(snapshot.daily[1].date, '2026-07-06');
    strict_1.default.equal(snapshot.totals.events['account.registered'], 1);
    strict_1.default.equal(snapshot.totals.events['mission.claimed'], 1);
    strict_1.default.equal(snapshot.totals.events['bank.interest.claimed'], 1);
    strict_1.default.equal(snapshot.totals.levelBands['L1-9'], 1);
    strict_1.default.equal(snapshot.totals.levelBands['L10-14'], 1);
    strict_1.default.equal(snapshot.totals.levelBands['L20-29'], 1);
    strict_1.default.equal(snapshot.totals.sources.field, 1);
    strict_1.default.equal(snapshot.totals.rewardTotals.xp, 120);
    strict_1.default.equal(snapshot.totals.rewardTotals.ryo, 280);
    strict_1.default.equal(snapshot.totals.rewardTotals.territoryScrolls, 3);
    strict_1.default.equal(snapshot.totals.rewardTotals.fateShards, 2);
});
(0, node_test_1.test)('concurrent beta metric records are serialized without lost updates', async () => {
    const store = new MemoryKv();
    const now = Date.UTC(2026, 6, 7, 12);
    await Promise.all(Array.from({ length: 40 }, () => (0, _beta_metrics_1.recordBetaMetric)({
        event: 'mission.claimed',
        level: 20,
        xp: 5,
        ts: now,
    }, { kv: store })));
    const snapshot = await (0, _beta_metrics_1.readBetaMetricsSnapshot)(1, { kv: store, now });
    strict_1.default.equal(snapshot.totals.events['mission.claimed'], 40);
    strict_1.default.equal(snapshot.totals.rewardTotals.xp, 200);
});
