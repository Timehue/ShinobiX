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
 * Every process creates these timers, but each invocation claims a distributed
 * KV lease. That keeps the jobs single-owner if Railway scales past one replica
 * or briefly overlaps old and new processes during a deployment.
 */
import {
    isSnapshotMarkerFresh,
    readSnapshotSuccessMarker,
    runSnapshotSaves,
} from './snapshot-saves.js';
import { runRankedSeasonRollover } from './_ranked-season.js';
import { runClanBossWeekly } from './_clan-boss-weekly.js';
import { runVillageWarDailyPass } from '../_war-daily.js';
import { runMercAutoDeploy } from '../_merc-auto.js';
import { runEraDailyPass } from '../_era.js';
import { scheduledJobsDisabled } from '../_launch-controls.js';
import { runSettlementReconciliation } from './_settlement-reconciliation.js';
import { withScheduledJobLease } from './_job-lease.js';
import { runGuestSweep } from './_guest-sweep.js';
import { sweepClanBossPartyRegistry } from '../clan-boss/_party.js';
import { clanBossWeekId } from '../clan-boss/_storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MERC_TICK_MS = 10 * 60_000; // village-war mercenary auto-snipe cadence
const SETTLEMENT_RECONCILIATION_TICK_MS = 5 * 60_000;
const CLAN_BOSS_PARTY_SWEEP_TICK_MS = 5 * 60_000;
const TARGET_UTC_HOUR = 3; // 03:00 UTC — matches the retired Vercel schedule "0 3 * * *".
// No serverless timeout here, so give the nightly pass a generous budget to
// snapshot every player in one run rather than leaning on next-day catch-up.
const NIGHTLY_BUDGET_MS = 5 * 60_000;
const LEASE_TTL = {
    // These also act as success dedupe windows. They are shorter than each
    // cadence so the next legitimate tick can acquire, but long enough to stop
    // a delayed replica from replaying the same invocation.
    snapshot: 20 * 60 * 60,
    rankedRollover: 20 * 60 * 60,
    clanBoss: 20 * 60 * 60,
    villageWar: 20 * 60 * 60,
    era: 20 * 60 * 60,
    mercAuto: 9 * 60,
    settlementReconciliation: 4 * 60,
    clanBossPartySweep: 4 * 60,
    guestSweep: 20 * 60 * 60,
} as const;

let _timeout: ReturnType<typeof setTimeout> | null = null;
let _interval: ReturnType<typeof setInterval> | null = null;
let _mercInterval: ReturnType<typeof setInterval> | null = null;
let _settlementInterval: ReturnType<typeof setInterval> | null = null;
let _clanBossPartySweepInterval: ReturnType<typeof setInterval> | null = null;
let _settlementScanRunning = false;
let _clanBossPartySweepRunning = false;

async function runLeasedJob<T>(jobName: string, ttlSec: number, fn: () => Promise<T>): Promise<T | null> {
    const leased = await withScheduledJobLease(jobName, fn, { ttlSec, holdUntilExpiryOnSuccess: true });
    return leased.acquired ? leased.value : null;
}

async function fireSettlementReconciliation(includeLegacyScan = false): Promise<void> {
    if (_settlementScanRunning) return;
    _settlementScanRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'settlement-reconciliation',
            () => runSettlementReconciliation({ includeLegacyScan }),
            { ttlSec: LEASE_TTL.settlementReconciliation, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        if (result.markedRequired > 0 || result.alreadyRequired > 0 || result.failures.length > 0) {
            console.warn(`[cron-scheduler] durable settlements: ${result.markedRequired} newly stale, ${result.alreadyRequired} awaiting reconciliation, ${result.failures.length} scan failures.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] durable-settlement reconciliation threw:', (err as Error).message);
    } finally {
        _settlementScanRunning = false;
    }
}

export function clanBossLeaseName(now: number = Date.now()): string {
    return `clan-boss-weekly:${clanBossWeekId(now)}`;
}

async function fireClanBossPartySweep(): Promise<void> {
    if (_clanBossPartySweepRunning) return;
    _clanBossPartySweepRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'clan-boss-party-sweep',
            () => sweepClanBossPartyRegistry(),
            { ttlSec: LEASE_TTL.clanBossPartySweep, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        if (result.repaired > 0 || result.discovered > 0 || result.removed > 0 || result.terminalIndicesCleared > 0) {
            console.log(`[cron-scheduler] clan-boss party registry: scanned ${result.scanned}/${result.total}, repaired ${result.repaired}, discovered ${result.discovered}, removed ${result.removed}, released ${result.terminalIndicesCleared} terminal indices.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] clan-boss party sweep threw:', (err as Error).message);
    } finally {
        _clanBossPartySweepRunning = false;
    }
}

/** ms from `now` until the next TARGET_UTC_HOUR:00:00 UTC. */
function msUntilNextTargetHour(now: number): number {
    const d = new Date(now);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TARGET_UTC_HOUR, 0, 0, 0));
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now;
}

