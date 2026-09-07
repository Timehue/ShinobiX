import { safeName } from '../_utils.js';
import {
    noteBattleEnded,
    noteBattleStarted,
    publishBattleProjection,
    retireBattleProjection,
    type BattleProjectionStore,
} from '../_realtime/battle-projection.js';

/*
 * Presence for a pet showdown against the server's AI (F01).
 *
 * The showdown engine is server-only: the session at
 * `pet:showdown:<slug>:<sessionId>` is the fight, and `finished` is its
 * terminal mark. The client used to assert `inBattle` for the duration; that
 * claim is no longer honoured, so the session is proven instead through the
 * per-player battle projection the heartbeat already reads. The projection's
 * expiry is only a hint for the lapse sweep; the resolver reads the session.
 */

const SHOWDOWN_PRESENCE_HINT_MS = 45 * 60 * 1000;
const SHOWDOWN_PRESENCE_RETAIN_SECONDS = 24 * 60 * 60;

export async function publishShowdownPresence(store: BattleProjectionStore, playerName: string, sessionId: string, now: number = Date.now()): Promise<void> {
    const slug = safeName(playerName);
    if (!slug || !sessionId) return;
    await publishBattleProjection(store, slug, {
        kind: 'pet-showdown',
        sessionId,
        startedAt: now,
        expiresAt: now + SHOWDOWN_PRESENCE_HINT_MS,
    }, SHOWDOWN_PRESENCE_RETAIN_SECONDS).catch(() => undefined);
    noteBattleStarted(slug);
}

export async function retireShowdownPresence(store: BattleProjectionStore, playerName: string, sessionId: string): Promise<void> {
    const slug = safeName(playerName);
    if (!slug || !sessionId) return;
    if (await retireBattleProjection(store, slug, sessionId).catch(() => false)) noteBattleEnded(slug);
}
