/**
 * Share one in-flight promise for a keyed unit of work.
 *
 * Completed work is intentionally not cached here; callers keep their own
 * success cache. A rejection clears the entry so a later call can retry.
 */
export function runSingleFlight<Key, Value>(
    inFlight: Map<Key, Promise<Value>>,
    key: Key,
    work: () => Promise<Value>,
): Promise<Value> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = Promise.resolve()
        .then(work)
        .finally(() => {
            if (inFlight.get(key) === pending) inFlight.delete(key);
        });
    inFlight.set(key, pending);
    return pending;
}
