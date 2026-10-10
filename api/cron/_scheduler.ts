import { runKageChallengeClocks } from '../village/_kage-clock.js';
import { backgroundWorkStopped, runBackgroundWork } from '../_background-work.js';
import { runElderElections } from '../village/_elder-council.js';
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
import { startClanBossInitialization } from '../_startup-initialization.js';
import { runVillageWarDailyCatchUp, runVillageWarDailyPass, type VillageWarDailyResult } from '../_war-daily.js';
import { runMercAutoDeploy } from '../_merc-auto.js';
import { runEraDailyPass } from '../_era.js';
import { scheduledJobsDisabled } from '../_launch-controls.js';
import { runSettlementReconciliation } from './_settlement-reconciliation.js';
import { recoverExpiredExchangeAuctions, recoverPendingExchangeListings } from '../festival/_exchange.js';
import { recoverPendingMentorSettlements } from '../clan/_mentor-settlement.js';
import { recoverPendingPlayerTrades } from '../player/_trade-settlement.js';
import { withScheduledJobLease } from './_job-lease.js';
import { runGuestSweep } from './_guest-sweep.js';
import { runKageInactivityPass } from '../village/_kage-inactivity.js';
import { sweepClanBossPartyRegistry } from '../clan-boss/_party.js';
import { clanBossWeekId } from '../clan-boss/_storage.js';
import { runTerritoryLifecycleSweep } from '../_territory-lifecycle-store.js';
import { runBattleLapseSweep } from './_battle-lapse-sweep.js';
import { runPlayerRankedSettlementSweep } from './_player-ranked-settlement-sweep.js';
import { settleDueSectorWars } from '../_sector-war-settle.js';
import { villageWarMapEnabled } from '../_release-flags.js';

const KAGE_CLOCK_TICK_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MERC_TICK_MS = 10 * 60_000; // village-war mercenary auto-snipe cadence
const SETTLEMENT_RECONCILIATION_TICK_MS = 5 * 60_000;
const CLAN_BOSS_PARTY_SWEEP_TICK_MS = 5 * 60_000;
const TERRITORY_LIFECYCLE_TICK_MS = 5 * 60_000;
// 72h sector wars end at whatever hour they were declared. Settling only in the
// 03:00 daily pass left a finished war unflipped for up to a day.
const SECTOR_WAR_SETTLE_TICK_MS = 5 * 60_000;
const BATTLE_LAPSE_TICK_MS = 10 * 60_000; // F08 backstop: fights nobody came back to
// Player-ranked sagas nobody came back to finish (restart mid-saga, lost gate admission).
const RANKED_SETTLEMENT_TICK_MS = 5 * 60_000;
const RANKED_SETTLEMENT_BOOT_DELAY_MS = 60_000;
// The village-war daily pass's catch-up/retry tick (api/_war-daily.ts
// runVillageWarDailyCatchUp). One marker read when the day is done; a re-run of
// the pass, which only finishes what is missing, when it is not.
const VILLAGE_WAR_CATCHUP_TICK_MS = 10 * 60_000;
const VILLAGE_WAR_CATCHUP_BOOT_DELAY_MS = 60_000;
const SNAPSHOT_RECOVERY_TICK_MS = 60 * 60_000;
const SNAPSHOT_RECOVERY_RETRY_MS = 5 * 60_000;
// The snapshot pass has a five-minute budget. Keep crash ownership only a little
// longer; an interrupted deploy must not suppress recovery for nearly an hour.
const SNAPSHOT_RECOVERY_LEASE_SEC = 7 * 60;
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
    // NOT a day-long dedupe window. The village-war day is deduped by the
    // pass's own per-village stamps and its durable done-marker, so this lease
    // only bounds crash recovery: a pass that died mid-run is retried by the
    // catch-up tick within half an hour, not 20 hours later.
    villageWar: 30 * 60,
    era: 20 * 60 * 60,
    mercAuto: 9 * 60,
    settlementReconciliation: 4 * 60,
    clanBossPartySweep: 4 * 60,
    territoryLifecycle: 4 * 60,
    sectorWarSettle: 4 * 60,
    battleLapse: 9 * 60,
    rankedSettlement: 4 * 60,
    guestSweep: 20 * 60 * 60,
    kageInactivity: 20 * 60 * 60,
} as const;

