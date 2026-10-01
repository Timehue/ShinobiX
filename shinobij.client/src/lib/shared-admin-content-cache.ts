/*
 * Device cache for the shared admin content pulled at login.
 *
 * Every client pulls the two admin slots (Admin 1 / Admin 2) for the shared
 * jutsu, items, AIs, events, cards and pet kits (App.tsx pullSharedAdminContent).
 * Ordinary player saves no longer carry their own frozen copy of that content
 * (api/save/_slim-player-save.ts), so a failed pull must not leave the session
 * empty: the last good copy of each slot is kept on this device and used when a
 * live read fails. A live read always wins, and each slot falls back on its own.
 *
 * IndexedDB, not localStorage: the two slots are ~1 MB together, too large to
 * sit safely beside everything else in the 5 MB localStorage quota. Every
 * storage call is best-effort and time-boxed — no IndexedDB (private mode, old
 * WebView, a test runner) simply means no cache, which is exactly today's
 * behaviour.
 */

export const ADMIN_SLOT_NAMES = ['Admin 1', 'Admin 2'] as const;

const DB_NAME = 'shinobi-shared-content';
const STORE = 'snapshots';
const KEY = 'admin-slots-v1';
const STORAGE_TIMEOUT_MS = 2_000;

type CachedSlots<T> = Partial<Record<(typeof ADMIN_SLOT_NAMES)[number], T>>;

export type AdminSnapshotCache<T> = {
    read: () => Promise<CachedSlots<T> | null>;
    write: (slots: CachedSlots<T>) => Promise<void>;
};

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), STORAGE_TIMEOUT_MS))]);
}

function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return withTimeout(new Promise<IDBDatabase | null>((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    }), null);
}

function indexedDbCache<T>(): AdminSnapshotCache<T> {
    return {
        async read() {
            const db = await openDb();
            if (!db) return null;
            return withTimeout(new Promise<CachedSlots<T> | null>((resolve) => {
                try {
                    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
                    request.onsuccess = () => resolve((request.result as CachedSlots<T> | undefined) ?? null);
                    request.onerror = () => resolve(null);
                } catch {
                    resolve(null);
                }
            }), null);
        },
        async write(slots) {
            const db = await openDb();
            if (!db) return;
            await withTimeout(new Promise<void>((resolve) => {
                try {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(slots, KEY);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                    tx.onabort = () => resolve();
                } catch {
                    resolve();
                }
            }), undefined);
        },
    };
}

/**
 * Pull both admin slots live; for any slot whose live read failed, use this
 * device's last good copy. Successful live reads refresh the cache in the
 * background. Returns one entry per slot (null when neither source has it), in
 * the same shape the old `Promise.all` returned.
 */
export async function pullAdminSnapshotsWithDeviceCache<T>(
    fetchSlot: (slotName: string) => Promise<T | null>,
    cache: AdminSnapshotCache<T> = indexedDbCache<T>(),
): Promise<(T | null)[]> {
    const live = await Promise.all(ADMIN_SLOT_NAMES.map((slot) => fetchSlot(slot)));
    const fresh: CachedSlots<T> = {};
    ADMIN_SLOT_NAMES.forEach((slot, index) => { if (live[index]) fresh[slot] = live[index] as T; });
    // The common path: both live reads succeeded. Never make login wait on the
    // device store — refresh it in the background and return.
    if (ADMIN_SLOT_NAMES.every((_, index) => live[index])) {
        void cache.write(fresh).catch(() => undefined);
        return live;
    }
    const cached = await cache.read().catch(() => null);
    if (Object.keys(fresh).length > 0) void cache.write({ ...(cached ?? {}), ...fresh }).catch(() => undefined);
    return ADMIN_SLOT_NAMES.map((slot, index) => live[index] ?? cached?.[slot] ?? null);
}
