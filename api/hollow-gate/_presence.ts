import { safeName } from '../_utils.js';
import {
    noteBattleEnded,
    noteBattleStarted,
    publishBattleProjection,
    retireBattleProjection,
    type BattleProjectionStore,
} from '../_realtime/battle-projection.js';

/*
 * Presence for a Hollow Gate dive (F01).
 *
 * A diver is inside the Gate, not on the sector board: the client used to
 * assert `inBattle` through the tile game and the dungeon events, and that
 * claim is no longer honoured. The dive is instead proven from its own run
 * key — `hg-run:<slug>:<token>` exists exactly while the dive is live, and is
 * deleted when the run settles or the diver dies — through the per-player
 * battle projection the heartbeat already reads. The projection's expiry is
 * only a hint for the lapse sweep; the resolver verifies the run key itself.
 */

/** Long enough for any dive; the resolver checks the run key, not this clock. */
const HOLLOW_GATE_PRESENCE_HINT_MS = 24 * 60 * 60 * 1000;
const HOLLOW_GATE_PRESENCE_RETAIN_SECONDS = 7 * 24 * 60 * 60;

export async function publishHollowGatePresence(store: BattleProjectionStore, playerName: string, token: string, now: number = Date.now()): Promise<void> {
    const slug = safeName(playerName);
    if (!slug || !token) return;
    await publishBattleProjection(store, slug, {
        kind: 'hollow-gate',
        sessionId: token,
        startedAt: now,
        expiresAt: now + HOLLOW_GATE_PRESENCE_HINT_MS,
    }, HOLLOW_GATE_PRESENCE_RETAIN_SECONDS).catch(() => undefined);
    noteBattleStarted(slug);
}

export async function retireHollowGatePresence(store: BattleProjectionStore, playerName: string, token: string): Promise<void> {
    const slug = safeName(playerName);
    if (!slug || !token) return;
    if (await retireBattleProjection(store, slug, token).catch(() => false)) noteBattleEnded(slug);
}

/** Every dive-ending path holds the run key rather than the token; parse it back. */
export async function retireHollowGatePresenceByRunKey(store: BattleProjectionStore, runKey: string): Promise<void> {
    const match = /^hg-run:([^:]+):(.+)$/.exec(runKey);
    if (!match) return;
    await retireHollowGatePresence(store, match[1], match[2]);
}
