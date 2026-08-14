import { readSession, writeSession } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';
import {
    withTowerSessionMutation,
    type TowerSessionLock,
} from './_session-mutation.js';

export type TowerSettlementProjectionDeps = {
    read: (runId: string) => Promise<TowerSession | null>;
    write: (session: TowerSession) => Promise<void>;
    lock?: TowerSessionLock;
};

const defaultDeps: TowerSettlementProjectionDeps = {
    read: readSession,
    write: writeSession,
};

/**
 * Refresh terminal settlement evidence from a fresh session while holding the
 * same fail-closed lock as action/state mutations. `settled` is monotonic: a
 * slower retryable caller can refresh the record, but can never write its stale
 * pending snapshot over a settlement another caller already completed.
 */
export async function projectTowerSettlementState(
    runId: string,
    stable: boolean,
    deps: TowerSettlementProjectionDeps = defaultDeps,
): Promise<TowerSession | null> {
    return withTowerSessionMutation(runId, async () => {
        const fresh = await deps.read(runId);
        if (!fresh) return null;
        if (fresh.status !== 'done') return fresh;
        if (stable) fresh.rewardSettlementState = 'settled';
        await deps.write(fresh);
        return fresh;
    }, deps.lock);
}
