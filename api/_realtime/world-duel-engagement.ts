import type { KvLike } from '../_storage.js';
import { loadPvpPendingSessionPointer } from '../pvp/_pending-session.js';
import { pvpSessionCarriesVitals } from '../pvp/_vitals-settlement.js';
import type { PvpSession } from '../pvp/session.js';
import type { OnlinePlayer } from './types.js';

/*
 * F10 — is this player engaged in a WORLD duel right now?
 *
 * Presence accepts a claim of sector 0 ("I walked into town") unconditionally,
 * because town entry is pure client navigation. That is the intended
 * convenience — and also an escape hatch: a player who has just been attacked
 * in the wild, or who is mid-raid, could open a town screen and vanish from the
 * sector before the fight reached them. A safe-zone exit is now refused while
 * the player is engaged; opening a panel never moves an engaged character.
 *
 * Evidence, all server-written:
 *   • `pendingAttacker` on the presence row — /api/player/attack queued a raid
 *     and the target's own next beat is the one that delivers it;
 *   • the PvP pending-session pointer whose session is still `active` and
 *     carries real vitals (a sector raid or village guard/defense — not a
 *     spar or ranked bout, which reset both fighters and cannot be "escaped"
 *     into town in any way that matters); a pointer still `reserving` counts
 *     while its reservation is fresh.
 * Nothing else counts. A pointer left over from a FINISHED duel (kept for
 * terminal recovery) is not engagement, and a lingering Solo-PvE session is
 * deliberately ignored — blocking town on it would trap a player whose AI
 * fight pointer outlived a crashed tab.
 */

export type EngagementStore = Pick<KvLike, 'get'>;

export async function engagedInWorldDuel(
    store: EngagementStore,
    playerName: string,
    presence: Pick<OnlinePlayer, 'pendingAttacker'> | null | undefined,
    now: number = Date.now(),
): Promise<boolean> {
    if (presence?.pendingAttacker) return true;
    let pointer;
    try {
        pointer = await loadPvpPendingSessionPointer(store as Parameters<typeof loadPvpPendingSessionPointer>[0], playerName);
    } catch {
        // A malformed pointer is not evidence of a fight.
        return false;
    }
    if (!pointer) return false;
    if (pointer.phase === 'reserving') return Number(pointer.reservedUntil) > now;
    const session = await store.get<PvpSession>(`pvp:${pointer.battleId}`).catch(() => null);
    if (!session || session.status !== 'done' && session.status !== 'active') return false;
    return session.status === 'active' && pvpSessionCarriesVitals(session);
}

/**
 * The sector a presence write may adopt: the requested one, unless it is a
 * safe-zone exit by an engaged player, in which case the player stays put.
 */
export async function presenceSectorForWrite(
    store: EngagementStore,
    playerName: string,
    existing: Pick<OnlinePlayer, 'sector' | 'pendingAttacker'> | null | undefined,
    requestedSector: number,
    now: number = Date.now(),
): Promise<number> {
    const safeZoneExit = !!existing && existing.sector !== 0 && requestedSector === 0;
    if (!safeZoneExit) return requestedSector;
    return (await engagedInWorldDuel(store, playerName, existing, now)) ? existing.sector : requestedSector;
}
