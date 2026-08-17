import { isDeepStrictEqual } from 'node:util';
import type { KvLike } from '../_storage.js';
import type { PvpSession } from './session.js';
import { pvpRewardCompletionStatus } from './_reward-completion.js';
import {
    activatePvpPendingSessionPointer,
    clearPvpPendingSessionPointer,
    pendingPointersForSession,
    pvpRecoveryRemainingTtlSeconds,
    pvpTerminalRecoveryExpiresAt,
    publishPvpPendingSessionPointer,
} from './_pending-session.js';

type RecoveryStore = Pick<KvLike, 'get' | 'compareSet'>;
type RecoveryPublicationStore = Pick<KvLike, 'get' | 'compareSet' | 'delIfEqual'>;

export const PVP_REWARD_RECOVERY_TTL_SECONDS = 48 * 60 * 60;

type PvpRewardRecoverySnapshot = {
    version: 2;
    battleId: string;
    expiresAt: number;
    session: PvpSession;
};

type LegacyPvpRewardRecoverySnapshot = {
    version: 1;
    battleId: string;
    session: PvpSession;
};

function recoveryKey(battleId: string): string {
    return `pvp:reward-recovery:${battleId}`;
}

function canonicalSession(session: PvpSession): PvpSession {
    return JSON.parse(JSON.stringify(session)) as PvpSession;
}

function exactSnapshot(value: unknown, expected: PvpRewardRecoverySnapshot): boolean {
    return !!value
        && typeof value === 'object'
        && !Array.isArray(value)
        && isDeepStrictEqual(value, expected);
}

function parseSnapshot(
    value: unknown,
    battleId: string,
): PvpRewardRecoverySnapshot | LegacyPvpRewardRecoverySnapshot | null {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('pvp-reward-recovery-snapshot-invalid');
    }
    const row = value as {
        version?: unknown;
        battleId?: unknown;
        expiresAt?: unknown;
        session?: Partial<PvpSession>;
    };
    if ((row.version !== 1 && row.version !== 2)
        || row.battleId !== battleId
        || !row.session
        || typeof row.session !== 'object'
        || row.session.battleId !== battleId) {
        throw new Error('pvp-reward-recovery-snapshot-invalid');
    }
    if (row.version === 2
        && (!Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) <= 0)) {
        throw new Error('pvp-reward-recovery-snapshot-invalid');
    }
    return row as PvpRewardRecoverySnapshot | LegacyPvpRewardRecoverySnapshot;
}

/**
 * Seal one immutable terminal session before any claim receipt or credit is
 * published. The snapshot matches the 48-hour claim/pointer horizon, so a
 * pending claim can help-forward after the active-turn row would have expired.
 */
export async function sealPvpRewardRecoverySnapshot(
    store: RecoveryStore,
    battleId: string,
    session: PvpSession,
): Promise<PvpSession> {
    if (session.battleId !== battleId) throw new Error('pvp-reward-recovery-battle-conflict');
    const expiresAt = pvpTerminalRecoveryExpiresAt(session);
    if (expiresAt === null) throw new Error('pvp-reward-recovery-terminal-required');
    const desired: PvpRewardRecoverySnapshot = {
        version: 2,
        battleId,
        expiresAt,
        session: canonicalSession(session),
    };
    const key = recoveryKey(battleId);
    const ttlSeconds = pvpRecoveryRemainingTtlSeconds(expiresAt);
    const initial = await store.get<unknown>(key);
    if (exactSnapshot(initial, desired)) return desired.session;
    const legacy = parseSnapshot(initial, battleId);
    if (legacy && legacy.version === 1 && !isDeepStrictEqual(legacy.session, desired.session)) {
        throw new Error('pvp-reward-recovery-snapshot-conflict');
    }
    try {
        if (await store.compareSet(
            key,
            initial,
            desired,
            { ex: ttlSeconds },
        )) return desired.session;
    } catch (error) {
        const recovered = await store.get<unknown>(key).catch(() => null);
        if (exactSnapshot(recovered, desired)) return desired.session;
        throw error;
    }
    const current = await store.get<unknown>(key);
    if (current === null) throw new Error('pvp-reward-recovery-snapshot-unconfirmed');
    if (!exactSnapshot(current, desired)) throw new Error('pvp-reward-recovery-snapshot-conflict');
    return desired.session;
}

export async function loadPvpRewardRecoverySnapshot(
    store: RecoveryStore,
    battleId: string,
): Promise<PvpSession | null> {
    return parseSnapshot(await store.get<unknown>(recoveryKey(battleId)), battleId)?.session ?? null;
}

/**
 * Required terminal publication barrier. The immutable snapshot and every
 * still-incomplete real fighter's discovery pointer must be durable before a
 * terminal read/move can report success. Completed actors are exact-cleared,
 * so another participant's retry cannot resurrect an acknowledged obligation.
 */
export async function ensurePvpTerminalRecoveryPublication(
    store: RecoveryPublicationStore,
    battleId: string,
    session: PvpSession,
): Promise<PvpSession> {
    const terminal = await sealPvpRewardRecoverySnapshot(store, battleId, session);
    for (const pointer of pendingPointersForSession(terminal)) {
        const completion = pvpRewardCompletionStatus(await store.get<unknown>(
            `pvp:rewarded:${pointer.playerName}:${battleId}`,
        ));
        if (completion === 'invalid') throw new Error('pvp-terminal-completion-receipt-invalid');
        if (completion === 'completed') {
            await clearPvpPendingSessionPointer(
                store,
                pointer.playerName,
                battleId,
                pointer.createdAt,
                pointer.role,
            );
            continue;
        }
        await publishPvpPendingSessionPointer(store, pointer);
        await activatePvpPendingSessionPointer(
            store,
            pointer.playerName,
            battleId,
            pointer.createdAt,
            pointer.createRequestFingerprint,
        );
    }
    return terminal;
}
