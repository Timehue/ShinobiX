import { kv as realKv } from '../_storage.js';
import { isDeepStrictEqual } from 'node:util';
import {
    SOLO_PVE_SESSION_TTL_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    isSoloPveSession,
    type SoloPveSession,
} from './_session.js';
import { recordSoloPveLifecycle, type SoloPveTelemetryDeps } from './_telemetry.js';

export type SoloPveKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
    compareSet?(
        key: string,
        expected: unknown | null,
        value: unknown,
        opts?: { ex?: number },
    ): Promise<boolean>;
};

export type SoloPveStoreDeps = { kv?: SoloPveKv; telemetry?: SoloPveTelemetryDeps };

export function soloPveSessionKey(sessionId: string): string {
    return `solo-pve:${sessionId}`;
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
    const activeTtl = Math.max(
        SOLO_PVE_SESSION_TTL_SECONDS,
        Math.min(2 * 60 * 60, Math.floor(Number(session.activeTtlSeconds) || SOLO_PVE_SESSION_TTL_SECONDS)),
    );
    await (deps.kv ?? realKv).set(soloPveSessionKey(session.sessionId), session, {
        ex: session.status === 'done' ? SOLO_PVE_TERMINAL_TTL_SECONDS : activeTtl,
    });
    // A version-1 active session is one that has just been created:
    // executeSoloPveAction bumps the version on every applied action, so no
    // later write can reach this branch. The nx gate inside the recorder makes
    // a retried first write collapse to a single count regardless.
    if (session.version === 1 && session.status === 'active') {
        void recordSoloPveLifecycle('combat.session_created', session, deps.telemetry);
    }
}

/** Replace only the exact predecessor so terminal settlement cannot clobber a
 * newer move. A lost compare-set acknowledgement is recovered by exact
 * readback, while a real stale writer remains rejected. */
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
    const activeTtl = Math.max(
        SOLO_PVE_SESSION_TTL_SECONDS,
        Math.min(2 * 60 * 60, Math.floor(Number(next.activeTtlSeconds) || SOLO_PVE_SESSION_TTL_SECONDS)),
    );
    const ttl = next.status === 'done' ? SOLO_PVE_TERMINAL_TTL_SECONDS : activeTtl;
    const key = soloPveSessionKey(next.sessionId);
    if (!store.compareSet) throw new Error('solo-pve-session-compare-set-unavailable');
    try {
        return await store.compareSet(key, expected, next, { ex: ttl }) === true;
    } catch (error) {
        const readback = await store.get<unknown>(key).catch(() => null);
        if (isDeepStrictEqual(readback, next)) return true;
        throw error;
    }
}
