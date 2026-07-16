"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _beta_report_js_1 = require("./_beta-report.js");
const metrics = (events = {}) => ({
    generatedAt: Date.UTC(2026, 6, 14, 12),
    days: 1,
    daily: [],
    totals: { events, levelBands: {}, sources: {}, rewardTotals: { xp: 50, ryo: 25 } },
});
(0, node_test_1.test)('population report is aggregate-only and calculates progression/economy risk signals', () => {
    const population = (0, _beta_report_js_1.buildBetaPopulationSnapshot)([
        { character: { name: 'secret-a', level: 20, rank: 'Genin', village: 'Leaf', ryo: 5, bankRyo: 100, hospitalized: true, academyTrialClaimed: true } },
        { character: { name: 'secret-b', level: 39, rank: 'Chunin', profession: 'healer', village: 'Mist', ryo: 500, bankRyo: 900, academyChecklistClaimed: true, battleTowerBestFloor: 2 } },
        null,
    ]);
    strict_1.default.equal(population.savesScanned, 3);
    strict_1.default.equal(population.malformedSaves, 1);
    strict_1.default.equal(population.examHolds['level-20-genin-exam'], 1);
    strict_1.default.equal(population.examHolds['level-39-chunin-exam'], 1);
    strict_1.default.equal(population.hospitalSoftLockRisk, 1);
    strict_1.default.equal(population.walletRyoPercentiles.p50, 5);
    strict_1.default.equal(population.walletRyoPercentiles.max, 500);
    strict_1.default.equal(population.towerPlayers, 1);
    strict_1.default.equal(JSON.stringify(population).includes('secret-a'), false);
    strict_1.default.equal(JSON.stringify(population).includes('secret-b'), false);
});
(0, node_test_1.test)('daily report highlights duplicates, failures, unresolved sessions, and save risks', () => {
    const population = (0, _beta_report_js_1.buildBetaPopulationSnapshot)([null]);
    const report = (0, _beta_report_js_1.buildDailyBetaReport)(metrics({
        'reward.duplicate_rejected': 2,
        'reward.claim_failed': 1,
        'combat.session_unresolved': 3,
    }), population);
    strict_1.default.equal(report.alerts.length, 4);
    const text = (0, _beta_report_js_1.formatDailyBetaReport)(report);
    strict_1.default.match(text, /duplicate reward attempt/);
    strict_1.default.match(text, /unresolved combat session/);
    strict_1.default.match(text, /Saves scanned: 1 \(1 malformed\)/);
});
