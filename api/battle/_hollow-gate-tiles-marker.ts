import { kv as realKv } from '../_storage.js';
import { safeName } from '../_utils.js';

/*
 * The rift card ambush screen holds a client-written compatibility marker,
 * `battle-lock:<player>` with kind `hollowGateTiles` (components/BattleLockKeeper
 * on the client, api/battle/lock.ts here). The heartbeat treats ANY battle-lock
 * as a live fight (api/_realtime/battle-authority.ts), so while it stands the
 * player cannot travel, and only the client's own `resolve` call removes it.
 *
 * On 2026-11-06 that resolve never came: the card match settled, the dive went
 * on, the player was knocked out, and the marker held them in place for the
 * rest of its one-hour TTL. The Chronicle match itself is server-owned and
 * settled here, so the server now retires the marker when the match settles
 * or the run ends instead of trusting the browser to.
 *
 * Only a `hollowGateTiles` marker is touched, and only by compare-and-delete on
 * the exact value read: a Tower lease or any other screen's marker under the
 * same key is never removed. Best-effort; the one-hour TTL stays the backstop.
 */

type MarkerStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    delIfEqual(key: string, expected: unknown): Promise<boolean>;
};

export const HOLLOW_GATE_TILES_MARKER_KIND = 'hollowGateTiles';

export async function clearHollowGateTilesMarker(playerName: string, store: MarkerStore = realKv): Promise<boolean> {
    const slug = safeName(playerName);
    if (!slug) return false;
    const key = `battle-lock:${slug}`;
    try {
        const current = await store.get<{ kind?: unknown }>(key);
        if (!current || typeof current !== 'object' || current.kind !== HOLLOW_GATE_TILES_MARKER_KIND) return false;
        return await store.delIfEqual(key, current);
    } catch {
        return false;
    }
}
