import { kv as realKv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { hollowGateRunKey, type HollowGateRunToken } from '../hollow-gate/_run-token.js';

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
 * Capture the marker BEFORE settlement and bind that capture to the current
 * saved run (and pending match for card settlement). Cleanup must not read a
 * marker after settlement: a newer dive may already have installed its own.
 * Best-effort; the one-hour TTL stays the backstop for unprovable legacy state.
 */

type MarkerStore = {
    get<T = unknown>(key: string): Promise<T | null>;
    delIfEqual(key: string, expected: unknown): Promise<boolean>;
};

export const HOLLOW_GATE_TILES_MARKER_KIND = 'hollowGateTiles';

export type CapturedHollowGateTilesMarker = {
    playerName: string;
    token: string;
    matchId?: string;
    marker: object;
};

export async function captureHollowGateTilesMarker(
    playerName: string,
    token: string,
    matchId?: string,
    store: MarkerStore = realKv,
): Promise<CapturedHollowGateTilesMarker | null> {
    const slug = safeName(playerName);
    if (!slug || !token) return null;
    try {
        // Read the marker first: subsequent validation can only authorize this
        // exact snapshot, never a replacement published during settlement.
        const marker = await store.get<{ kind?: unknown }>(`battle-lock:${slug}`);
        if (!marker || typeof marker !== 'object' || marker.kind !== HOLLOW_GATE_TILES_MARKER_KIND) return null;
        const [save, run] = await Promise.all([
            store.get<{ character?: { hollowGateRun?: { runToken?: string } | null } }>(`save:${slug}`),
            store.get<HollowGateRunToken>(hollowGateRunKey(slug, token)),
        ]);
        if (save?.character?.hollowGateRun?.runToken !== token || !run || safeName(run.playerName) !== slug
            || (matchId !== undefined && run.cardAmbushMatchId !== matchId)) return null;
        return { playerName: slug, token, ...(matchId !== undefined ? { matchId } : {}), marker };
    } catch {
        return null;
    }
}

export async function clearHollowGateTilesMarker(
    playerName: string,
    captured: CapturedHollowGateTilesMarker | null,
    store: MarkerStore = realKv,
): Promise<boolean> {
    const slug = safeName(playerName);
    if (!slug || !captured || captured.playerName !== slug) return false;
    try {
        return await store.delIfEqual(`battle-lock:${slug}`, captured.marker);
    } catch {
        return false;
    }
}
