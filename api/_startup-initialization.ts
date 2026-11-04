import { createStartupRecovery } from './_startup-recovery.js';
import { clanBossEnabled, villageWarMapEnabled } from './_release-flags.js';
import { scheduledJobsDisabled } from './_launch-controls.js';
import { kv } from './_storage.js';
import { clanBossWeekId, clanBossWeekKey, type ClanBossWeek } from './clan-boss/_storage.js';
import { ensureCurrentWeek, runClanBossWeekly } from './cron/_clan-boss-weekly.js';
import { withScheduledJobLease } from './cron/_job-lease.js';
import { seedHomeSectorOwnership } from './world-state.js';

// Separate from the daily 20-hour cadence lease. A dead startup owner expires
// within five minutes; every guarded operation still checks ownership/expiry.
export const STARTUP_LEASE_SECONDS = 300;
const recovery = createStartupRecovery();

export async function initializeClanBoss(): Promise<boolean> {
    if (scheduledJobsDisabled() || !clanBossEnabled()) return true;
    const weekId = clanBossWeekId(Date.now());
    const result = await withScheduledJobLease(`startup:clan-boss:${weekId}`, async () => {
        if (scheduledJobsDisabled() || !clanBossEnabled()) return true;
        const now = Date.now();
        // Acquiring storage can itself cross Monday. Release the old-week lease
        // without starting work, then retry under the current week's identity.
        if (clanBossWeekId(now) !== weekId) return false;
        await runClanBossWeekly(now);
        if (!await kv.get(clanBossWeekKey(weekId))) return false;
        // A resolved call can leave settlement incomplete: verify persisted state.
        for (const key of await kv.keys('clan-boss:week:*')) {
            const week = await kv.get<ClanBossWeek>(key);
            if (week && !week.settled && week.endsAt <= now) return false;
        }
        return clanBossWeekId(Date.now()) === weekId;
    }, { ttlSec: STARTUP_LEASE_SECONDS });
    return result.acquired && result.value;
}

/**
 * Open the current Clan Boss week as soon as it begins.
 *
 * Weeks start at Monday 00:00 UTC, but the daily pass runs at 03:00 and only
 * a boot also opens one, so every Monday the boss read as inactive for three
 * hours. The 5-minute tick calls this: one read when the week exists, and an
 * NX spawn (one announcement) when not.
 *
 * It only OPENS the week. Settling the week that just ended stays with the
 * 03:00 pass: an assault started before midnight banks into the old week when
 * it finishes, and settling at 00:05 would rank the week without it.
 */
export async function ensureCurrentClanBossWeek(now: number = Date.now()): Promise<void> {
    if (scheduledJobsDisabled() || !clanBossEnabled()) return;
    await ensureCurrentWeek(now);
}

export async function initializeTerritory(): Promise<boolean> {
    // Same gate as the Clan Boss boot pass above: DISABLE_SCHEDULED_JOBS stops
    // every boot-time and periodic writer, and the admin `seed` action remains.
    if (scheduledJobsDisabled() || !villageWarMapEnabled()) return true;
    const result = await withScheduledJobLease('startup:territory', async () => {
        if (scheduledJobsDisabled() || !villageWarMapEnabled()) return true;
        const { seeded, sectors } = await seedHomeSectorOwnership();
        if (seeded > 0) console.log(`[war-map] seeded ${seeded} home sectors: ${sectors.join(', ')}`);
        return true;
    }, { ttlSec: STARTUP_LEASE_SECONDS });
    return result.acquired && result.value;
}

export function startClanBossInitialization() { return recovery.start('clan-boss', initializeClanBoss); }
export function startTerritoryInitialization() { return recovery.start('territory', initializeTerritory); }
export function stopStartupInitialization() { recovery.stop(); }
