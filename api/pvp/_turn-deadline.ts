import type { KvLike } from '../_storage.js';
import type { PvpSession } from './session.js';
import { commitPvpSessionMutation } from './_session-mutation.js';
import { SESSION_TTL } from '../combat-core/constants.js';
import { PVP_PREFIGHT_COUNTDOWN_MS, pvpTurnDeadlineAt } from '../../shared/pvp-turn.js';
import { pvpTurnDeadlineEnabled } from '../_release-flags.js';

/**
 * Server-authoritative PvP turn expiry.
 *
 * The browser's 45s countdown (`CombatRoundTimer`) used to be the ONLY thing
 * that ended an idle turn: when it hit zero the client self-reported a `wait`
 * with `auto: true`. A closed tab reported nothing, so the match froze until
 * the opponent manually reached `claim-afk-win` through the 90s fallback.
 *
 * Now every session read (poll / SSE tick) and every move by EITHER player
 * runs this check. If the active player has been silent for longer than
 * `PVP_TURN_MS + PVP_TURN_GRACE_MS` (shared/pvp-turn.ts) the server itself
 * applies the auto-wait — the same bookkeeping the client flag produced
 * (`consecAutoWait` streak, turn advance) — so `claim-afk-win` is reached
 * naturally through consecutive server auto-waits.
 *
 * **`turnStartedAt` is "your last action", not "your turn began".** A turn is
 * worth 100 AP and up to `MAX_ACTIONS` actions, so `commit()` in move.ts
 * re-stamps it alongside `lastMoveAt` on every REAL action (a `wait` does not).
 * The deadline exists ONLY to stop a closed or abandoned tab from freezing a
 * match: a player who is present and acting must never be timed out, which is
 * exactly what the 90s AFK path it replaced guaranteed. An idle turn still
 * lapses on schedule, because nothing re-stamps it.
 *
 * The browser's ring is anchored to this same stamp and hits zero at
 * `PVP_TURN_MS` — a full grace window earlier than this check — so in the
 * common case a present player's own `auto: true` wait always lands first.
 *
 * Idempotent: the mutation is a CAS against the exact row it was derived from
 * and runs under the per-session move lock, so concurrent polls can only apply
 * one auto-wait per lapsed turn (the new turn's clock starts at commit time).
 *
 * Pre-deploy rows carry no `turnStartedAt`; the first check STAMPS it rather
 * than lapsing a turn whose start the server never recorded.
 */

type Store = Pick<KvLike, 'get' | 'set' | 'compareSet' | 'delIfEqual'>;

export type PvpTurnDeadlineResult = {
    session: PvpSession;
    /** 'auto-wait' when a lapsed turn was passed; 'stamped' when a legacy row got its clock. */
    applied: 'none' | 'stamped' | 'auto-wait';
};

/** True when the session is in a state whose turn clock the server enforces. */
export function pvpTurnClockRunning(session: PvpSession): boolean {
    return pvpTurnDeadlineEnabled()
        && session.status === 'active'
        && !session.rankedCloseFence
        && session.joined?.p1 === true
        && session.joined?.p2 === true;
}

