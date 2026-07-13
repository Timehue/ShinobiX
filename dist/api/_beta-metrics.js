"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.betaDateKey = betaDateKey;
exports.betaMetricKey = betaMetricKey;
exports.betaLevelBand = betaLevelBand;
exports.applyBetaMetric = applyBetaMetric;
exports.recentBetaDates = recentBetaDates;
exports.recordBetaMetric = recordBetaMetric;
exports.readBetaMetricsSnapshot = readBetaMetricsSnapshot;
const _storage_js_1 = require("./_storage.js");
const _telemetry_lock_js_1 = require("./_telemetry-lock.js");
const BETA_METRICS_RETENTION_SECONDS = 120 * 24 * 60 * 60;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
function betaDateKey(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10);
}
function betaMetricKey(date) {
    return `beta:metrics:${date}`;
}
function betaLevelBand(level) {
    const lv = Math.floor(Number(level));
    if (!Number.isFinite(lv) || lv <= 0)
        return 'unknown';
    if (lv < 10)
        return 'L1-9';
    if (lv < 15)
        return 'L10-14';
    if (lv < 20)
        return 'L15-19';
    if (lv < 30)
        return 'L20-29';
    if (lv < 40)
        return 'L30-39';
    if (lv < 50)
        return 'L40-49';
    if (lv < 80)
        return 'L50-79';
    return 'L80-100';
}
function emptyDay(date, updatedAt = 0) {
    return {
        date,
        updatedAt,
        events: {},
        levelBands: {},
        sources: {},
        rewardTotals: {},
    };
}
function inc(map, key, amount) {
    if (amount === undefined || amount === null)
        return;
    const n = Number(amount);
    if (!key || !Number.isFinite(n) || n === 0)
        return;
    map[key] = Math.round((map[key] ?? 0) + n);
}
function safeSource(source) {
    const clean = String(source ?? '').trim().slice(0, 64);
    return clean || null;
}
function applyBetaMetric(day, input) {
    const ts = input.ts ?? Date.now();
    const date = betaDateKey(ts);
    const next = {
        ...emptyDay(date, ts),
        ...(day ?? {}),
        date,
        updatedAt: ts,
        events: { ...(day?.events ?? {}) },
        levelBands: { ...(day?.levelBands ?? {}) },
        sources: { ...(day?.sources ?? {}) },
        rewardTotals: { ...(day?.rewardTotals ?? {}) },
    };
    inc(next.events, input.event, 1);
    inc(next.levelBands, betaLevelBand(input.level), 1);
    const source = safeSource(input.source);
    if (source)
        inc(next.sources, source, 1);
    inc(next.rewardTotals, 'xp', input.xp);
    inc(next.rewardTotals, 'ryo', input.ryo);
    inc(next.rewardTotals, 'stamina', input.stamina);
    inc(next.rewardTotals, 'territoryScrolls', input.territoryScrolls);
    inc(next.rewardTotals, 'items', input.itemCount);
    for (const [currency, amount] of Object.entries(input.currencies ?? {})) {
        inc(next.rewardTotals, currency, Number(amount));
    }
    return next;
}
function recentBetaDates(days, now = Date.now()) {
    const count = Math.max(1, Math.min(Math.floor(Number(days) || DEFAULT_DAYS), MAX_DAYS));
    const dates = [];
    for (let i = 0; i < count; i++) {
        dates.push(betaDateKey(now - i * 24 * 60 * 60 * 1000));
    }
    return dates;
}
async function recordBetaMetric(input, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    try {
        const ts = input.ts ?? Date.now();
        const key = betaMetricKey(betaDateKey(ts));
        await (0, _telemetry_lock_js_1.withTelemetryLock)(key, store, async () => {
            const current = await store.get(key);
            const next = applyBetaMetric(current, { ...input, ts });
            await store.set(key, next, { ex: BETA_METRICS_RETENTION_SECONDS });
        });
    }
    catch (e) {
        console.error('[beta-metrics] record failed:', e);
    }
}
function mergeCounts(into, from) {
    for (const [key, value] of Object.entries(from))
        inc(into, key, value);
}
async function readBetaMetricsSnapshot(days = DEFAULT_DAYS, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    const now = opts.now ?? Date.now();
    const dates = recentBetaDates(days, now);
    const daily = [];
    for (const date of dates) {
        const stored = await store.get(betaMetricKey(date)).catch(() => null);
        daily.push(stored ? { ...emptyDay(date), ...stored, date } : emptyDay(date));
    }
    const totals = {
        events: {},
        levelBands: {},
        sources: {},
        rewardTotals: {},
    };
    for (const day of daily) {
        mergeCounts(totals.events, day.events);
        mergeCounts(totals.levelBands, day.levelBands);
        mergeCounts(totals.sources, day.sources);
        mergeCounts(totals.rewardTotals, day.rewardTotals);
    }
    return { generatedAt: now, days: dates.length, daily, totals };
}
