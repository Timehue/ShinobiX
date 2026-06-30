"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSnapshotCron = startSnapshotCron;
exports.stopSnapshotCron = stopSnapshotCron;
/**
 * In-process daily scheduler for the save-snapshot backup.
 *
 * The nightly backup used to be a Vercel cron (`GET /api/cron/snapshot-saves`
 * at 03:00 UTC, see the now-deleted vercel.json). With Vercel retired, the
 * always-on server runs it itself — no external scheduler, no extra container.
 * The HTTP endpoint stays for manual admin triggers; this just calls the same
 * `runSnapshotSaves()` once a day at 03:00 UTC.
 *
 * Underscore-prefixed so it is NOT treated as a route — it's a server helper,
 * imported directly by server.ts.
 *
 * Single always-on instance assumption (same as the game loop). If a secondary
 * instance (e.g. cPanel) also schedules it, the 20h dedup window inside
 * runSnapshotSaves makes the second run a harmless no-op — set
 * DISABLE_SNAPSHOT_CRON=1 on secondaries to skip the redundant keyspace scan.
 */
const snapshot_saves_js_1 = require("./snapshot-saves.js");
const _ranked_season_js_1 = require("./_ranked-season.js");
const _war_daily_js_1 = require("../_war-daily.js");
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_UTC_HOUR = 3; // 03:00 UTC — matches the retired Vercel schedule "0 3 * * *".
// No serverless timeout here, so give the nightly pass a generous budget to
// snapshot every player in one run rather than leaning on next-day catch-up.
const NIGHTLY_BUDGET_MS = 5 * 60_000;
let _timeout = null;
let _interval = null;
/** ms from `now` until the next TARGET_UTC_HOUR:00:00 UTC. */
function msUntilNextTargetHour(now) {
    const d = new Date(now);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TARGET_UTC_HOUR, 0, 0, 0));
    if (next.getTime() <= now)
        next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now;
}
async function fire() {
    try {
        const r = await (0, snapshot_saves_js_1.runSnapshotSaves)(NIGHTLY_BUDGET_MS);
        if (r.emptyKeyspace) {
            console.error('[cron-scheduler] snapshot run found ZERO saves — check KV_PROXY_URL / KV_PROXY_TOKEN.');
        }
        else {
            console.log(`[cron-scheduler] snapshot run: ${r.snapshotted} saved, ${r.skipped} skipped, ${r.failed.length} failed (${r.processed}/${r.total}, ${r.elapsedMs}ms${r.truncated ? ', TRUNCATED' : ''}).`);
        }
    }
    catch (err) {
        console.error('[cron-scheduler] snapshot run threw:', err.message);
    }
    // Ranked-season rollover on the same daily tick. It self-checks the season
    // clock and no-ops (`pending`) until the ~30-day window expires, so running
    // it nightly just means the rollover fires within 24h of the month ending.
    try {
        const s = await (0, _ranked_season_js_1.runRankedSeasonRollover)();
        if (s.action === 'rolled-over') {
            console.log(`[cron-scheduler] ranked season ${s.seasonId} → ${s.nextSeasonId}: champion=${s.playerChampion ?? '—'} pet=${s.petChampion ?? '—'}, ${s.resetCount} reset, ${s.rewardedCount} rewarded.`);
        }
        else if (s.action === 'initialized') {
            console.log(`[cron-scheduler] ranked season ${s.seasonId} initialised.`);
        }
    }
    catch (err) {
        console.error('[cron-scheduler] ranked-season rollover threw:', err.message);
    }
    // Village War Map daily pass (WR accrual + structure upkeep + merc-lease
    // expiry). No-op unless ENABLE_VILLAGE_WAR=1 — server-gated, default OFF.
    try {
        const w = await (0, _war_daily_js_1.runVillageWarDailyPass)();
        if (w.enabled && w.ran > 0) {
            console.log(`[cron-scheduler] village-war daily pass: ${w.ran}/${w.processed} villages processed.`);
        }
    }
    catch (err) {
        console.error('[cron-scheduler] village-war daily pass threw:', err.message);
    }
}
/**
 * Start the daily 03:00-UTC snapshot. Idempotent. No-op when
 * DISABLE_SNAPSHOT_CRON=1. Timers are unref'd so they never hold the process
 * open on their own.
 */
function startSnapshotCron() {
    if (process.env.DISABLE_SNAPSHOT_CRON === '1') {
        console.log('[cron-scheduler] save-snapshot cron disabled via DISABLE_SNAPSHOT_CRON=1');
        return;
    }
    if (_timeout || _interval)
        return;
    // NOTE: ranked seasons do NOT auto-start — an admin starts them from the
    // Admin Panel (/api/admin/ranked-season). The daily fire() still calls the
    // rollover, which no-ops ('inactive') until a season has been started.
    const delay = msUntilNextTargetHour(Date.now());
    _timeout = setTimeout(() => {
        void fire();
        _interval = setInterval(() => void fire(), DAY_MS);
        _interval.unref?.();
    }, delay);
    _timeout.unref?.();
    console.log(`[cron-scheduler] daily save-snapshot scheduled in ${Math.round(delay / 60000)} min (03:00 UTC).`);
}
/** Stop the scheduler (tests / graceful shutdown). */
function stopSnapshotCron() {
    if (_timeout) {
        clearTimeout(_timeout);
        _timeout = null;
    }
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
}
