import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { PVP_TERMINAL_REPLAY_TTL, SESSION_TTL } from '../combat-core/constants.js';
import {
    makePlayerRankedSessionCloseFence,
    makePlayerRankedSessionCloseTombstone,
    playerRankedOrphanTombstoneMatchesAdmission,
    playerRankedSessionIsFencedForClose,
    PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
    type PlayerRankedAdmission,
    type PlayerRankedSessionCloseTombstone,
} from '../pet/_ranked-preparation.js';
import {
    isPlayerRankedV2Session,
    nextPvpStateRevision,
    PVP_MOVE_TOKEN_HISTORY,
    trimPvpLog,
    type PvpSession,
} from './session.js';

type SessionStore = Pick<KvLike, 'get' | 'compareSet'>;

export type PvpSessionMutationResult =
    | { status: 'committed'; session: PvpSession }
    | { status: 'conflict'; session: PvpSession | null };

export type PlayerRankedCloseFenceResult =
    | { status: 'terminal'; session: PvpSession }
    | { status: 'fenced'; value: PvpSession | PlayerRankedSessionCloseTombstone };

function persistedSession(expected: PvpSession, desired: PvpSession, moveToken?: string): PvpSession {
    const recentMoveTokens = moveToken
        ? [...(desired.recentMoveTokens ?? []), moveToken].slice(-PVP_MOVE_TOKEN_HISTORY)
        : desired.recentMoveTokens;
    const endedAt = desired.status === 'done'
        ? Number.isSafeInteger(desired.endedAt) && Number(desired.endedAt) > 0
            ? Number(desired.endedAt)
            : Number.isSafeInteger(expected.endedAt) && Number(expected.endedAt) > 0
                ? Number(expected.endedAt)
                : Date.now()
        : desired.endedAt;
    const candidate = {
        ...desired,
        // The expected row is the only revision authority. A caller cannot
        // pre-mint or reuse a revision in `desired`; only the exact CAS winner
        // publishes this successor value.
        stateRevision: nextPvpStateRevision(expected),
        log: trimPvpLog(desired.log),
        recentMoveTokens,
        endedAt,
    };
    // Remote KV rows are JSON. Canonicalize before the CAS so a committed row
    // whose acknowledgement is lost compares exactly with its readback (object
    // properties such as `recentMoveTokens: undefined` disappear in storage).
    // Returning this same canonical object also keeps every caller aligned with
    // the bytes that actually won authority.
    return JSON.parse(JSON.stringify(candidate)) as PvpSession;
}

function isDurablePlayerRankedTerminal(session: PvpSession): boolean {
    return session.status === 'done' && isPlayerRankedV2Session(session);
}

/**
 * Commit one move against the exact session bytes it was derived from.
 *
 * The move lease is intentionally not part of the correctness proof: if a
 * holder pauses past lease expiry, a successor can commit and the stale holder
 * loses this CAS. Player-ranked terminals are made non-expiring at this commit
 * boundary. Their journal/economic recovery later converts the exact owned row
 * back to the ordinary bounded replay TTL.
 */
export async function commitPvpSessionMutation(
    store: SessionStore,
    key: string,
    expected: PvpSession,
    desired: PvpSession,
    options: { moveToken?: string; ttlSeconds?: number } = {},
): Promise<PvpSessionMutationResult> {
    const next = persistedSession(expected, desired, options.moveToken);
    const requestedTtl = Math.max(1, Math.floor(options.ttlSeconds ?? SESSION_TTL));
    const ttlSeconds = next.status === 'done'
        ? Math.max(requestedTtl, PVP_TERMINAL_REPLAY_TTL)
        : requestedTtl;
    const durableTerminal = isDurablePlayerRankedTerminal(next);
    const casOptions = durableTerminal ? undefined : { ex: ttlSeconds };

    let acknowledged = false;
    try {
        acknowledged = await store.compareSet(key, expected, next, casOptions);
    } catch (error) {
        const recovered = await store.get<PvpSession>(key).catch(() => null);
        if (!isDeepStrictEqual(recovered, next)) throw error;
        if (!durableTerminal) {
            await boundExactPvpSession(store, key, next, ttlSeconds);
        }
        return { status: 'committed', session: next };
    }
    if (acknowledged) return { status: 'committed', session: next };

    // A remote CAS may commit but return a false/null acknowledgement. Exact
    // readback distinguishes that from a real stale-writer conflict.
    const current = await store.get<PvpSession>(key);
    if (isDeepStrictEqual(current, next)) {
        if (!durableTerminal) {
            await boundExactPvpSession(store, key, next, ttlSeconds);
        }
        return { status: 'committed', session: next };
    }
    return { status: 'conflict', session: current };
}

