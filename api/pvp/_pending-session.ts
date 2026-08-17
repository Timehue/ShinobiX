import type { KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import type { PvpSession } from './session.js';

type PendingSessionStore = Pick<KvLike, 'get' | 'compareSet' | 'delIfEqual'>;

export const PVP_PENDING_SESSION_TTL_SECONDS = 48 * 60 * 60;
export const PVP_PENDING_PUBLICATION_LEASE_MS = 30_000;

export type PvpPendingSessionPointer = {
    version: 1;
    playerName: string;
    battleId: string;
    role: 'p1' | 'p2';
    createdAt: number;
    /** Stable create intent bound before the session row becomes visible. */
    createRequestFingerprint?: string;
    phase: 'reserving' | 'active';
    reservedUntil?: number;
    /** Immutable terminal deadline; its body transition proves TTL refresh. */
    recoveryExpiresAt?: number;
};

export type PvpPendingSessionReservation = {
    pointer: PvpPendingSessionPointer;
    created: boolean;
};

export function pvpPendingSessionKey(playerName: string): string {
    return `pvp:pending-session:${safeName(playerName)}`;
}

function canonicalPointer(pointer: PvpPendingSessionPointer): string {
    return JSON.stringify(pointer);
}

function parsePointer(raw: unknown, expectedPlayer?: string): PvpPendingSessionPointer | null {
    if (raw === null) return null;
    if (typeof raw !== 'string') throw new Error('pvp-pending-session-pointer-invalid');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('pvp-pending-session-pointer-invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('pvp-pending-session-pointer-invalid');
    }
    const pointer = parsed as Partial<PvpPendingSessionPointer>;
    const playerName = safeName(String(pointer.playerName ?? ''));
    if (pointer.version !== 1
        || !playerName
        || (expectedPlayer !== undefined && playerName !== safeName(expectedPlayer))
        || typeof pointer.battleId !== 'string'
        || !pointer.battleId.trim()
        || (pointer.role !== 'p1' && pointer.role !== 'p2')
        || !Number.isSafeInteger(pointer.createdAt)
        || Number(pointer.createdAt) <= 0
        || (pointer.createRequestFingerprint !== undefined
            && (typeof pointer.createRequestFingerprint !== 'string'
                || !/^[0-9a-f]{64}$/.test(pointer.createRequestFingerprint)))
        || (pointer.phase !== 'reserving' && pointer.phase !== 'active')
        || (pointer.phase === 'reserving'
            && (!Number.isSafeInteger(pointer.reservedUntil) || Number(pointer.reservedUntil) <= 0))
        || (pointer.phase === 'active' && pointer.reservedUntil !== undefined)
        || (pointer.recoveryExpiresAt !== undefined
            && (!Number.isSafeInteger(pointer.recoveryExpiresAt)
                || Number(pointer.recoveryExpiresAt) <= Number(pointer.createdAt)))
        || (pointer.phase === 'reserving' && pointer.recoveryExpiresAt !== undefined)) {
        throw new Error('pvp-pending-session-pointer-invalid');
    }
    return {
        version: 1,
        playerName,
        battleId: pointer.battleId.trim(),
        role: pointer.role,
        createdAt: Number(pointer.createdAt),
        ...(pointer.createRequestFingerprint !== undefined
            ? { createRequestFingerprint: pointer.createRequestFingerprint }
            : {}),
        phase: pointer.phase,
        ...(pointer.phase === 'reserving' ? { reservedUntil: Number(pointer.reservedUntil) } : {}),
        ...(pointer.recoveryExpiresAt !== undefined
            ? { recoveryExpiresAt: Number(pointer.recoveryExpiresAt) }
            : {}),
    };
}

export function pvpTerminalRecoveryExpiresAt(
    session: Pick<PvpSession, 'status' | 'endedAt'>,
): number | null {
    if (session.status !== 'done') return null;
    const endedAt = Number(session.endedAt);
    if (!Number.isSafeInteger(endedAt) || endedAt <= 0) {
        throw new Error('pvp-terminal-recovery-deadline-invalid');
    }
    const expiresAt = endedAt + PVP_PENDING_SESSION_TTL_SECONDS * 1000;
    if (!Number.isSafeInteger(expiresAt)) throw new Error('pvp-terminal-recovery-deadline-invalid');
    return expiresAt;
}

export function pvpRecoveryRemainingTtlSeconds(expiresAt: number, now = Date.now()): number {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        throw new Error('pvp-terminal-recovery-deadline-expired');
    }
    return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

function pointerTtlSeconds(pointer: PvpPendingSessionPointer, now: number): number {
    return pointer.recoveryExpiresAt === undefined
        ? PVP_PENDING_SESSION_TTL_SECONDS
        : pvpRecoveryRemainingTtlSeconds(pointer.recoveryExpiresAt, now);
}

export function pendingPointersForSession(
    session: PvpSession,
    phase: 'reserving' | 'active' = 'active',
    now = Date.now(),
): PvpPendingSessionPointer[] {
    if (session.rewardAuthority === 'admin') return [];
    const out: PvpPendingSessionPointer[] = [];
    const recoveryExpiresAt = pvpTerminalRecoveryExpiresAt(session);
    for (const role of ['p1', 'p2'] as const) {
        if (session.realFighters?.[role] !== true || session.joined?.[role] !== true) continue;
        const playerName = safeName(session[role].name);
        if (!playerName) continue;
        out.push({
            version: 1,
            playerName,
            battleId: session.battleId,
            role,
            createdAt: session.createdAt,
            ...(session.createRequestFingerprint
                ? { createRequestFingerprint: session.createRequestFingerprint }
                : {}),
            phase,
            ...(phase === 'reserving'
                ? { reservedUntil: now + PVP_PENDING_PUBLICATION_LEASE_MS }
                : {}),
            ...(phase === 'active' && recoveryExpiresAt !== null ? { recoveryExpiresAt } : {}),
        });
    }
    return out;
}

/**
 * Publish or refresh one real player's recovery pointer. A stale session may
 * never replace a later battle, while a retry of the same canonical pointer
 * refreshes its 48-hour recovery horizon.
 */
export async function publishPvpPendingSessionPointer(
    store: PendingSessionStore,
    desired: PvpPendingSessionPointer,
    now = Date.now(),
): Promise<PvpPendingSessionReservation> {
    const normalized = parsePointer(canonicalPointer(desired), desired.playerName)!;
    const key = pvpPendingSessionKey(normalized.playerName);
    const desiredRaw = canonicalPointer(normalized);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const currentRaw = await store.get<unknown>(key);
        const current = parsePointer(currentRaw, normalized.playerName);
        if (current && current.battleId !== normalized.battleId) {
            throw new Error(`pvp-pending-session-conflict:${current.battleId}`);
        }
        if (current) {
            if (current.role !== normalized.role) {
                throw new Error('pvp-pending-session-pointer-conflict');
            }
            if (current.createdAt !== normalized.createdAt) {
                throw new Error(`pvp-pending-session-conflict:${current.battleId}`);
            }
            if ((current.phase === 'reserving' || normalized.phase === 'reserving')
                && current.createRequestFingerprint !== normalized.createRequestFingerprint) {
                throw new Error(`pvp-pending-session-conflict:${current.battleId}`);
            }
            // A stable battle capability is the retry identity. An exact retry
            // may renew its still-unpublished lease, while preserving the
            // original creation clock/role. A different capability can never
            // extend or replace it.
            if (current.recoveryExpiresAt !== undefined
                && normalized.recoveryExpiresAt !== undefined
                && current.recoveryExpiresAt !== normalized.recoveryExpiresAt) {
                throw new Error('pvp-pending-session-recovery-deadline-conflict');
            }
            const refreshed = current.phase === 'reserving' && normalized.phase === 'reserving'
                ? { ...current, reservedUntil: Math.max(Number(current.reservedUntil), Number(normalized.reservedUntil)) }
                : current.phase === 'active'
                    && normalized.phase === 'active'
                    && current.recoveryExpiresAt === undefined
                    && normalized.recoveryExpiresAt !== undefined
                    ? { ...current, recoveryExpiresAt: normalized.recoveryExpiresAt }
                    : current;
            const refreshedRaw = canonicalPointer(refreshed);
            // Once the immutable terminal deadline is present, its earlier CAS
            // already proved the matching relative TTL. Rewriting identical JSON
            // would make a lost acknowledgement indistinguishable from no write.
            if (refreshedRaw === currentRaw) return { pointer: refreshed, created: false };
            try {
                if (await store.compareSet(
                    key,
                    currentRaw,
                    refreshedRaw,
                    { ex: pointerTtlSeconds(refreshed, now) },
                )) return { pointer: refreshed, created: false };
            } catch (error) {
                const recoveredRaw = await store.get<unknown>(key);
                if (recoveredRaw === refreshedRaw) return { pointer: refreshed, created: false };
                throw error;
            }
            continue;
        }
        const expected = currentRaw === null ? null : currentRaw;
        try {
            if (await store.compareSet(
                key,
                expected,
                desiredRaw,
                { ex: pointerTtlSeconds(normalized, now) },
            )) return { pointer: normalized, created: currentRaw === null };
        } catch (error) {
            const recoveredRaw = await store.get<unknown>(key).catch(() => null);
            if (recoveredRaw === desiredRaw) return { pointer: normalized, created: currentRaw === null };
            throw error;
        }
    }
    throw new Error('pvp-pending-session-pointer-busy');
}

