import { createHash } from 'node:crypto';
import { withKvLock, type LockOptions } from '../_lock.js';
import { applySoloPveAction } from './_engine.js';
import {
    SOLO_PVE_MOVE_TOKEN_HISTORY,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    type SoloPveSession,
} from './_session.js';
import { compareWriteSoloPveSession, readSoloPveSession, soloPveSessionKey } from './_store.js';
import { recordSoloPveLifecycle, type SoloPveTelemetryDeps } from './_telemetry.js';

/*
 * Authorized terminal transition for an ACTIVE Solo-PvE session that its owner
 * is walking out on.
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
 * The move token is DETERMINISTIC per (session, version), so a duplicate or
 * concurrent request collapses onto the same transition instead of racing it.
 */

export type AbandonSoloPveDeps = {
    read?: (sessionId: string) => Promise<SoloPveSession | null>;
    compareWrite?: (expected: SoloPveSession, next: SoloPveSession) => Promise<boolean>;
    lock?: <T>(target: string, fn: () => Promise<T>, options?: LockOptions) => Promise<T>;
    now?: () => number;
    telemetry?: SoloPveTelemetryDeps;
};

export type AbandonSoloPveResult =
    | { ok: true; session: SoloPveSession; transitioned: boolean }
    | { ok: false; status: number; error: string; retryable?: boolean };

export function abandonMoveToken(session: Pick<SoloPveSession, 'sessionId' | 'version'>): string {
    const digest = createHash('sha256').update(session.sessionId).digest('hex').slice(0, 24);
    return `abandon-v${Math.max(1, Math.floor(session.version))}-${digest}`;
}

/** The same terminal-evidence shape `executeSoloPveAction` seals on a done edge. */
export function finalizeAbandonedSession(
    session: SoloPveSession,
    resolved: SoloPveSession,
    moveToken: string,
    actionAt: number,
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

        const moveToken = abandonMoveToken(session);
        // No escape roll is consulted by `abandon`; the option only exists so a
        // flee can never be resolved here by accident.
        const resolved = applySoloPveAction(session, { type: 'abandon' }, { escapeSucceeds: () => false });
        if (!resolved.applied || resolved.session.status !== 'done') {
            return { ok: false as const, status: 409, error: 'The encounter could not be abandoned.' };
        }
        const next = finalizeAbandonedSession(session, resolved.session, moveToken, now());
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
