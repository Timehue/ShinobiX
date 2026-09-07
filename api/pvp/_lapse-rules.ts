import { SESSION_TTL } from '../combat-core/constants.js';
import type { PvpSession } from './session.js';

/*
 * Pure rules for a LAPSED PvP session (F08): active, but untouched by anyone
 * for a whole session TTL. Kept free of settlement imports so the presence
 * resolver (api/_realtime/battle-authority.ts) and the engagement gate
 * (api/_realtime/world-duel-engagement.ts) can consult them cheaply.
 *
 * "Touched" is any server write that advances the fight's clock: a real move
 * stamps `lastMoveAt`, and a lapsed turn — which EITHER player's poll makes
 * the server pass (api/pvp/_turn-deadline.ts) — re-stamps `turnStartedAt`. So
 * a duel with one present player keeps advancing through auto-waits until
 * that player claims the forfeit; only a duel NOBODY is reading goes quiet
 * for the full TTL. That is a double walk-out, and it ends as a draw.
 */

export const PVP_LAPSED_RETENTION_SECONDS = 24 * 60 * 60;

export function pvpSessionLastTouchedAt(
    session: Pick<PvpSession, 'createdAt' | 'lastMoveAt' | 'turnStartedAt' | 'endedAt'>,
): number {
    return Math.max(
        Number(session.createdAt) || 0,
        Number(session.lastMoveAt) || 0,
        Number(session.turnStartedAt) || 0,
        Number(session.endedAt) || 0,
    );
}

/**
 * Sessions whose lifecycle is owned elsewhere never lapse here: admin bouts
 * (no real fighters) and player-ranked V2 matches, whose orphan/close
 * tombstones and journal saga decide their own ending.
 */
export function pvpSessionMayLapse(
    session: Pick<PvpSession, 'rewardAuthority' | 'rankedKind' | 'playerRankedAuthorityVersion' | 'rankedMatchId'>,
): boolean {
    if (session.rewardAuthority === 'admin') return false;
    if (session.rankedKind === 'player' && typeof session.rankedMatchId === 'string' && session.playerRankedAuthorityVersion !== undefined) return false;
    return true;
}

export function pvpSessionLapsesAt(
    session: Pick<PvpSession, 'createdAt' | 'lastMoveAt' | 'turnStartedAt' | 'endedAt'>,
): number {
    return pvpSessionLastTouchedAt(session) + SESSION_TTL * 1000;
}

export function isPvpSessionLapsed(
    session: Pick<PvpSession, 'status' | 'createdAt' | 'lastMoveAt' | 'turnStartedAt' | 'endedAt' | 'rewardAuthority' | 'rankedKind' | 'playerRankedAuthorityVersion' | 'rankedMatchId'>,
    now: number = Date.now(),
): boolean {
    return session.status === 'active' && pvpSessionMayLapse(session) && pvpSessionLapsesAt(session) <= now;
}
