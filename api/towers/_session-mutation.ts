import {
    LockContendedError,
    withKvLock,
    type LockOptions,
} from '../_lock.js';
import { sessionKey } from './_tower-store.js';

export const TOWER_SESSION_BUSY_ERROR_CODE = 'tower-session-busy';
export const TOWER_SESSION_BUSY_ERROR = 'Battle Tower state is busy. Retry this request.';
export const TOWER_SESSION_RETRY_AFTER_SECONDS = 1;

export type TowerSessionLock = <T>(
    target: string,
    fn: () => Promise<T>,
    options: LockOptions,
) => Promise<T>;

/**
 * The sole Tower-session read/modify/write lock contract. Tower turn state and
 * settlement evidence are authoritative, so contention must never fall through
 * to an unlocked callback.
 */
export async function withTowerSessionMutation<T>(
    runId: string,
    fn: () => Promise<T>,
    lock: TowerSessionLock = withKvLock,
): Promise<T> {
    return lock(sessionKey(runId), fn, { failClosed: true });
}

export function isTowerSessionContention(error: unknown): error is LockContendedError {
    return error instanceof LockContendedError;
}

export function towerSessionBusyErrorBody(): { error: string; errorCode: string; settled?: false } {
    return {
        error: TOWER_SESSION_BUSY_ERROR,
        errorCode: TOWER_SESSION_BUSY_ERROR_CODE,
    };
}
