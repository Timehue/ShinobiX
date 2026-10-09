import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import type { PvpSession } from './session.js';

// Must match api/player/challenge.ts: same inbox key, same lease. The heartbeat
// only READS the inbox, so a delivered sector-attack notice stays there for the
// whole lease and is re-delivered every beat.
const CHALLENGE_TTL = 180;

function namesBattle(entry: unknown, battleId: string): boolean {
    return !!entry && typeof entry === 'object' && (entry as { battleId?: unknown }).battleId === battleId;
}

/**
 * Drop the notice that points at `battleId` from `owner`'s challenge inbox. A
 * duel that has ended (cancelled, fled, knocked out, lapsed) must not leave its
 * notice behind: the defender's client routes into the battle named by any
 * sector-attack notice it is handed, so a stale one walks them straight back
 * into a finished duel.
 */
export async function releaseBattleChallengeNotice(owner: string, battleId: string): Promise<void> {
    const key = `challenges:${safeName(owner)}`;
    // Unlocked peek: the overwhelmingly common case is an empty inbox, and a
    // terminal replay runs on every terminal read.
    const peek = await kv.get<unknown[]>(key);
    if (!Array.isArray(peek) || !peek.some((entry) => namesBattle(entry, battleId))) return;
    await withKvLock(key, async () => {
        const existing = await kv.get<unknown[]>(key);
        if (!Array.isArray(existing)) return;
        const kept = existing.filter((entry) => !namesBattle(entry, battleId));
        if (kept.length === existing.length) return;
        if (kept.length) await kv.set(key, kept, { ex: CHALLENGE_TTL });
        else await kv.del(key);
    });
}

/** Release the notice for both fighters of a finished duel. Best-effort: the lease expires on its own. */
export async function releaseBattleChallengeNotices(session: Pick<PvpSession, 'battleId' | 'p1' | 'p2'>): Promise<void> {
    for (const fighter of [session.p1, session.p2]) {
        try {
            await releaseBattleChallengeNotice(fighter.name, session.battleId);
        } catch (error) {
            console.error('[pvp/challenge-inbox] could not release stale challenge notice', error);
        }
    }
}
