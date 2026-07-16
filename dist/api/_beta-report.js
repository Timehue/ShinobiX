"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBetaPopulationSnapshot = buildBetaPopulationSnapshot;
exports.buildDailyBetaReport = buildDailyBetaReport;
exports.formatDailyBetaReport = formatDailyBetaReport;
const _beta_metrics_js_1 = require("./_beta-metrics.js");
function inc(map, rawKey) {
    const key = String(rawKey ?? '').trim().slice(0, 64) || 'unknown';
    map[key] = (map[key] ?? 0) + 1;
}
function finiteNonNegative(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function percentile(sorted, fraction) {
    if (!sorted.length)
        return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return Math.round(sorted[index] ?? 0);
}
function percentiles(values) {
    const sorted = values.map(finiteNonNegative).sort((a, b) => a - b);
    return {
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.9),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: Math.round(sorted.at(-1) ?? 0),
    };
}
function buildBetaPopulationSnapshot(records) {
    const levelBands = {};
    const ranks = {};
    const professions = {};
    const villages = {};
    const examHolds = {};
    const wallets = [];
    const banks = [];
    let malformedSaves = 0;
    let hospitalizedPlayers = 0;
    let hospitalSoftLockRisk = 0;
    let academyTrialClaims = 0;
    let academyChecklistClaims = 0;
    let towerPlayers = 0;
    for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            malformedSaves += 1;
            continue;
        }
        const char = record.character;
        if (!char || typeof char !== 'object' || Array.isArray(char)) {
            malformedSaves += 1;
            continue;
        }
        const player = char;
        const level = Math.max(1, Math.floor(finiteNonNegative(player.level) || 1));
        const wallet = finiteNonNegative(player.ryo);
        const bank = finiteNonNegative(player.bankRyo ?? player.bankedRyo);
        inc(levelBands, (0, _beta_metrics_js_1.betaLevelBand)(level));
        inc(ranks, player.rank ?? player.rankTitle);
        inc(professions, player.profession || 'unselected');
        inc(villages, player.village);
        wallets.push(wallet);
        banks.push(bank);
        if (level === 20)
            inc(examHolds, 'level-20-genin-exam');
        if (level === 39)
            inc(examHolds, 'level-39-chunin-exam');
        if (player.hospitalized === true) {
            hospitalizedPlayers += 1;
            if (wallet < 10)
                hospitalSoftLockRisk += 1;
        }
        if (player.academyTrialClaimed === true)
            academyTrialClaims += 1;
        if (player.academyChecklistClaimed === true)
            academyChecklistClaims += 1;
        if (finiteNonNegative(player.battleTowerBestFloor) > 0)
            towerPlayers += 1;
    }
    return {
        savesScanned: records.length,
        malformedSaves,
        levelBands,
        ranks,
        professions,
        villages,
        examHolds,
        walletRyoPercentiles: percentiles(wallets),
        bankRyoPercentiles: percentiles(banks),
        hospitalizedPlayers,
        hospitalSoftLockRisk,
        academyTrialClaims,
        academyChecklistClaims,
        towerPlayers,
    };
}
function buildDailyBetaReport(metrics, population) {
    const alerts = [];
    const events = metrics.totals.events;
    const duplicateAttempts = Number(events['reward.duplicate_rejected'] ?? 0);
    const failedClaims = Number(events['reward.claim_failed'] ?? 0);
    const unresolvedSessions = Number(events['combat.session_unresolved'] ?? 0);
    if (duplicateAttempts > 0)
        alerts.push(`${duplicateAttempts} duplicate reward attempt(s) rejected.`);
    if (failedClaims > 0)
        alerts.push(`${failedClaims} reward claim failure(s) recorded.`);
    if (unresolvedSessions > 0)
        alerts.push(`${unresolvedSessions} unresolved combat session(s) recorded.`);
    if (population?.malformedSaves)
        alerts.push(`${population.malformedSaves} malformed save record(s) require inspection.`);
    if (population?.hospitalSoftLockRisk)
        alerts.push(`${population.hospitalSoftLockRisk} hospitalized player(s) have under 10 wallet ryo.`);
    return {
        schemaVersion: 'shinobix.beta-daily-report.v1',
        generatedAt: metrics.generatedAt,
        metrics,
        ...(population ? { population } : {}),
        alerts,
    };
}
function mapLine(label, value) {
    const entries = Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return `${label}: ${entries.length ? entries.map(([key, count]) => `${key}=${count}`).join(', ') : 'none'}`;
}
function formatDailyBetaReport(report) {
    const events = report.metrics.totals.events;
    const rewards = report.metrics.totals.rewardTotals;
    const population = report.population;
    return [
        `ShinobiX beta report — ${new Date(report.generatedAt).toISOString()}`,
        `Window: ${report.metrics.days} day(s)`,
        mapLine('Events', events),
        mapLine('Reward totals', rewards),
        mapLine('Event level bands', report.metrics.totals.levelBands),
        ...(population ? [
            `Saves scanned: ${population.savesScanned} (${population.malformedSaves} malformed)`,
            mapLine('Population level bands', population.levelBands),
            mapLine('Ranks', population.ranks),
            mapLine('Professions', population.professions),
            mapLine('Exam holds', population.examHolds),
            mapLine('Wallet ryo percentiles', population.walletRyoPercentiles),
            mapLine('Bank ryo percentiles', population.bankRyoPercentiles),
            `Academy: trial=${population.academyTrialClaims}, checklist=${population.academyChecklistClaims}`,
            `Hospital: hospitalized=${population.hospitalizedPlayers}, soft-lock-risk=${population.hospitalSoftLockRisk}`,
            `Tower participants: ${population.towerPlayers}`,
        ] : []),
        `Alerts: ${report.alerts.length ? report.alerts.join(' ') : 'none'}`,
    ].join('\n');
}
