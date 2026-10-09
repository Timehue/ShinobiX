/*
 * The per-player index of fights sealed from the save, so the next fight sealed
 * from it can settle them first (api/pve/_held-fights.ts).
 *
 * A hash per player, `pve-held-fights:<slug>`, one field per session holding the
 * moment it was sealed. writeSoloPveSession adds a field when it persists a new
 * session (./_store.ts); settleHeldFights deletes the fields it has dealt with.
 * Kept light on purpose, because the store imports it.
 */
import { safeName } from '../_utils.js';
import { sessionIsSpar } from '../missions/_ai-fight-outcome.js';
import type { SoloPveSession } from './_session.js';

export const HELD_FIGHTS_PREFIX = 'pve-held-fights:';

export function heldFightsKey(playerName: string): string {
    return `${HELD_FIGHTS_PREFIX}${safeName(playerName)}`;
}

/**
 * Whether a later fight must settle this one before it is sealed: it was seeded
 * from the save (so its cost is what the save does not carry yet), and it is
 * not a spar, which writes nothing.
 */
export function isHeldFight(session: SoloPveSession): boolean {
    return Boolean(session.seededVitals) && !sessionIsSpar(session);
}

export type HeldFightIndexStore = {
    hset?(key: string, fields: Record<string, unknown>): Promise<unknown>;
};

/** Index a newly sealed fight. Best-effort: a fight that misses the index is
 *  still settled by its own mode, and charged what the save lost since. */
export async function noteHeldFight(store: HeldFightIndexStore, session: SoloPveSession): Promise<void> {
    if (!store.hset || !isHeldFight(session)) return;
    const slug = safeName(session.ownerSlug);
    if (!slug) return;
    try {
        await store.hset(heldFightsKey(slug), { [session.sessionId]: session.createdAt });
    } catch (error) {
        console.warn('[solo-pve] held-fight index deferred', session.sessionId, (error as Error)?.message ?? error);
    }
}
