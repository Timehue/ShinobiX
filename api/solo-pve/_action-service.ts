import { randomInt } from 'node:crypto';
import type { LockOptions } from '../_lock.js';
import { withKvLock } from '../_lock.js';
import { applySoloPveAction, type SoloPveEngineOptions } from './_engine.js';
import {
    SOLO_PVE_MOVE_TOKEN_HISTORY,
    SOLO_PVE_SESSION_TTL_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    type SoloPveAction,
    type SoloPveCombatEvent,
    type SoloPveRejectionEvent,
    type SoloPveSession,
} from './_session.js';
import {
    readSoloPveSession,
    soloPveSessionKey,
    writeSoloPveSession,
} from './_store.js';

export type SoloPveLock = <T>(
    target: string,
    fn: () => Promise<T>,
    options?: LockOptions,
) => Promise<T>;

export type SoloPveActionCommand = {
    sessionId: string;
    ownerSlug: string;
    expectedVersion: number;
    moveToken: string;
    action: SoloPveAction;
};

export type SoloPveActionServiceResult = {
    status: number;
    body: {
        applied?: boolean;
        duplicate?: boolean;
        reason?: string;
        error?: string;
        event?: SoloPveCombatEvent | SoloPveRejectionEvent;
        session?: SoloPveSession;
    };
};

export type SoloPveActionServiceDeps = {
    read?: (sessionId: string) => Promise<SoloPveSession | null>;
    write?: (session: SoloPveSession) => Promise<void>;
    lock?: SoloPveLock;
    now?: () => number;
    engineOptions?: SoloPveEngineOptions;
};

export function isValidSoloPveMoveToken(value: string): boolean {
    return /^[A-Za-z0-9_-]{8,96}$/.test(value);
}
export async function executeSoloPveAction(
    command: SoloPveActionCommand,
    deps: SoloPveActionServiceDeps = {},
): Promise<SoloPveActionServiceResult> {
    if (!command.sessionId || !command.ownerSlug) {
        return { status: 400, body: { error: 'Missing solo-PvE session identity.' } };
    }
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
        return { status: 400, body: { error: 'A positive expectedVersion is required.' } };
    }
    if (!isValidSoloPveMoveToken(command.moveToken)) {
        return { status: 400, body: { error: 'A valid moveToken is required.' } };
    }

    const read = deps.read ?? readSoloPveSession;
    const write = deps.write ?? writeSoloPveSession;
    const lock = deps.lock ?? withKvLock;
    const now = deps.now ?? Date.now;
    const engineOptions: SoloPveEngineOptions = deps.engineOptions ?? {
        escapeSucceeds: () => randomInt(2) === 0,
    };

    return lock(soloPveSessionKey(command.sessionId), async () => {
        const session = await read(command.sessionId);
        if (!session) return { status: 404, body: { error: 'Solo-PvE session not found.' } };
        if (session.ownerSlug.toLowerCase() !== command.ownerSlug.toLowerCase()) {
            return { status: 403, body: { error: 'This solo-PvE session belongs to another player.' } };
        }
        if (session.expiresAt <= now()) {
            return { status: 410, body: { error: 'Solo-PvE session expired.', session } };
        }
        if (session.recentMoveTokens.includes(command.moveToken)) {
            return { status: 200, body: { applied: false, duplicate: true, reason: 'duplicate-move-token', session } };
        }
        if (session.version !== command.expectedVersion) {
            return { status: 409, body: { error: 'Solo-PvE session version is stale.', reason: 'stale-version', session } };
        }

        const resolved = applySoloPveAction(session, command.action, engineOptions);
        if (!resolved.applied) {
            return { status: 200, body: { applied: false, reason: resolved.reason, event: resolved.event, session } };
        }

        const actionAt = now();
        const nextVersion = session.version + 1;
        const terminalEvidence = resolved.session.status === 'done' && resolved.session.winner && resolved.session.outcome
            ? {
                finishedAt: actionAt,
                finalMoveToken: command.moveToken,
                finalVersion: nextVersion,
                finalEventSeq: resolved.session.eventSeq,
                winner: resolved.session.winner,
                outcome: resolved.session.outcome,
                itemsUsed: { ...resolved.session.itemsUsed },
                settlementState: resolved.session.settlementState,
            }
            : resolved.session.terminalEvidence;
        const next: SoloPveSession = {
            ...resolved.session,
            version: nextVersion,
            recentMoveTokens: [...session.recentMoveTokens, command.moveToken].slice(-SOLO_PVE_MOVE_TOKEN_HISTORY),
            lastActionAt: actionAt,
            expiresAt: actionAt + (resolved.session.status === 'done' ? SOLO_PVE_TERMINAL_TTL_SECONDS : SOLO_PVE_SESSION_TTL_SECONDS) * 1000,
            ...(terminalEvidence ? { terminalEvidence } : {}),
        };
        await write(next);
        return { status: 200, body: { applied: true, event: resolved.event, session: next } };
    }, { failClosed: true, ttlSec: 10 });
}
