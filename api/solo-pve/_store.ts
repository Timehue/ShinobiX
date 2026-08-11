import { kv as realKv } from '../_storage.js';
import { isDeepStrictEqual } from 'node:util';
import {
    SOLO_PVE_SESSION_TTL_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    isSoloPveSession,
    type SoloPveSession,
} from './_session.js';

export type SoloPveKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
    compareSet(key: string, expected: unknown | null, value: unknown, opts?: { ex?: number }): Promise<boolean>;
};

export type SoloPveStoreDeps = { kv?: SoloPveKv };

export function soloPveSessionKey(sessionId: string): string {
    return `solo-pve:${sessionId}`;
}

function soloPveSessionTtl(session: SoloPveSession): number {
    const activeTtl = Math.max(
        SOLO_PVE_SESSION_TTL_SECONDS,
        Math.min(2 * 60 * 60, Math.floor(Number(session.activeTtlSeconds) || SOLO_PVE_SESSION_TTL_SECONDS)),
    );
    return session.status === 'done' ? SOLO_PVE_TERMINAL_TTL_SECONDS : activeTtl;
}
export async function readSoloPveSession(
    sessionId: string,
    deps: SoloPveStoreDeps = {},
): Promise<SoloPveSession | null> {
    const value = await (deps.kv ?? realKv).get<unknown>(soloPveSessionKey(sessionId));
    return isSoloPveSession(value) ? value : null;
}

export async function writeSoloPveSession(
    session: SoloPveSession,
    deps: SoloPveStoreDeps = {},
): Promise<void> {
    if (!isSoloPveSession(session)) throw new Error('Refusing to persist a non-solo-pve session.');
    const store = deps.kv ?? realKv;
    const key = soloPveSessionKey(session.sessionId);
    try {
        const acknowledged = await store.set(key, session, {
            ex: soloPveSessionTtl(session),
        });
        if (acknowledged === 'OK') return;
    } catch (error) {
        const readback = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(readback, session)) return;
        throw error;
    }
    const readback = await store.get<unknown>(key).catch(() => null);
    if (!isDeepStrictEqual(readback, session)) {
        throw new Error('solo-pve-session-write-unconfirmed');
    }
}

/**
 * Atomically replace the exact session predecessor. A fulfilled mismatch is a
 * definitive stale writer; only a thrown acknowledgement may recover from an
 * exact full-session readback.
 */
export async function compareWriteSoloPveSession(
    expected: SoloPveSession,
    next: SoloPveSession,
    deps: SoloPveStoreDeps = {},
): Promise<boolean> {
    if (!isSoloPveSession(expected) || !isSoloPveSession(next)) {
        throw new Error('Refusing to persist a non-solo-pve session.');
    }
    if (expected.sessionId !== next.sessionId || expected.runtime !== next.runtime) {
        throw new Error('Refusing to compare different solo-pve sessions.');
    }
    const store = deps.kv ?? realKv;
    const key = soloPveSessionKey(next.sessionId);
    try {
        return await store.compareSet(key, expected, next, { ex: soloPveSessionTtl(next) }) === true;
    } catch (error) {
        const readback = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(readback, next)) return true;
        throw error;
    }
}