async function runBootSnapshotCatchUp(): Promise<void> {
    try {
        const marker = await readSnapshotSuccessMarker();
        if (isSnapshotMarkerFresh(marker)) {
            console.log(`[cron-scheduler] backup freshness ok; last complete run ${new Date(marker!.completedAt).toISOString()}.`);
            return;
        }
        console.warn('[cron-scheduler] no complete snapshot run in the last 26h; starting boot catch-up.');
    } catch (err) {
        console.error('[cron-scheduler] backup marker read failed; attempting boot catch-up:', (err as Error).message);
    }

    try {
        const leased = await withScheduledJobLease(
            'snapshot',
            () => runSnapshotSaves(NIGHTLY_BUDGET_MS),
            { ttlSec: LEASE_TTL.snapshot, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        console.log(`[cron-scheduler] boot catch-up: ${result.snapshotted} saved, ${result.skipped} skipped, ${result.failed.length} failed; ${result.ok ? 'healthy' : 'UNHEALTHY'}.`);
    } catch (err) {
        console.error('[cron-scheduler] boot catch-up threw:', (err as Error).message);
    }
}

async function fire(): Promise<void> {
    if (process.env.DISABLE_SNAPSHOT_CRON !== '1') {
        try {
            const r = await runLeasedJob('snapshot', LEASE_TTL.snapshot, () => runSnapshotSaves(NIGHTLY_BUDGET_MS));
            if (!r) {
                // Another process owns this invocation.
            } else if (r.emptyKeyspace) {
                console.error('[cron-scheduler] snapshot run found ZERO saves — check KV_PROXY_URL / KV_PROXY_TOKEN.');
            } else {
                console.log(`[cron-scheduler] snapshot run: ${r.snapshotted} saved, ${r.skipped} skipped, ${r.failed.length} failed (${r.processed}/${r.total}, ${r.elapsedMs}ms${r.truncated ? ', TRUNCATED' : ''}).`);
            }
        } catch (err) {
            console.error('[cron-scheduler] snapshot run threw:', (err as Error).message);
        }
    }
    // Ranked-season rollover on the same daily tick. It self-checks the season
    // clock and no-ops (`pending`) until the ~30-day window expires, so running
    // it nightly just means the rollover fires within 24h of the month ending.
    try {
        const s = await runLeasedJob('ranked-rollover', LEASE_TTL.rankedRollover, () => runRankedSeasonRollover());
        if (s?.action === 'rolled-over') {
            console.log(`[cron-scheduler] ranked season ${s.seasonId} → ${s.nextSeasonId}: champion=${s.playerChampion ?? '—'} pet=${s.petChampion ?? '—'}, ${s.resetCount} reset, ${s.rewardedCount} rewarded.`);
        } else if (s?.action === 'initialized') {
            console.log(`[cron-scheduler] ranked season ${s.seasonId} initialised.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] ranked-season rollover threw:', (err as Error).message);
    }
    // Weekly Clan Boss Gauntlet: spawn the week's boss (once) + settle/reward any
    // ended week. Default on; the canonical core kill switch makes it a no-op.
    try {
        const cb = await runLeasedJob(clanBossLeaseName(), LEASE_TTL.clanBoss, () => runClanBossWeekly());
        if (cb && cb.enabled && (cb.spawned || cb.settled.length)) {
            console.log(`[cron-scheduler] clan boss: ${cb.spawned ? `spawned ${cb.spawned}` : 'no spawn'}${cb.settled.length ? `, settled ${cb.settled.join(', ')}` : ''}.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] clan-boss weekly threw:', (err as Error).message);
    }
    // Village War Map daily pass (WR accrual + structure upkeep + merc-lease
    // expiry). Default on; the canonical Sector Map kill switch makes it a no-op.
    try {
        const w = await runLeasedJob('village-war-daily', LEASE_TTL.villageWar, () => runVillageWarDailyPass());
        if (w && w.enabled && w.ran > 0) {
            console.log(`[cron-scheduler] village-war daily pass: ${w.ran}/${w.processed} villages processed.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] village-war daily pass threw:', (err as Error).message);
    }
    // Reclaim abandoned guest accounts. Reports what it would take unless
    // GUEST_SWEEP_ENABLED=1, so the first cycles can be read before anything is
    // deleted. Only accounts still flagged `guest` are ever in scope.
    try {
        const g = await runLeasedJob('guest-sweep', LEASE_TTL.guestSweep, () => runGuestSweep());
        if (g && (g.expired.length > 0 || g.failures.length > 0)) {
            console.log(`[cron-scheduler] guest sweep${g.enabled ? '' : ' (DRY RUN — set GUEST_SWEEP_ENABLED=1 to delete)'}: ${g.expired.length}/${g.guests} guests expired of ${g.scanned} accounts${g.failures.length ? `, ${g.failures.length} failures` : ''}.`);
            if (g.failures.length) console.warn(`[cron-scheduler] guest sweep failures: ${g.failures.slice(0, 5).join('; ')}`);
        }
    } catch (err) {
        console.error('[cron-scheduler] guest sweep threw:', (err as Error).message);
    }
    // Era milestone pass (Legacy system). No-op unless ENABLE_LEGACY=1. Covers
    // the case where the credited trigger fired BEFORE the server-wide
    // milestones finished — the recorded finisher keeps their credit.
    try {
        const e = await runLeasedJob('era-daily', LEASE_TTL.era, () => runEraDailyPass());
        if (e && e.enabled && e.unlocked.length > 0) {
            console.log(`[cron-scheduler] era pass UNLOCKED: ${e.unlocked.join(', ')}`);
        }
    } catch (err) {
        console.error('[cron-scheduler] era pass threw:', (err as Error).message);
    }
}

/**
 * Start the in-process jobs. The settlement scanner is independent of the
 * snapshot-specific kill switch; DISABLE_SCHEDULED_JOBS remains the global
 * stop. Timers are unref'd so they never hold the process open on their own.
 */
export function startSnapshotCron(): void {
    if (scheduledJobsDisabled()) {
        console.log('[cron-scheduler] all scheduled jobs disabled via DISABLE_SCHEDULED_JOBS=1');
        return;
    }
    if (!_settlementInterval) {
        if (process.env.DISABLE_SETTLEMENT_RECONCILIATION !== '1') {
            _settlementInterval = setInterval(() => void fireSettlementReconciliation(), SETTLEMENT_RECONCILIATION_TICK_MS);
            _settlementInterval.unref?.();
            void fireSettlementReconciliation(true);
        } else {
            console.log('[cron-scheduler] durable-settlement reconciliation disabled via DISABLE_SETTLEMENT_RECONCILIATION=1');
        }
    }
    if (!_clanBossPartySweepInterval) {
        _clanBossPartySweepInterval = setInterval(() => void fireClanBossPartySweep(), CLAN_BOSS_PARTY_SWEEP_TICK_MS);
        _clanBossPartySweepInterval.unref?.();
        void fireClanBossPartySweep();
    }
    const snapshotDisabled = process.env.DISABLE_SNAPSHOT_CRON === '1';
    if (snapshotDisabled) {
        console.log('[cron-scheduler] save-snapshot cron disabled via DISABLE_SNAPSHOT_CRON=1');
    }
    if (_timeout || _interval) return;
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
    // If the process was down across 03:00 UTC, do not wait until tomorrow.
    // The durable marker proves freshness and the distributed 20h job lease
    // keeps restarts or a second scheduler from creating duplicate daily copies.
    if (!snapshotDisabled) void runBootSnapshotCatchUp();
    // Village War mercenary auto-snipe — a frequent tick so active merc bands hunt
    // low-HP enemy defenders on their own. The Sector Map kill switch makes it a no-op.
    _mercInterval = setInterval(() => {
        void runLeasedJob('merc-auto', LEASE_TTL.mercAuto, () => runMercAutoDeploy())
            .then((r) => { if (r && r.enabled && r.deployed > 0) console.log(`[cron-scheduler] merc auto-snipe: ${r.deployed} deployed.`); })
            .catch((err) => console.error('[cron-scheduler] merc auto-snipe threw:', (err as Error).message));
    }, MERC_TICK_MS);
    _mercInterval.unref?.();
    // Kick the clan-boss weekly pass once on boot so the current week's boss is live
    // immediately (rather than dark until the next 03:00 tick). The core kill switch
    // makes it a no-op; NX guards ensure it never double-spawns.
    void runLeasedJob(clanBossLeaseName(), LEASE_TTL.clanBoss, () => runClanBossWeekly())
        .catch((err) => console.error('[cron-scheduler] clan-boss boot kick threw:', (err as Error).message));
    console.log(`[cron-scheduler] daily jobs scheduled in ${Math.round(delay / 60000)} min (03:00 UTC).`);
}

/** Stop the scheduler (tests / graceful shutdown). */
export function stopSnapshotCron(): void {
    if (_timeout) { clearTimeout(_timeout); _timeout = null; }
    if (_interval) { clearInterval(_interval); _interval = null; }
    if (_mercInterval) { clearInterval(_mercInterval); _mercInterval = null; }
    if (_settlementInterval) { clearInterval(_settlementInterval); _settlementInterval = null; }
    if (_clanBossPartySweepInterval) { clearInterval(_clanBossPartySweepInterval); _clanBossPartySweepInterval = null; }
    _settlementScanRunning = false;
    _clanBossPartySweepRunning = false;
}
