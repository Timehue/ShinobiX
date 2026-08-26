/*
 * Sector scars — the KV half.
 *
 * Shapes, pruning and wording are pure in `shared/sector-scars.ts`. This owns
 * the one row per sector and the write.
 *
 * Storage: `world:scars:<sector>` — a short newest-first array under
 * `withKvLock`, with a TTL a little past the scar lifetime so a dead row
 * self-cleans. Same namespace and the same shape of thing as
 * `world:trail-signs:<sector>`; not a schema change.
 *
 * The write is fired from the PvP reward claim, and it is BEST-EFFORT in the
 * strongest sense: it is a display record that nothing reads back to decide
 * anything, so it must never delay, fail or complicate a currency settlement.
 * The lock is deliberately NOT failClosed — losing a rumour to contention is
 * correct; failing someone's reward claim over one would not be.
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { isWildSector } from '../shared/sector-geo.js';
import {
    parseScars, pruneScars, withScar, SCAR_TTL_MS, type SectorScar,
} from '../shared/sector-scars.js';

export const SCARS_KEY_PREFIX = 'world:scars:';
/** A day past the scar lifetime, so an untouched row disappears on its own. */
export const SCARS_TTL_SECONDS = Math.floor((SCAR_TTL_MS * 2) / 1000);

export function sectorScarsKey(sector: number): string {
    return `${SCARS_KEY_PREFIX}${Math.floor(sector)}`;
}

/** Today's scars on a sector, newest first. Never throws. */
export async function readSectorScars(sector: number, now: number = Date.now()): Promise<SectorScar[]> {
    const id = Math.floor(Number(sector));
    if (!isWildSector(id)) return [];
    try {
        return pruneScars(parseScars(await kv.get(sectorScarsKey(id))), now);
    } catch {
        return [];
    }
}

/**
 * Remember a duel on this sector.
 *
 * Silent on every failure path — an unusable sector, a nameless victor, a
 * contended lock or a storage blip all simply leave no mark.
 */
export async function recordSectorDuelScar(
    sector: number,
    victor: string,
    fallen: string,
    now: number = Date.now(),
): Promise<void> {
    const id = Math.floor(Number(sector));
    const who = String(victor ?? '').trim();
    if (!isWildSector(id) || !who) return;
    const key = sectorScarsKey(id);
    try {
        await withKvLock(key, async () => {
            const next = withScar(
                parseScars(await kv.get(key)),
                { kind: 'duel', victor: who, fallen: String(fallen ?? '').trim(), at: now },
                now,
            );
            await kv.set(key, next, { ex: SCARS_TTL_SECONDS });
        });
    } catch {
        /* a rumour is not worth failing a settlement over */
    }
}