export async function publishPvpPendingSessionPointers(
    store: PendingSessionStore,
    session: PvpSession,
): Promise<void> {
    for (const pointer of pendingPointersForSession(session)) {
        await publishPvpPendingSessionPointer(store, pointer);
        await activatePvpPendingSessionPointer(
            store,
            pointer.playerName,
            pointer.battleId,
            pointer.createdAt,
            pointer.createRequestFingerprint,
        );
    }
}

export function pendingPointerForSessionRole(
    session: PvpSession,
    role: 'p1' | 'p2',
    phase: 'reserving' | 'active' = 'active',
    now = Date.now(),
): PvpPendingSessionPointer | null {
    return pendingPointersForSession(session, phase, now).find((pointer) => pointer.role === role) ?? null;
}

export function pvpPendingReservationIsFresh(pointer: PvpPendingSessionPointer, now = Date.now()): boolean {
    return pointer.phase === 'reserving'
        && Number.isSafeInteger(pointer.reservedUntil)
        && Number(pointer.reservedUntil) > now;
}

/** Publication fence: the creator/joiner must still own this exact single-flight. */
export async function requirePvpPendingSessionOwnership(
    store: Pick<PendingSessionStore, 'get'>,
    expected: PvpPendingSessionPointer,
    now = Date.now(),
): Promise<PvpPendingSessionPointer> {
    const current = await loadPvpPendingSessionPointer(store, expected.playerName);
    if (!current
        || current.battleId !== expected.battleId
        || current.role !== expected.role
        || current.createdAt !== expected.createdAt
        || (current.phase === 'reserving' && !pvpPendingReservationIsFresh(current, now))) {
        throw new Error('pvp-pending-session-publication-ownership-lost');
    }
    return current;
}

