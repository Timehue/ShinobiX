import { createStartupRecovery } from './_startup-recovery.js';
import { clanBossEnabled, villageWarMapEnabled } from './_release-flags.js';
import { scheduledJobsDisabled } from './_launch-controls.js';
import { kv } from './_storage.js';
import { clanBossWeekId, clanBossWeekKey, type ClanBossWeek } from './clan-boss/_storage.js';
import { ensureCurrentWeek, runClanBossWeekly } from './cron/_clan-boss-weekly.js';
import { withScheduledJobLease } from './cron/_job-lease.js';
import { seedHomeSectorOwnership } from './world-state.js';
import { NPC_ACCOUNT_SLUGS } from '../shared/npc-village-roster.js';
import { seedNpcVillage } from './_npc-village-seed.js';
import { readNpcVillageScaling, refreshNpcVillageScaling } from './_npc-village-scaling.js';
import { isNpcPossessed } from './_npc-possession.js';

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

// Held after a clean seed so a second container booting alongside does not
// rebuild the thirty accounts again (the scheduler's old boot seed used this).
export const NPC_VILLAGE_SEED_LEASE_SECONDS = 10 * 60;

/**
 * Cinderhold: on a fresh server (or after a reset that skipped its own seed)
 * the thirty NPC accounts do not exist yet. Seed them when any is missing; the
 * 03:00 daily pass rescales them.
 *
 * This used to run inline in the scheduler as thirty parallel kv.get calls at
 * the moment a deploy starts. During Railway's container swap the old container
 * still holds its pg sessions, so that burst crossed the Supabase pooler's
 * session cap and every deploy logged EMAXCONNSESSION and skipped the seed. It
 * is now ONE mget, and a transient failure (pool full, connection reset) or a
 * partial seed is retried by the same bounded startup recovery as the other
 * boot jobs, instead of waiting for 03:00.
 *
 * "Present" means BOTH rows of every NPC: the seed stamps `auth:` first and
 * commits `save:` second (api/_npc-village-seed.ts rebuildNpcAccount), so a
 * failed save commit leaves an account with no character. And after a seed in
 * this process came back incomplete (a save, a clan, the registry or the
 * avatar index), the retry re-runs the whole idempotent seed rather than trust
 * a presence check that only sees accounts and saves.
 */
let npcSeedIncomplete = false;
export async function initializeNpcVillage(): Promise<boolean> {
    if (scheduledJobsDisabled() || process.env.DISABLE_NPC_VILLAGE === '1') return true;
    if (!npcSeedIncomplete) {
        const rows = await kv.mget(...NPC_ACCOUNT_SLUGS.flatMap((slug) => [`auth:${slug}`, `save:${slug}`]));
        if (rows.every(Boolean)) return true;
    }
    const result = await withScheduledJobLease('npc-village-seed', async () => {
        // Follow the live players from the first boot, not the floor level.
        if (!await readNpcVillageScaling()) await refreshNpcVillageScaling();
        const seeded = await seedNpcVillage(Date.now(), (slug) => isNpcPossessed(slug));
        console.log(`[startup] Cinderhold seed: ${seeded.seeded.length} seeded${seeded.failures.length ? `, ${seeded.failures.length} failures: ${seeded.failures.slice(0, 3).join('; ')}` : ''}.`);
        npcSeedIncomplete = seeded.failures.length > 0;
        return seeded.failures.length === 0;
    }, {
        ttlSec: NPC_VILLAGE_SEED_LEASE_SECONDS,
        holdUntilExpiryOnSuccess: true,
        // A partial seed releases the lease, so the retry is not locked out.
        holdUntilExpiryWhen: (clean) => clean,
    });
    // Contended means another process is seeding: the retry then finds the rows.
    return result.acquired && result.value;
}

export function startClanBossInitialization() { return recovery.start('clan-boss', initializeClanBoss); }
export function startTerritoryInitialization() { return recovery.start('territory', initializeTerritory); }
export function startNpcVillageInitialization() { return recovery.start('npc-village', initializeNpcVillage); }
export function stopStartupInitialization() { recovery.stop(); }
