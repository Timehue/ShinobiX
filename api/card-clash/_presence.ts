import { safeName } from '../_utils.js';
import { CHRONICLE_AFK_STRIKE_LIMIT, TURN_TIMEOUT_MS } from '../../shared/chronicle-duel.js';
import {
    noteBattleEnded,
    noteBattleStarted,
    publishBattleProjection,
    retireBattleProjection,
    type BattleProjectionStore,
} from '../_realtime/battle-projection.js';

/*
 * Presence for a Chronicle card duel (F01).
 *
 * Three hosts share the Chronicle engine — free-play PvP (`cc-freeplay:<id>`),
 * the clan-war tile-card duel (`cw-tilecards:<id>`) and the sector-war card
 * battle (`sector-card:<id>`) — and each keeps one session row with the two
 * duelists' names and a status that ends in `done`. The client used to assert
 * `inBattle` for the duel's screens; the session is proven instead through
 * the per-player battle projection the heartbeat reads: `sessionId` is the
 * session's own KV key, so the resolver reads the row and honours a duelist
 * whose duel is `active` (both seated, the match live). A challenger with an
 * open seat is NOT in a fight yet: the seat stays open for the session's whole
 * two-hour life, and an open challenge must never double as a roaming shield.
 */

export type CardDuelSessionShape = {
    p1Name?: string;
    p2Name?: string;
    status: string;
    /** The live match; `turnStartedAt` is when its current turn began. */
    state?: { turnStartedAt?: unknown } | null;
};

// The duel clock (shared/chronicle-duel.ts advanceExpiredChronicleTurn) only
// runs when a duelist sends a request, so a duel BOTH sides leave untouched
// stayed `active` for its whole 2h TTL — renewable by one end-turn — and kept
// a logged-off player un-campable. A real duel's turn never outlives
// TURN_TIMEOUT_MS by much (two missed turns forfeit it), so a turn older than
// three timeouts is a duel nobody is playing.
const CARD_DUEL_STALE_TURN_MS = TURN_TIMEOUT_MS * (CHRONICLE_AFK_STRIKE_LIMIT + 1);

const CARD_DUEL_PRESENCE_RETAIN_SECONDS = 24 * 60 * 60;

export function cardDuelParticipants(session: CardDuelSessionShape): string[] {
    return [session.p1Name, session.p2Name]
        .map((name) => safeName(String(name ?? '')))
        .filter(Boolean);
}

/** True when `slug` is a duelist in a session whose match is live. */
export function cardDuelEngages(session: CardDuelSessionShape | null | undefined, slug: string, now: number = Date.now()): boolean {
    if (!session || session.status !== 'active') return false;
    const turnStartedAt = Number(session.state?.turnStartedAt);
    if (Number.isFinite(turnStartedAt) && turnStartedAt > 0 && now - turnStartedAt > CARD_DUEL_STALE_TURN_MS) return false;
    return cardDuelParticipants(session).includes(safeName(slug));
}

/**
 * Called after every session write. Publishes the projection for each
 * duelist while the match is live; retires it for both once the duel is done
 * (and does nothing for an open seat, which never had one). Best-effort: a
 * failed projection write is repaired by the next write, and the resolver
 * verifies the session row itself either way.
 */
export async function syncCardDuelPresence(
    store: BattleProjectionStore,
    sessionKey: string,
    session: CardDuelSessionShape,
    ttlSeconds: number,
    now: number = Date.now(),
): Promise<void> {
    const duelists = cardDuelParticipants(session);
    for (const slug of duelists) {
        try {
            if (session.status !== 'active') {
                if (await retireBattleProjection(store, slug, sessionKey)) noteBattleEnded(slug);
            } else {
                await publishBattleProjection(store, slug, {
                    kind: 'card-clash',
                    sessionId: sessionKey,
                    startedAt: now,
                    expiresAt: now + Math.max(1, ttlSeconds) * 1000,
                }, CARD_DUEL_PRESENCE_RETAIN_SECONDS);
                noteBattleStarted(slug);
            }
        } catch {
            // Presence is a projection; the session row stays authoritative.
        }
    }
}
