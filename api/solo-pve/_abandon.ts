import { createHash } from 'node:crypto';
import { withKvLock, type LockOptions } from '../_lock.js';
import { kv as realKv } from '../_storage.js';
import { applySoloPveAction } from './_engine.js';
import {
    SOLO_PVE_MOVE_TOKEN_HISTORY,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    isSoloPveSessionLapsed,
    type SoloPveSession,
} from './_session.js';
import { compareWriteSoloPveSession, readSoloPveSession, soloPveSessionKey } from './_store.js';
import { recordSoloPveLifecycle, type SoloPveTelemetryDeps } from './_telemetry.js';

/*
 * Authorized terminal transition for an ACTIVE Solo-PvE session that its owner
 * is walking out on — or has already walked out on (F08).
 *
 * Before this, /api/pve/fight-outcome read a still-`active` session, called it
 * a "forfeit" and wrote the LIVE HP onto the character. That stamped a physical
 * receipt while the owning store still held an active fight: the session could
 * keep being played afterwards, and its real terminal result then conflicted
 * with the receipt already written. The engine already owns an `abandon` action
 * (explicit forfeit, independent of AP and of the sealed flee roll, with the
 * same 10% max-HP cost as an escape attempt); this module applies THAT
 * transition, in the owning store, under the session lock, fenced on the exact
 * version it read — and only then does settlement read the terminal evidence.
 *
 * A LAPSED session (active, but past its gameplay expiry) is the same walk-out
 * observed late. It used to expire out of storage untouched, which made
 * "close the tab and wait half an hour" the one exit that cost nothing — no
 * abandon cost, no receipt, and the fight was gone before anyone could prove
 * it happened. The row is now retained past expiry (_store.ts) and the lapse
 * is terminalized with the SAME abandon rule, from the HP the player last
 * stood at, stamped at the moment it lapsed rather than the moment it was
 * noticed. That is the session's own evidence; nothing is invented — in
 * particular a lapse never becomes a knockout the player did not take.
 *
 * The move token is DETERMINISTIC per (session, version), so a duplicate or
 * concurrent request collapses onto the same transition instead of racing it.
 */

export type AbandonSoloPveDeps = {
    read?: (sessionId: string) => Promise<SoloPveSession | null>;
    compareWrite?: (expected: SoloPveSession, next: SoloPveSession) => Promise<boolean>;
    /** Deletes a lapsed row outright (the dive policy). Defaults to the real store. */
    remove?: (sessionId: string) => Promise<void>;
    lock?: <T>(target: string, fn: () => Promise<T>, options?: LockOptions) => Promise<T>;
    now?: () => number;
    telemetry?: SoloPveTelemetryDeps;
};

export type AbandonSoloPveResult =
    | { ok: true; session: SoloPveSession; transitioned: boolean }
    | { ok: false; status: number; error: string; retryable?: boolean };

export function abandonMoveToken(session: Pick<SoloPveSession, 'sessionId' | 'version'>, lapsed = false): string {
    const digest = createHash('sha256').update(session.sessionId).digest('hex').slice(0, 24);
    return `${lapsed ? 'lapsed' : 'abandon'}-v${Math.max(1, Math.floor(session.version))}-${digest}`;
}

/** The same terminal-evidence shape `executeSoloPveAction` seals on a done edge. */
export function finalizeAbandonedSession(
    session: SoloPveSession,
    resolved: SoloPveSession,
    moveToken: string,
    actionAt: number,
    lapsed = false,
): SoloPveSession {
    const nextVersion = session.version + 1;
    return {
        ...resolved,
        version: nextVersion,
        recentMoveTokens: [...session.recentMoveTokens, moveToken].slice(-SOLO_PVE_MOVE_TOKEN_HISTORY),
        lastActionAt: actionAt,
        expiresAt: actionAt + SOLO_PVE_TERMINAL_TTL_SECONDS * 1000,
        terminalEvidence: {
            finishedAt: actionAt,
            ...(lapsed ? { lapsedAt: actionAt } : {}),
            finalMoveToken: moveToken,
            finalVersion: nextVersion,
            finalEventSeq: resolved.eventSeq,
            winner: resolved.winner ?? 'enemy',
            outcome: resolved.outcome ?? 'loss',
            itemsUsed: { ...resolved.itemsUsed },
            ...(resolved.companionUsage ? { companionUsage: { ...resolved.companionUsage } } : {}),
            settlementState: resolved.settlementState,
        },
    };
}

function transitionAbandon(session: SoloPveSession, at: number, lapsed: boolean): SoloPveSession | null {
    const moveToken = abandonMoveToken(session, lapsed);
    // No escape roll is consulted by `abandon`; the option only exists so a
    // flee can never be resolved here by accident.
    const resolved = applySoloPveAction(session, { type: 'abandon' }, { escapeSucceeds: () => false });
    if (!resolved.applied || resolved.session.status !== 'done') return null;
    if (lapsed) {
        resolved.session.log.push('The encounter lapsed unattended and counts as abandoned.');
    }
    return finalizeAbandonedSession(session, resolved.session, moveToken, at, lapsed);
}