let _timeout: ReturnType<typeof setTimeout> | null = null;
let _kageClockInterval: ReturnType<typeof setInterval> | null = null;
let _kageClockRunning = false;
let _interval: ReturnType<typeof setInterval> | null = null;
let _mercInterval: ReturnType<typeof setInterval> | null = null;
let _settlementInterval: ReturnType<typeof setInterval> | null = null;
let _clanBossPartySweepInterval: ReturnType<typeof setInterval> | null = null;
let _territoryLifecycleInterval: ReturnType<typeof setInterval> | null = null;
let _sectorWarSettleInterval: ReturnType<typeof setInterval> | null = null;
let _battleLapseInterval: ReturnType<typeof setInterval> | null = null;
let _battleLapseBootTimeout: ReturnType<typeof setTimeout> | null = null;
let _rankedSettlementInterval: ReturnType<typeof setInterval> | null = null;
let _rankedSettlementBootTimeout: ReturnType<typeof setTimeout> | null = null;
let _snapshotRecoveryInterval: ReturnType<typeof setInterval> | null = null;
let _snapshotRecoveryRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let _villageWarCatchUpInterval: ReturnType<typeof setInterval> | null = null;
let _villageWarCatchUpBootTimeout: ReturnType<typeof setTimeout> | null = null;
let _villageWarCatchUpRunning = false;
let _settlementScanRunning = false;
let _clanBossPartySweepRunning = false;
let _territoryLifecycleRunning = false;
let _sectorWarSettleRunning = false;
let _battleLapseRunning = false;
let _rankedSettlementRunning = false;
// Pre-pointer journals are discovered once per process until a pass completes.
let _rankedSettlementDiscoveryPending = true;

async function runLeasedJob<T>(jobName: string, ttlSec: number, fn: () => Promise<T>, holdLeaseWhen?: (value: T) => boolean): Promise<T | null> {
    const leased = await withScheduledJobLease(jobName, fn, { ttlSec, holdUntilExpiryOnSuccess: true, holdUntilExpiryWhen: holdLeaseWhen });
    return leased.acquired ? leased.value : null;
}