/** Has the ACTIVE player been silent (no real action) past the shared deadline? */
export function pvpTurnLapsed(session: PvpSession, now = Date.now()): boolean {
    if (!pvpTurnClockRunning(session)) return false;
    const startedAt = Number(session.turnStartedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return now >= pvpTurnDeadlineAt(startedAt);
}

/** Cheap pre-check so readers skip the lock when there is nothing to do. */
export function pvpTurnDeadlineNeedsWork(session: PvpSession, now = Date.now()): boolean {
    if (!pvpTurnClockRunning(session)) return false;
    if (session.turnStartedAt === undefined) return true;
    return pvpTurnLapsed(session, now);
}

/**
 * Apply the deadline to a session the caller has ALREADY locked (move.ts
 * holds `pvp:<id>:lock` while calling this). Commits at most one mutation.
 */
export async function enforcePvpTurnDeadlineLocked(
    store: Store,
    key: string,
    session: PvpSession,
    now = Date.now(),
    options: {
        /**
         * Stamp a legacy row's missing clock (default). move.ts passes false so
         * the move path never adds a CAS of its own before the action's commit —
         * a legacy row gets its clock from the next poll / SSE tick, or from the
         * very next endTurn, whichever comes first.
         */
        stampLegacy?: boolean;
    } = {},
): Promise<PvpTurnDeadlineResult> {
    if (!pvpTurnDeadlineNeedsWork(session, now)) return { session, applied: 'none' };

    if (session.turnStartedAt === undefined) {
        if (options.stampLegacy === false) return { session, applied: 'none' };
        // Legacy in-flight row: start the clock now (plus the pre-fight
        // countdown, in case this is the opening turn) instead of judging a
        // turn whose start was never recorded.
        const stamped: PvpSession = { ...session, turnStartedAt: now + PVP_PREFIGHT_COUNTDOWN_MS };
        const write = await commitPvpSessionMutation(store, key, session, stamped, { ttlSeconds: SESSION_TTL });
        if (write.status !== 'committed') return { session: currentOr(write.session, session), applied: 'none' };
        return { session: write.session, applied: 'stamped' };
    }

    // Lazy import: session.ts imports this module and move.ts imports
    // session.ts (types) plus most of the combat stack, so a static import
    // here would create a module cycle during server boot.
    const { applyPvpServerAutoWait } = await import('./move.js');
    const advanced = applyPvpServerAutoWait(session);
    const write = await commitPvpSessionMutation(store, key, session, advanced, { ttlSeconds: SESSION_TTL });
    if (write.status !== 'committed') return { session: currentOr(write.session, session), applied: 'none' };
    if (write.session.status === 'done') {
        // An auto-wait can terminalize (MAX_ROUNDS / a DoT finishing a fighter).
        // Run the same durable terminal replay move.ts runs after its own CAS.
        const { replayCommittedPvpTerminalEffects } = await import('./_committed-terminal-effects.js');
        await replayCommittedPvpTerminalEffects(write.session);
    }
    return { session: write.session, applied: 'auto-wait' };
}

/**
 * Reader-side entry point (session GET, SSE tick): takes the per-session move
 * lock, re-reads the freshest row, and applies the deadline. If the lock is
 * contended (a move or another reader is already applying it) the caller's
 * snapshot is returned unchanged — the next read will observe the result.
 */
export async function enforcePvpTurnDeadline(
    store: Store,
    battleId: string,
    session: PvpSession,
    now = Date.now(),
): Promise<PvpTurnDeadlineResult> {
    if (!pvpTurnDeadlineNeedsWork(session, now)) return { session, applied: 'none' };
    const key = `pvp:${battleId}`;
    const lockKey = `${key}:lock`;
    const lockToken = `deadline:${now}:${Math.random().toString(36).slice(2)}`;
    const locked = await store.set(lockKey, lockToken, { nx: true, ex: 3 } as never);
    if (!locked) return { session, applied: 'none' };
    try {
        const fresh = await store.get<unknown>(key);
        if (!fresh || typeof fresh !== 'object' || (fresh as Partial<PvpSession>).battleId !== battleId) {
            return { session, applied: 'none' };
        }
        const live = fresh as PvpSession;
        if (live.status !== 'active' || !live.p1 || !live.p2) return { session, applied: 'none' };
        return await enforcePvpTurnDeadlineLocked(store, key, live, now);
    } finally {
        await store.delIfEqual(lockKey, lockToken).catch(() => undefined);
    }
}

function currentOr(candidate: unknown, fallback: PvpSession): PvpSession {
    return candidate && typeof candidate === 'object' && (candidate as Partial<PvpSession>).battleId === fallback.battleId
        ? candidate as PvpSession
        : fallback;
}