export async function abandonSoloPveSession(
    sessionId: string,
    ownerSlug: string,
    deps: AbandonSoloPveDeps = {},
): Promise<AbandonSoloPveResult> {
    const read = deps.read ?? readSoloPveSession;
    const compareWrite = deps.compareWrite ?? compareWriteSoloPveSession;
    const lock = deps.lock ?? withKvLock;
    const now = deps.now ?? Date.now;
    if (!sessionId || !ownerSlug) return { ok: false, status: 400, error: 'Missing solo-PvE session identity.' };

    return lock(soloPveSessionKey(sessionId), async () => {
        const session = await read(sessionId);
        if (!session) return { ok: false as const, status: 404, error: 'Solo-PvE session not found.' };
        if (session.ownerSlug.toLowerCase() !== ownerSlug.toLowerCase()) {
            return { ok: false as const, status: 403, error: 'This solo-PvE session belongs to another player.' };
        }
        // Already terminal — nothing to transition; the caller settles from it.
        if (session.status === 'done') return { ok: true as const, session, transitioned: false };

        // A session that already lapsed is abandoned AS OF its expiry, not as
        // of this late request: the same evidence the sweep would have used.
        const at = now();
        const lapsed = isSoloPveSessionLapsed(session, at);
        const next = transitionAbandon(session, lapsed ? session.expiresAt : at, lapsed);
        if (!next) return { ok: false as const, status: 409, error: 'The encounter could not be abandoned.' };
        const committed = await compareWrite(session, next);
        if (!committed) {
            // A move landed between our read and the write. The caller re-reads
            // and either settles the (now terminal) session or retries once.
            return { ok: false as const, status: 409, error: 'The encounter changed while it was being abandoned. Please retry.', retryable: true };
        }
        void recordSoloPveLifecycle('combat.session_completed', next, deps.telemetry);
        return { ok: true as const, session: next, transitioned: true };
    }, { failClosed: true, ttlSec: 10 });
}

export type LapsedSoloPveResult =
    | { ok: true; session: SoloPveSession | null; transitioned: boolean; voided?: boolean }
    | { ok: false; status: number; error: string; retryable?: boolean };

/**
 * A fight sealed by a Hollow Gate dive (its session id is the dive's combat
 * binding). The dive owns the consequence of a LOST fight — death, hospital,
 * the run wiped — and a lapse is not a loss, so a lapsed dive fight is voided
 * (the row deleted) rather than abandoned: exactly what expiry always did for
 * dives, and the dive's own recovery restarts the encounter.
 */
export function isHollowGateFightSession(session: Pick<SoloPveSession, 'sessionId' | 'encounter'>): boolean {
    return session.sessionId.startsWith('hgcombat-') || session.encounter?.kind === 'hollow-gate';
}

/**
 * Terminalize a session ONLY if it is active and past its gameplay expiry.
 * Anything else — terminal already, still live, gone from storage — is left
 * exactly as found. Owner-agnostic on purpose: the sweep and the heartbeat
 * reconcile on the store's behalf, never on a caller's claim.
 */
export async function terminalizeLapsedSoloPveSession(
    sessionId: string,
    deps: AbandonSoloPveDeps = {},
): Promise<LapsedSoloPveResult> {
    const read = deps.read ?? readSoloPveSession;
    const compareWrite = deps.compareWrite ?? compareWriteSoloPveSession;
    const lock = deps.lock ?? withKvLock;
    const now = deps.now ?? Date.now;
    if (!sessionId) return { ok: false, status: 400, error: 'Missing solo-PvE session identity.' };

    const remove = deps.remove ?? (async (id: string) => { await realKv.del(soloPveSessionKey(id)); });
    return lock(soloPveSessionKey(sessionId), async () => {
        const session = await read(sessionId);
        if (!session) return { ok: true as const, session: null, transitioned: false };
        if (!isSoloPveSessionLapsed(session, now())) return { ok: true as const, session, transitioned: false };
        if (isHollowGateFightSession(session)) {
            await remove(sessionId);
            return { ok: true as const, session: null, transitioned: true, voided: true };
        }
        const next = transitionAbandon(session, session.expiresAt, true);
        if (!next) return { ok: false as const, status: 409, error: 'The lapsed encounter could not be terminalized.' };
        const committed = await compareWrite(session, next);
        if (!committed) {
            return { ok: false as const, status: 409, error: 'The encounter changed while its lapse was being recorded.', retryable: true };
        }
        void recordSoloPveLifecycle('combat.session_completed', next, deps.telemetry);
        return { ok: true as const, session: next, transitioned: true };
    }, { failClosed: true, ttlSec: 10 });
}
