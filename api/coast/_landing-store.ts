/*
 * The Clan Landing's row, and the two things that end one.
 *
 * Kept apart from _landing.ts so api/coast/_land.ts can bring a Landing down
 * when its sector is lost without the two files importing each other.
 *
 * Lock order on the coast: `coast:land`, then a contest or Landing key, then a
 * player save. Losing a sector holds the land lock and takes the Landing key
 * here. A contribution takes the Landing key and then the member's save
 * (api/_save-debit-saga.ts). Nothing takes them the other way round.
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import type { CoastLanding } from './_landing-rules.js';

export const coastLandingKey = (clanSlug: string) => `coast:landing:${clanSlug}`;
const lockOptions = { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 } as const;

export function readCoastLanding(clanSlug: string): Promise<CoastLanding | null> {
    return kv.get<CoastLanding>(coastLandingKey(clanSlug));
}

/**
 * The sector under a Landing is no longer the clan's, so the Landing falls with
 * it. The row is kept, marked destroyed and emptied: its settlement receipts
 * stay, so a contribution that is retried after the fall is recognised and
 * burned instead of being credited to whatever the clan builds next.
 */
export async function destroyCoastLanding(lost: { clanSlug: string; sector: number; landingEpoch: number }, reason: string, now = Date.now()): Promise<boolean> {
    const key = coastLandingKey(lost.clanSlug);
    return withKvLock(key, async () => {
        const landing = await kv.get<CoastLanding>(key);
        if (!landing || landing.status === 'destroyed' || landing.sector !== lost.sector || landing.landingEpoch !== lost.landingEpoch) return false;
        // What it was is kept beside the emptied row, for one purpose: an admin
        // putting back a Landing that a fault brought down (restoreCoastLanding).
        // A refounding starts a new row and leaves this behind.
        const was = { tier: landing.tier, stores: landing.stores, works: landing.works ?? [] };
        await kv.set(key, { ...landing, status: 'destroyed', tier: 0, stores: {}, works: [], lost: was, destroyedAt: now, destroyedReason: reason } satisfies CoastLanding);
        return true;
    }, lockOptions);
}

/** The clan itself is gone: its Landing row goes with it. */
export async function deleteCoastLanding(clanSlug: string): Promise<void> {
    const key = coastLandingKey(clanSlug);
    await withKvLock(key, () => kv.del(key), lockOptions);
}
