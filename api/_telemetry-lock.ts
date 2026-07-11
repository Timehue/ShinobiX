import { withKvLock } from './_lock.js';
import { kv } from './_storage.js';

// Tests and injected jobs can supply a non-global store. Serialize those within
// the process; production's shared KV uses the distributed lock so concurrent
// instances cannot lose read-modify-write telemetry updates.
const localTails = new Map<string, Promise<void>>();

async function withLocalLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = localTails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    localTails.set(key, current);
    if (previous) await previous;
    try {
        return await fn();
    } finally {
        release();
        if (localTails.get(key) === current) localTails.delete(key);
    }
}

export async function withTelemetryLock<T>(
    key: string,
    store: object,
    fn: () => Promise<T>,
): Promise<T> {
    if (store === kv) {
        return withKvLock(`telemetry:${key}`, fn, { failClosed: true });
    }
    return withLocalLock(key, fn);
}
