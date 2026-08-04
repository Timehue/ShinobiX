import { kv as realKv } from '../_storage.js';
import {
    SOLO_PVE_SESSION_TTL_SECONDS,
    isSoloPveSession,
    type SoloPveSession,
} from './_session.js';

export type SoloPveKv = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
};

export type SoloPveStoreDeps = { kv?: SoloPveKv };

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
    await (deps.kv ?? realKv).set(soloPveSessionKey(session.sessionId), session, {
        ex: SOLO_PVE_SESSION_TTL_SECONDS,
    });
}
