import { saveConflictAccountKey } from "./save-conflict";
import type { beginSessionLoad } from "./session-load-authority";

type RestoreScope = ReturnType<typeof beginSessionLoad>;
type NamedSnapshot = { character: { name: string } };

function scheduleRestoreTimeout(callback: () => void, delayMs: number): () => void {
    const timer = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(timer);
}

/** Load authoritative restore evidence under the existing session generation.
 * Credentials, optimistic painting, and snapshot application remain caller-owned.
 * A timeout retires the scope through onFailure; late continuations cannot paint.
 */
export function restoreAccountFromServer<Snapshot extends NamedSnapshot, Lock>({
    accountName,
    scope,
    pullSave,
    fetchBattleLock,
    resumeGuest,
    applySnapshot,
    onFailure,
    onTimeout,
    onSettled,
    onComplete,
    scheduleTimeout = scheduleRestoreTimeout,
}: {
    accountName: string;
    scope: RestoreScope;
    pullSave: (name: string) => Promise<Snapshot | null>;
    fetchBattleLock: (name: string) => Promise<Lock>;
    resumeGuest: () => Promise<string | null>;
    applySnapshot: (snapshot: Snapshot, lock: Lock) => void;
    onFailure: () => void;
    onTimeout: () => void;
    onSettled: () => void;
    onComplete: () => void;
    scheduleTimeout?: (callback: () => void, delayMs: number) => () => void;
}): Promise<void> {
    const cancelTimeout = scheduleTimeout(() => {
        if (!scope.isCurrent()) return;
        onFailure();
        onTimeout();
    }, 12000);

    return Promise.all([
        pullSave(accountName),
        fetchBattleLock(accountName),
    ]).then(async ([snapshot, lock]) => {
        if (!scope.isCurrent()) return;
        if (snapshot && saveConflictAccountKey(snapshot.character.name) === scope.accountKey) {
            applySnapshot(snapshot, lock);
            return;
        }
        const guestName = await resumeGuest();
        if (!scope.isCurrent()) return;
        if (guestName) {
            const retry = await pullSave(guestName);
            if (!scope.isCurrent()) return;
            if (retry && saveConflictAccountKey(retry.character.name) === scope.accountKey) {
                applySnapshot(retry, lock);
                return;
            }
        }
        onFailure();
    }).finally(() => {
        onSettled();
        cancelTimeout();
        if (!scope.isCurrent()) return;
        onComplete();
    });
}
