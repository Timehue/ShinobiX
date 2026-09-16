import type { KvLike } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';

type Request = { resolve(value: unknown): void; reject(reason: unknown): void };

/** Display-only membership reads for one shared-frame build. Never use these
 * partial save records for a mutation. Only concurrent reads share a batch:
 * no result cache survives a batch, so subsequent validation reads stay fresh. */
export function createVillageMembershipReader(store: Pick<KvLike, 'get' | 'mget' | 'mgetProjected'>): Pick<KvLike, 'get'> {
    let pending = new Map<string, Request[]>();

    async function flush(): Promise<void> {
        const batch = pending;
        pending = new Map();
        const keys = [...batch.keys()];
        try {
            const rows = await readKvProjection(store, keys, { village: ['character', 'village'] });
            const values = await Promise.all(rows.map((row, index) => {
                if (!row) return null;
                if (Object.hasOwn(row, 'village')) return { character: { village: row.village } };
                // Preserve legacy/malformed-record semantics exactly (including
                // missing character/village) without transferring valid saves.
                return store.get(keys[index]);
            }));
            keys.forEach((key, index) => batch.get(key)!.forEach(request => request.resolve(values[index])));
        } catch (error) {
            for (const requests of batch.values()) for (const request of requests) request.reject(error);
        }
    }

    return {
        get<T = unknown>(key: string): Promise<T | null> {
            if (!key.startsWith('save:')) return store.get<T>(key);
            return new Promise<T | null>((resolve, reject) => {
                const first = pending.size === 0;
                const requests = pending.get(key) ?? [];
                requests.push({ resolve: value => resolve(value as T | null), reject });
                pending.set(key, requests);
                if (first) queueMicrotask(() => { void flush(); });
            });
        },
    };
}
