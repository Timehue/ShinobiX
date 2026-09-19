/**
 * In-process "this key was just written" notifications.
 *
 * The storage backends (api/_storage.ts) call signalKeyWritten after a write
 * commits. A reader that would otherwise poll a hot key subscribes to that exact
 * key and wakes on the write instead — api/pvp/stream.ts used to re-read its
 * session every 100 ms per open stream, about 20 database reads a second for a
 * quiet 1v1.
 *
 * Best-effort and process-local: a write from another process (a deploy
 * overlap) is not signalled, so subscribers keep a slow safety poll. While
 * nothing is subscribed a write costs one Map size check.
 */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function onKeyWritten(key: string, listener: Listener): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        const current = listeners.get(key);
        if (!current) return;
        current.delete(listener);
        if (!current.size) listeners.delete(key);
    };
}

export function signalKeyWritten(...keys: string[]): void {
    if (!listeners.size) return;
    for (const key of keys) {
        const set = listeners.get(key);
        if (!set) continue;
        for (const listener of [...set]) {
            try {
                listener();
            } catch (error) {
                console.error('[kv-write-signal] listener failed:', (error as Error)?.message ?? error);
            }
        }
    }
}

/** Test-only: number of keys with live subscribers. */
export function __kvWriteSignalKeysForTest(): number {
    return listeners.size;
}