/** One leased settlement-reconciliation tick (exported so restart tests drive the real entry point). */
export async function fireSettlementReconciliation(includeLegacyScan = false): Promise<void> {
    if (_settlementScanRunning) return;
    _settlementScanRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'settlement-reconciliation',
            async () => {
                try {
                    const exchange = await recoverPendingExchangeListings();
                    if (exchange.failures.length) console.warn('[cron-scheduler] Sunscar trades awaiting recovery:', exchange.failures);
                    const auctions = await recoverExpiredExchangeAuctions();
                    if (auctions.closed) console.log(`[cron-scheduler] Sunscar auctions closed: ${auctions.closed}.`);
                } catch (error) { console.warn('[cron-scheduler] Sunscar recovery deferred:', (error as Error).message); }
                // Mentor milestone rewards admitted but not fully paid (the
                // browser that claimed them may be long gone). Bounded per run;
                // the boot pass also re-publishes any missing discovery pointer.
                try {
                    const mentor = await recoverPendingMentorSettlements({ discover: includeLegacyScan });
                    if (mentor.completed.length || mentor.unfinished.length || mentor.exceptions.length || mentor.failures.length) {
                        console.log(`[cron-scheduler] mentor settlements: ${mentor.completed.length} completed, ${mentor.unfinished.length} retrying, ${mentor.exceptions.length} held for review, ${mentor.deferred} backing off${mentor.truncated ? ' (budget reached)' : ''}.`);
                    }
                    for (const held of mentor.exceptions.slice(0, 5)) console.warn(`[cron-scheduler] mentor settlement ${held.settlementId} (${held.sensei} → ${held.student}) needs review at ${held.step}: ${held.reason}`);
                    if (mentor.failures.length) console.warn('[cron-scheduler] mentor recovery failures:', mentor.failures.slice(0, 5));
                } catch (error) { console.warn('[cron-scheduler] mentor settlement recovery deferred:', (error as Error).message); }
                // Player trades that died between the sender's debit and the
                // recipient's credit, finished from their receipts exactly as
                // the sender's own retry would. Bounded per run.
                try {
                    const trades = await recoverPendingPlayerTrades();
                    if (trades.finished.length || trades.heldForReview.length || trades.failures.length) {
                        console.log(`[cron-scheduler] player trades: ${trades.finished.length} finished, ${trades.heldForReview.length} held for review, ${trades.failures.length} retrying, ${trades.waiting} still settling${trades.truncated ? ' (budget reached)' : ''}.`);
                    }
                    for (const held of trades.heldForReview.slice(0, 5)) console.warn(`[cron-scheduler] player trade ${held.txId} needs review: ${held.reason}`);
                    if (trades.failures.length) console.warn('[cron-scheduler] player trade recovery failures:', trades.failures.slice(0, 5));
                } catch (error) { console.warn('[cron-scheduler] player trade recovery deferred:', (error as Error).message); }
                return runSettlementReconciliation({ includeLegacyScan });
            },
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

async function fireTerritoryLifecycleSweep(): Promise<void> {
    if (_territoryLifecycleRunning) return;
    _territoryLifecycleRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'territory-lifecycle',
            () => runTerritoryLifecycleSweep(),
            { ttlSec: LEASE_TTL.territoryLifecycle, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        if (result.breachesRecovered || result.breachesReleased || result.rewardsSuspended
            || result.rewardsResumed || result.inactiveReleased || result.missingClanReleased || result.errors.length) {
            console.log(`[cron-scheduler] territory lifecycle: ${result.scanned} scanned, ${result.breachesRecovered} recovered, ${result.breachesReleased} breached releases, ${result.rewardsSuspended} suspended, ${result.rewardsResumed} resumed, ${result.inactiveReleased} inactive releases, ${result.missingClanReleased} missing-clan releases, ${result.errors.length} errors.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] territory lifecycle sweep threw:', (err as Error).message);
    } finally {
        _territoryLifecycleRunning = false;
    }
}

async function fireSectorWarSettlement(): Promise<void> {
    if (_sectorWarSettleRunning || !villageWarMapEnabled()) return;
    _sectorWarSettleRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'sector-war-settle',
            () => settleDueSectorWars(),
            { ttlSec: LEASE_TTL.sectorWarSettle, holdUntilExpiryOnSuccess: true },
        );
        if (leased.acquired && leased.value.length > 0) {
            console.log(`[cron-scheduler] sector wars: settled ${leased.value.length}.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] sector-war settlement threw:', (err as Error).message);
    } finally {
        _sectorWarSettleRunning = false;
    }
}

/**
 * The leased village-war daily pass, shared by the 03:00 tick and the catch-up.
 * A run that left any village unfinished RELEASES the lease, so the catch-up
 * tick retries it; only a complete day holds the lease. It used to be held for
 * 20 hours after any run, which left a failed village unpaid for the day.
 */
function runLeasedVillageWarDailyPass(now?: number): Promise<VillageWarDailyResult | null> {
    return runLeasedJob(
        'village-war-daily',
        LEASE_TTL.villageWar,
        () => runVillageWarDailyPass(now === undefined ? {} : { now }),
        (result) => result.complete,
    );
}

function logVillageWarDailyResult(label: string, w: VillageWarDailyResult): void {
    if (!w.enabled) return;
    if (w.ran > 0) console.log(`[cron-scheduler] village-war daily ${label}: ${w.ran}/${w.processed} villages processed.`);
    if (!w.complete) {
        console.warn(`[cron-scheduler] village-war daily ${label} left the day unfinished${w.failed.length ? ` (${w.failed.join(', ')})` : ''}; the catch-up tick retries it.`);
    }
}

/**
 * One village-war catch-up tick (exported so tests drive the real entry point).
 * Past 03:00 UTC with today not yet recorded complete, it re-runs the leased
 * pass: a restart across 03:00 no longer skips the day, and a village that
 * failed is finished within minutes. See runVillageWarDailyCatchUp.
 */
export async function fireVillageWarDailyCatchUp(): Promise<void> {
    if (_villageWarCatchUpRunning || !villageWarMapEnabled()) return;
    _villageWarCatchUpRunning = true;
    try {
        const out = await runBackgroundWork(() => runVillageWarDailyCatchUp({ runPass: runLeasedVillageWarDailyPass }));
        if (out?.status === 'ran') logVillageWarDailyResult('catch-up', out.result);
    } catch (err) {
        console.error('[cron-scheduler] village-war daily catch-up threw:', (err as Error).message);
    } finally {
        _villageWarCatchUpRunning = false;
    }
}

async function fireBattleLapseSweep(): Promise<void> {
    if (_battleLapseRunning) return;
    _battleLapseRunning = true;
    try {
        const leased = await withScheduledJobLease(
            'battle-lapse-sweep',
            () => runBattleLapseSweep(),
            { ttlSec: LEASE_TTL.battleLapse, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        if (result.lapsed > 0 || result.errors.length > 0) {
            console.log(`[cron-scheduler] battle lapse sweep: ${result.scanned} projections scanned, ${result.lapsed} lapsed, ${result.transitioned} terminalized, ${result.settled} settled${result.truncated ? ' (budget reached; continuing next tick)' : ''}${result.errors.length ? `, ${result.errors.length} errors` : ''}.`);
            if (result.errors.length) console.warn(`[cron-scheduler] battle lapse sweep errors: ${result.errors.slice(0, 5).join('; ')}`);
        }
    } catch (err) {
        console.error('[cron-scheduler] battle lapse sweep threw:', (err as Error).message);
    } finally {
        _battleLapseRunning = false;
    }
}

/**
 * One leased player-ranked settlement tick (exported so tests drive the real
 * entry point). The lease keeps the sweep single-owner across replicas and a
 * deploy overlap; the sweep itself is safe to race live sagas.
 */
export async function fireRankedSettlementSweep(): Promise<void> {
    if (_rankedSettlementRunning) return;
    _rankedSettlementRunning = true;
    try {
        const discover = _rankedSettlementDiscoveryPending;
        const leased = await withScheduledJobLease(
            'player-ranked-settlement',
            () => runPlayerRankedSettlementSweep({ discover }),
            { ttlSec: LEASE_TTL.rankedSettlement, holdUntilExpiryOnSuccess: true },
        );
        if (!leased.acquired) return;
        const result = leased.value;
        // Discovery that reached the end (even with a journal held for review)
        // is not repeated this process; a storage error above retries it.
        if (result.discovery) _rankedSettlementDiscoveryPending = false;
        const discovered = result.discovery?.published ?? 0;
        if (result.settled.length || result.voided.length || result.failures.length
            || result.gatePublished || discovered || result.discarded) {
            console.log(`[cron-scheduler] ranked settlement sweep: ${result.settled.length} settled, ${result.voided.length} void, ${result.failures.length} retrying, ${result.deferred} waiting of ${result.pointers} pending${result.gatePublished ? `, ${result.gatePublished} stranded admissions found` : ''}${discovered ? `, ${discovered} older journals found` : ''}${result.truncated ? ' (budget reached; continuing next tick)' : ''}.`);
        }
        for (const failure of result.failures.slice(0, 5)) {
            console.warn(`[cron-scheduler] ranked settlement ${failure.matchId} retrying (attempt ${failure.attempts}): ${failure.error}`);
        }
        if (result.discovery && !result.discovery.complete) {
            console.warn(`[cron-scheduler] ranked settlement discovery left ${result.discovery.failures} unreadable journal(s) for review.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] ranked settlement sweep threw:', (err as Error).message);
    } finally {
        _rankedSettlementRunning = false;
    }
}

/** ms from `now` until the next TARGET_UTC_HOUR:00:00 UTC. */
function msUntilNextTargetHour(now: number): number {
    const d = new Date(now);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TARGET_UTC_HOUR, 0, 0, 0));
    if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now;
}

function scheduleSnapshotRecoveryRetry(): void {
    if (backgroundWorkStopped()) return;
    if (_snapshotRecoveryRetryTimeout || process.env.DISABLE_SNAPSHOT_CRON === '1') return;
    _snapshotRecoveryRetryTimeout = setTimeout(() => {
        _snapshotRecoveryRetryTimeout = null;
        void runBootSnapshotCatchUp();
    }, SNAPSHOT_RECOVERY_RETRY_MS);
    _snapshotRecoveryRetryTimeout.unref?.();
}

function runBootSnapshotCatchUp(): Promise<void> {
    return runBackgroundWork(runBootSnapshotCatchUpCore).then(() => undefined);
}

async function runBootSnapshotCatchUpCore(): Promise<void> {
    let staleMarkerExists = false;
    try {
        const marker = await readSnapshotSuccessMarker();
        if (isSnapshotMarkerFresh(marker)) {
            console.log(`[cron-scheduler] backup freshness ok; last complete run ${new Date(marker!.completedAt).toISOString()}.`);
            return;
        }
        staleMarkerExists = !!marker;
        console.warn('[cron-scheduler] no complete snapshot run in the last 26h; starting boot catch-up.');
    } catch (err) {
        console.error('[cron-scheduler] backup marker read failed; attempting boot catch-up:', (err as Error).message);
    }

    try {
        // This guard serializes recovery across replicas. Version the name to
        // leave behind the old 50m lease held by a stopped deployment.
        const recovery = await withScheduledJobLease(
            'snapshot-recovery-v2',
            async () => {
                const normal = await withScheduledJobLease(
                    'snapshot',
                    () => runSnapshotSaves(NIGHTLY_BUDGET_MS),
                    { ttlSec: LEASE_TTL.snapshot, holdUntilExpiryOnSuccess: true, holdUntilExpiryWhen: (result) => result.ok },
                );
                if (normal.acquired) return normal.value;
                // An older worker may have kept the 20h snapshot lease after
                // an incomplete run. An existing stale marker proves that no
                // complete backup was published, so recover under this guard
                // without deleting the older worker's lease.
                if (!staleMarkerExists) return null;
                return runSnapshotSaves(NIGHTLY_BUDGET_MS);
            },
            {
                ttlSec: SNAPSHOT_RECOVERY_LEASE_SEC,
                holdUntilExpiryOnSuccess: true,
                holdUntilExpiryWhen: (result) => result?.ok === true,
            },
        );
        if (!recovery.acquired || !recovery.value) {
            console.log('[cron-scheduler] snapshot recovery deferred; retrying in 5 min.');
            scheduleSnapshotRecoveryRetry();
            return;
        }
        const result = recovery.value;
        console.log(`[cron-scheduler] boot catch-up: ${result.snapshotted} saved, ${result.skipped} skipped, ${result.failed.length} failed (${result.processed}/${result.total}, ${result.elapsedMs}ms${result.truncated ? ', TRUNCATED' : ''}${result.emptyKeyspace ? ', EMPTY KEYSPACE' : ''}${result.writeOutage ? ', WRITE OUTAGE' : ''}${result.healthMarkerFailed ? ', MARKER WRITE FAILED' : ''}); ${result.ok ? 'healthy' : 'UNHEALTHY'}.`);
        if (!result.ok) scheduleSnapshotRecoveryRetry();
    } catch (err) {
        console.error('[cron-scheduler] boot catch-up threw:', (err as Error).message);
        scheduleSnapshotRecoveryRetry();
    }
}

function fire(): Promise<void> {
    return runBackgroundWork(fireCore).then(() => undefined);
}

async function fireCore(): Promise<void> {
    if (process.env.DISABLE_SNAPSHOT_CRON !== '1') {
        try {
            const r = await runLeasedJob('snapshot', LEASE_TTL.snapshot, () => runSnapshotSaves(NIGHTLY_BUDGET_MS), (result) => result.ok);
            if (!r) {
                // Another process owns this invocation.
            } else if (r.emptyKeyspace) {
                console.error('[cron-scheduler] snapshot run found ZERO saves — check DATABASE_URL / SUPABASE_POSTGRES_URL.');
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
    // expiry + seals + stores). Default on; the canonical Sector Map kill switch
    // makes it a no-op. An unfinished day is retried by the catch-up tick.
    try {
        const w = await runLeasedVillageWarDailyPass();
        if (w) logVillageWarDailyResult('pass', w);
    } catch (err) {
        console.error('[cron-scheduler] village-war daily pass threw:', (err as Error).message);
    }
    // Council reads/actions also catch up immediately at the exact 30-day boundary.
    try { await runLeasedJob('elder-elections', LEASE_TTL.kageInactivity, () => runElderElections()); }
    catch (err) { console.error('[cron-scheduler] elder elections failed:', (err as Error).message); }
    // An ABSENT Kage loses the seat: close any reign whose Kage has not
    // autosaved in 10 days and leave the seat open (fail-safe on unreadable saves).
    try {
        const k = await runLeasedJob('kage-inactivity', LEASE_TTL.kageInactivity, () => runKageInactivityPass());
        if (k && k.dethroned.length > 0) {
            console.log(`[cron-scheduler] kage inactivity pass: seat declared open in ${k.dethroned.join(', ')}.`);
        }
    } catch (err) {
        console.error('[cron-scheduler] kage inactivity pass threw:', (err as Error).message);
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
    if (!_kageClockInterval) {
        const tick = async () => {
            if (_kageClockRunning) return;
            _kageClockRunning = true;
            try { await runBackgroundWork(runKageChallengeClocks); }
            catch (error) { console.warn('[cron-scheduler] Kage clocks:', String(error)); }
            finally { _kageClockRunning = false; }
        };
        _kageClockInterval = setInterval(() => void tick(), KAGE_CLOCK_TICK_MS);
        _kageClockInterval.unref?.();
        void tick();
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
    if (!_territoryLifecycleInterval) {
        _territoryLifecycleInterval = setInterval(() => void fireTerritoryLifecycleSweep(), TERRITORY_LIFECYCLE_TICK_MS);
        _territoryLifecycleInterval.unref?.();
        void fireTerritoryLifecycleSweep();
    }
    if (!_sectorWarSettleInterval) {
        _sectorWarSettleInterval = setInterval(() => void fireSectorWarSettlement(), SECTOR_WAR_SETTLE_TICK_MS);
        _sectorWarSettleInterval.unref?.();
        void fireSectorWarSettlement();
    }
    if (!_villageWarCatchUpInterval) {
        _villageWarCatchUpInterval = setInterval(() => void fireVillageWarDailyCatchUp(), VILLAGE_WAR_CATCHUP_TICK_MS);
        _villageWarCatchUpInterval.unref?.();
        // A restart across 03:00 UTC used to skip the village-war day outright;
        // the first check follows boot closely.
        _villageWarCatchUpBootTimeout = setTimeout(() => {
            _villageWarCatchUpBootTimeout = null;
            void fireVillageWarDailyCatchUp();
        }, VILLAGE_WAR_CATCHUP_BOOT_DELAY_MS);
        _villageWarCatchUpBootTimeout.unref?.();
    }
    if (!_battleLapseInterval) {
        _battleLapseInterval = setInterval(() => void fireBattleLapseSweep(), BATTLE_LAPSE_TICK_MS);
        _battleLapseInterval.unref?.();
        // First pass a minute after boot: a deploy's restart is the classic way
        // for fights to be left behind, and the sweep is cheap.
        _battleLapseBootTimeout = setTimeout(() => {
            _battleLapseBootTimeout = null;
            void fireBattleLapseSweep();
        }, 60_000);
        _battleLapseBootTimeout.unref?.();
    }
    if (!_rankedSettlementInterval) {
        if (process.env.DISABLE_RANKED_SETTLEMENT_SWEEP !== '1') {
            _rankedSettlementInterval = setInterval(() => void fireRankedSettlementSweep(), RANKED_SETTLEMENT_TICK_MS);
            _rankedSettlementInterval.unref?.();
            // A restart mid-saga is exactly what strands a ranked settlement,
            // so the first pass (with discovery) follows boot closely.
            _rankedSettlementBootTimeout = setTimeout(() => {
                _rankedSettlementBootTimeout = null;
                void fireRankedSettlementSweep();
            }, RANKED_SETTLEMENT_BOOT_DELAY_MS);
            _rankedSettlementBootTimeout.unref?.();
        } else {
            console.log('[cron-scheduler] ranked settlement sweep disabled via DISABLE_RANKED_SETTLEMENT_SWEEP=1');
        }
    }
    const snapshotDisabled = process.env.DISABLE_SNAPSHOT_CRON === '1';
    if (snapshotDisabled) {
        console.log('[cron-scheduler] save-snapshot cron disabled via DISABLE_SNAPSHOT_CRON=1');
    }
    if (!snapshotDisabled && !_snapshotRecoveryInterval) {
        _snapshotRecoveryInterval = setInterval(() => void runBootSnapshotCatchUp(), SNAPSHOT_RECOVERY_TICK_MS);
        _snapshotRecoveryInterval.unref?.();
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
    void startClanBossInitialization();
    console.log(`[cron-scheduler] daily jobs scheduled in ${Math.round(delay / 60000)} min (03:00 UTC).`);
}

/** Stop the scheduler (tests / graceful shutdown). */
export function stopSnapshotCron(): void {
    if (_kageClockInterval) { clearInterval(_kageClockInterval); _kageClockInterval = null; }
    if (_timeout) { clearTimeout(_timeout); _timeout = null; }
    if (_interval) { clearInterval(_interval); _interval = null; }
    if (_mercInterval) { clearInterval(_mercInterval); _mercInterval = null; }
    if (_settlementInterval) { clearInterval(_settlementInterval); _settlementInterval = null; }
    if (_clanBossPartySweepInterval) { clearInterval(_clanBossPartySweepInterval); _clanBossPartySweepInterval = null; }
    if (_territoryLifecycleInterval) { clearInterval(_territoryLifecycleInterval); _territoryLifecycleInterval = null; }
    if (_sectorWarSettleInterval) { clearInterval(_sectorWarSettleInterval); _sectorWarSettleInterval = null; }
    if (_villageWarCatchUpInterval) { clearInterval(_villageWarCatchUpInterval); _villageWarCatchUpInterval = null; }
    if (_villageWarCatchUpBootTimeout) { clearTimeout(_villageWarCatchUpBootTimeout); _villageWarCatchUpBootTimeout = null; }
    if (_battleLapseInterval) { clearInterval(_battleLapseInterval); _battleLapseInterval = null; }
    if (_battleLapseBootTimeout) { clearTimeout(_battleLapseBootTimeout); _battleLapseBootTimeout = null; }
    if (_rankedSettlementInterval) { clearInterval(_rankedSettlementInterval); _rankedSettlementInterval = null; }
    if (_rankedSettlementBootTimeout) { clearTimeout(_rankedSettlementBootTimeout); _rankedSettlementBootTimeout = null; }
    if (_snapshotRecoveryInterval) { clearInterval(_snapshotRecoveryInterval); _snapshotRecoveryInterval = null; }
    if (_snapshotRecoveryRetryTimeout) { clearTimeout(_snapshotRecoveryRetryTimeout); _snapshotRecoveryRetryTimeout = null; }
    // Running jobs clear their own flags when they actually finish. Clearing
    // these here could admit a duplicate if the scheduler is restarted while
    // its preceding invocation is still draining.
}