/** Refresh only the exact terminal row after all durable recovery work lands. */
export async function boundExactPvpSession(
    store: SessionStore,
    key: string,
    expected: PvpSession,
    ttlSeconds = SESSION_TTL,
): Promise<void> {
    const boundedTtl = Math.max(1, Math.floor(ttlSeconds));
    for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
            if (await store.compareSet(key, expected, expected, { ex: boundedTtl })) return;
        } catch (error) {
            const recovered = await store.get<PvpSession>(key).catch(() => null);
            if (!isDeepStrictEqual(recovered, expected)) throw error;
            // Exact readback proves the row, not its TTL. Retry until the CAS ack
            // proves bounded retention rather than guessing after a lost ack.
            continue;
        }
        const current = await store.get<PvpSession>(key);
        if (current === null) return;
        if (!isDeepStrictEqual(current, expected)) {
            throw new Error('pvp-session-compaction-conflict');
        }
    }
    throw new Error('pvp-session-compaction-unconfirmed');
}

/**
 * Linearize season close against the exact session row before cancelling its
 * gate admission. A terminal CAS that commits first is returned for recovery;
 * a close fence that commits first makes every upgraded stale move CAS lose.
 * Missing pre-publication sessions receive an exact-CAS tombstone so a paused
 * creator cannot publish after close.
 */
export async function fencePlayerRankedSessionForClose(
    store: SessionStore,
    admission: PlayerRankedAdmission,
    transitionId: string,
    now: number,
): Promise<PlayerRankedCloseFenceResult> {
    if (admission.phase !== 'active' || !admission.battleId || !transitionId) {
        throw new Error('player-ranked-close-admission-invalid');
    }
    const key = `pvp:${admission.battleId}`;
    const fence = makePlayerRankedSessionCloseFence(admission, transitionId, now);
    const tombstone = makePlayerRankedSessionCloseTombstone(admission, transitionId, now);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const raw = await store.get<unknown>(key);
        if (playerRankedSessionIsFencedForClose(raw, admission, transitionId)) {
            return { status: 'fenced', value: raw as PvpSession | PlayerRankedSessionCloseTombstone };
        }
        if (raw === null) {
            try {
                if (await store.compareSet(key, null, tombstone, {
                    ex: PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
                })) {
                    return { status: 'fenced', value: tombstone };
                }
            } catch (error) {
                const recovered = await store.get<unknown>(key).catch(() => null);
                if (isDeepStrictEqual(recovered, tombstone)) {
                    return { status: 'fenced', value: tombstone };
                }
                throw error;
            }
            continue;
        }
        if (playerRankedOrphanTombstoneMatchesAdmission(raw, admission)) {
            // Orphan cleanup already won the null->tombstone publication race.
            // Convert that exact capability into this season transition's
            // close tombstone so the normal cancellation proof can proceed.
            try {
                if (await store.compareSet(key, raw, tombstone, {
                    ex: PLAYER_RANKED_ORPHAN_TOMBSTONE_TTL_SECONDS,
                })) {
                    return { status: 'fenced', value: tombstone };
                }
            } catch (error) {
                const recovered = await store.get<unknown>(key).catch(() => null);
                if (isDeepStrictEqual(recovered, tombstone)) {
                    return { status: 'fenced', value: tombstone };
                }
                throw error;
            }
            continue;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('player-ranked-close-session-invalid');
        }
        const session = raw as PvpSession;
        const pair = [safeName(session.p1?.name ?? ''), safeName(session.p2?.name ?? '')].sort();
        if (!isPlayerRankedV2Session(session)
            || session.battleId !== admission.battleId
            || session.rankedMatchId !== admission.matchId
            || session.rankedSeasonId !== admission.seasonId
            || session.rankedSeasonEpoch !== admission.seasonEpoch
            || pair[0] !== admission.a
            || pair[1] !== admission.b) {
            throw new Error('player-ranked-close-session-conflict');
        }
        if (session.status === 'done') return { status: 'terminal', session };
        if (session.status !== 'active') throw new Error('player-ranked-close-session-invalid');
        const write = await commitPvpSessionMutation(
            store,
            key,
            session,
            { ...session, rankedCloseFence: fence },
            { ttlSeconds: SESSION_TTL },
        );
        if (write.status === 'committed') return { status: 'fenced', value: write.session };
    }
    throw new Error('player-ranked-close-session-busy');
}
