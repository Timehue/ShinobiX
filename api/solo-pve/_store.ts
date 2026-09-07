import { kv as realKv } from '../_storage.js';
import { isDeepStrictEqual } from 'node:util';
import {
    SOLO_PVE_LAPSED_RETENTION_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    isSoloPveSession,
    soloPveActiveTtlSeconds,
    type SoloPveSession,
} from './_session.js';
import { recordSoloPveLifecycle, type SoloPveTelemetryDeps } from './_telemetry.js';
import {
    noteBattleEnded,
    noteBattleStarted,
    publishBattleProjection,
    retireBattleProjection,
} from '../_realtime/battle-projection.js';

export type SoloPveKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
    del?(key: string): Promise<unknown>;
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
    const store = deps.kv ?? realKv;
    await store.set(soloPveSessionKey(session.sessionId), session, { ex: soloPveRowTtlSeconds(session) });
    // A version-1 active session is one that has just been created:
    // executeSoloPveAction bumps the version on every applied action, so no
    // later write can reach this branch. The nx gate inside the recorder makes
    // a retried first write collapse to a single count regardless.
    if (session.version === 1 && session.status === 'active') {
        void recordSoloPveLifecycle('combat.session_created', session, deps.telemetry);
        // F01/F08: the per-player projection every host writes at creation.
        // The heartbeat proves immunity from it, and the lapse sweep finds an
        // unattended fight by it. Same retention as the row it points at.
        await publishBattleProjection(store, session.ownerSlug, {
            kind: 'solo-pve',
            sessionId: session.sessionId,
            startedAt: session.createdAt,
            expiresAt: session.expiresAt,
        }, soloPveRowTtlSeconds(session));
        noteBattleStarted(session.ownerSlug);
    } else if (session.status === 'done') {
        await retireSoloPveProjection(store, session);
    }
}

/**
 * The ROW's storage lifetime, which is not the fight's gameplay expiry: an
 * active row is retained past `expiresAt` (F08) so a lapse is terminalized
 * with evidence instead of vanishing; a terminal row keeps the receipt window.
 */
export function soloPveRowTtlSeconds(session: Pick<SoloPveSession, 'status' | 'activeTtlSeconds'>): number {
    return session.status === 'done'
        ? SOLO_PVE_TERMINAL_TTL_SECONDS
        : soloPveActiveTtlSeconds(session) + SOLO_PVE_LAPSED_RETENTION_SECONDS;
}

/** A terminal write retires the owner's projection, but only if it still names this session. */
async function retireSoloPveProjection(store: SoloPveKv, session: SoloPveSession): Promise<void> {
    if (await retireBattleProjection(store, session.ownerSlug, session.sessionId)) noteBattleEnded(session.ownerSlug);
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
    const ttl = soloPveRowTtlSeconds(next);
    const key = soloPveSessionKey(next.sessionId);
    if (!store.compareSet) throw new Error('solo-pve-session-compare-set-unavailable');
    let committed: boolean;
    try {
        committed = await store.compareSet(key, expected, next, { ex: ttl }) === true;
    } catch (error) {
        const readback = await store.get<unknown>(key).catch(() => null);
        if (!isDeepStrictEqual(readback, next)) throw error;
        committed = true;
    }
    if (committed && next.status === 'done') await retireSoloPveProjection(store, next);
    return committed;
}
