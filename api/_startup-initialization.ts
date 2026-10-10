import { createStartupRecovery } from './_startup-recovery.js';
import { clanBossEnabled, villageWarMapEnabled } from './_release-flags.js';
import { scheduledJobsDisabled } from './_launch-controls.js';
import { kv } from './_storage.js';
import { clanBossWeekId, clanBossWeekKey, type ClanBossWeek } from './clan-boss/_storage.js';
import { runClanBossWeekly } from './cron/_clan-boss-weekly.js';
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

export async function initializeTerritory(): Promise<boolean> {
    if (!villageWarMapEnabled()) return true;
    const result = await withScheduledJobLease('startup:territory', async () => {
        if (!villageWarMapEnabled()) return true;
        const { seeded, sectors } = await seedHomeSectorOwnership();
        if (seeded > 0) console.log(`[war-map] seeded ${seeded} home sectors: ${sectors.join(', ')}`);
        return true;
    }, { ttlSec: STARTUP_LEASE_SECONDS });
    return result.acquired && result.value;
}

export function startClanBossInitialization() { return recovery.start('clan-boss', initializeClanBoss); }
export function startTerritoryInitialization() { return recovery.start('territory', initializeTerritory); }
export function stopStartupInitialization() { recovery.stop(); }