export async function activatePvpPendingSessionPointer(
    store: PendingSessionStore,
    playerName: string,
    battleId: string,
    createdAt: number,
    createRequestFingerprint?: string,
): Promise<PvpPendingSessionPointer> {
    const normalized = safeName(playerName);
    const key = pvpPendingSessionKey(normalized);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const raw = await store.get<unknown>(key);
        const current = parsePointer(raw, normalized);
        if (!current
            || current.battleId !== battleId
            || current.createdAt !== createdAt
            || current.createRequestFingerprint !== createRequestFingerprint) {
            throw new Error('pvp-pending-session-activation-conflict');
        }
        if (current.phase === 'active') return current;
        const active: PvpPendingSessionPointer = {
            version: 1,
            playerName: current.playerName,
            battleId: current.battleId,
            role: current.role,
            createdAt: current.createdAt,
            ...(current.createRequestFingerprint
                ? { createRequestFingerprint: current.createRequestFingerprint }
                : {}),
            phase: 'active',
            ...(current.recoveryExpiresAt !== undefined
                ? { recoveryExpiresAt: current.recoveryExpiresAt }
                : {}),
        };
        const activeRaw = canonicalPointer(active);
        try {
            if (await store.compareSet(key, raw, activeRaw, {
                ex: pointerTtlSeconds(active, Date.now()),
            })) {
                return active;
            }
        } catch (error) {
            const recovered = await store.get<unknown>(key).catch(() => null);
            if (recovered === activeRaw) return active;
            throw error;
        }
    }
    throw new Error('pvp-pending-session-activation-busy');
}

export async function loadPvpPendingSessionPointer(
    store: Pick<PendingSessionStore, 'get'>,
    playerName: string,
): Promise<PvpPendingSessionPointer | null> {
    const normalized = safeName(playerName);
    if (!normalized) return null;
    return parsePointer(await store.get<unknown>(pvpPendingSessionKey(normalized)), normalized);
}

/** Exact delete: an old completion can never clear a newer battle pointer. */
export async function clearPvpPendingSessionPointer(
    store: Pick<PendingSessionStore, 'get' | 'delIfEqual'>,
    playerName: string,
    battleId: string,
    createdAt: number,
    role?: 'p1' | 'p2',
): Promise<boolean> {
    const normalized = safeName(playerName);
    const key = pvpPendingSessionKey(normalized);
    let matched = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const raw = await store.get<unknown>(key);
        const current = parsePointer(raw, normalized);
        if (!current) return matched;
        if (current.battleId !== battleId
            || current.createdAt !== createdAt
            || (role !== undefined && current.role !== role)
            || typeof raw !== 'string') return false;
        matched = true;
        try {
            if (await store.delIfEqual(key, raw)) return true;
        } catch (error) {
            let recovered: unknown;
            try {
                recovered = await store.get<unknown>(key);
            } catch {
                throw error;
            }
            const parsed = parsePointer(recovered, normalized);
            if (!parsed
                || parsed.battleId !== battleId
                || parsed.createdAt !== createdAt
                || (role !== undefined && parsed.role !== role)) return true;
            throw error;
        }
    }
    throw new Error('pvp-pending-session-clear-busy');
}

export function pendingPointerMatchesSession(
    pointer: PvpPendingSessionPointer,
    session: PvpSession,
): boolean {
    return pointer.battleId === session.battleId
        && pointer.createdAt === session.createdAt
        && pointer.createRequestFingerprint === session.createRequestFingerprint
        && session.realFighters?.[pointer.role] === true
        && safeName(session[pointer.role].name) === pointer.playerName;
}
