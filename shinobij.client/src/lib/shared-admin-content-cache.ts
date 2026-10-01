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

// ── Shared admin items, remembered for save refetches ────────────────────────
// A slimmed player save holds only the player's own items (forged gear, ids no
// catalog knows). Login merges the admin items in afterwards, but a mid-session
// refetch (a 409 conflict, a force reload) re-applies the save alone and would
// otherwise drop every admin item definition from memory until the next login.
// The last admin items applied this page are kept here so a refetch can re-merge
// them. Module-level on purpose: shared content is global, never per account.
type WithId = { id: string };
let sharedAdminItems = new Map<string, WithId>();

/** Record admin items as they are applied (later slots win, like the merge). */
export function rememberSharedAdminItems(items: readonly WithId[]): void {
    const next = new Map(sharedAdminItems);
    for (const item of items) if (item && typeof item.id === 'string') next.set(item.id, item);
    sharedAdminItems = next;
}

/**
 * A save's own items plus the remembered admin items; an admin definition wins an
 * id collision, exactly as the login-time admin merge does.
 */
export function withSharedAdminItems<T extends WithId>(saveItems: readonly T[]): T[] {
    if (sharedAdminItems.size === 0) return [...saveItems];
    const merged = new Map<string, T>(saveItems.map((item) => [item.id, item]));
    for (const [id, item] of sharedAdminItems) merged.set(id, item as T);
    return [...merged.values()];
}

/** Test hook. */
export function __resetSharedAdminItems(): void {
    sharedAdminItems = new Map();
}

const DB_NAME = 'shinobi-shared-content';
const STORE = 'snapshots';
const KEY = 'admin-slots-v1';
const STORAGE_TIMEOUT_MS = 2_000;
/** One more live attempt when a pull found nothing at all (no live slot, no cache). */
export const EMPTY_PULL_RETRY_MS = 15_000;

/**
 * The only fields of an admin slot that clients apply as shared content
 * (App.tsx applySharedAdminContentSnapshot). The cache keeps these and nothing
 * else — never the admin character, its save stamps, or anything a later
 * reader could mistake for an account.
 */
export const SHARED_CONTENT_FIELDS = [
    'creatorJutsus', 'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids',
    'creatorCards', 'creatorItems', 'petEncounterVn', 'ancientChestVn',
    'hollowGateEventConfig', 'editablePets',
] as const;

function sharedContentOnly<T>(snapshot: T): T {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const source = snapshot as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of SHARED_CONTENT_FIELDS) if (field in source) out[field] = source[field];
    return out as T;
}

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

function closeQuietly(db: IDBDatabase): void {
    try { db.close(); } catch { /* already closed */ }
}

function indexedDbCache<T>(): AdminSnapshotCache<T> {
    return {
        async read() {
            const db = await openDb();
            if (!db) return null;
            try {
                return await withTimeout(new Promise<CachedSlots<T> | null>((resolve) => {
                    try {
                        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
                        request.onsuccess = () => resolve((request.result as CachedSlots<T> | undefined) ?? null);
                        request.onerror = () => resolve(null);
                    } catch {
                        resolve(null);
                    }
                }), null);
            } finally {
                // close() waits for in-flight transactions, so it is safe here.
                closeQuietly(db);
            }
        },
        async write(slots) {
            const db = await openDb();
            if (!db) return;
            try {
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
            } finally {
                closeQuietly(db);
            }
        },
    };
}

export type PullOptions = {
    /** Delay before the single extra live attempt when nothing was available. */
    emptyRetryMs?: number;
};

/**
 * Pull both admin slots live; for any slot whose live read failed, use this
 * device's last good copy. Successful live reads refresh the cache (shared
 * content fields only) in the background.
 *
 * Returns the available snapshots in APPLY order: device-cache fallbacks first,
 * live reads after them. Callers merge by id with later entries winning, so a
 * stale cached slot can never overwrite a definition that was just read live.
 *
 * When nothing is available at all — both live reads failed and this device has
 * no copy (first visit, private mode) — one more live attempt is made after
 * `emptyRetryMs`. Callers never await this on the login path.
 */
export async function pullAdminSnapshotsWithDeviceCache<T>(
    fetchSlot: (slotName: string) => Promise<T | null>,
    cache: AdminSnapshotCache<T> = indexedDbCache<T>(),
    options: PullOptions = {},
): Promise<T[]> {
    const pullBoth = async (): Promise<(T | null)[]> => Promise.all(ADMIN_SLOT_NAMES.map((slot) => fetchSlot(slot).catch(() => null)));
    const present = (snaps: (T | null)[]): T[] => snaps.filter((snap): snap is T => Boolean(snap));
    const live = await pullBoth();
    const fresh: CachedSlots<T> = {};
    ADMIN_SLOT_NAMES.forEach((slot, index) => { if (live[index]) fresh[slot] = sharedContentOnly(live[index] as T); });
    const liveSnapshots = present(live);
    // The common path: both live reads succeeded. Never make login wait on the
    // device store — refresh it in the background and return.
    if (liveSnapshots.length === ADMIN_SLOT_NAMES.length) {
        void cache.write(fresh).catch(() => undefined);
        return liveSnapshots;
    }
    const cached = await cache.read().catch(() => null);
    if (liveSnapshots.length > 0) void cache.write({ ...(cached ?? {}), ...fresh }).catch(() => undefined);
    const fallbacks = present(ADMIN_SLOT_NAMES
        .filter((_, index) => !live[index])
        .map((slot): T | null => cached?.[slot] ?? null));
    const available = [...fallbacks, ...liveSnapshots];
    if (available.length > 0) return available;
    const retryMs = options.emptyRetryMs ?? EMPTY_PULL_RETRY_MS;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    const retried = await pullBoth();
    const retriedSnapshots = present(retried);
    if (retriedSnapshots.length > 0) {
        const retriedFresh: CachedSlots<T> = {};
        ADMIN_SLOT_NAMES.forEach((slot, index) => { if (retried[index]) retriedFresh[slot] = sharedContentOnly(retried[index] as T); });
        void cache.write(retriedFresh).catch(() => undefined);
    }
    return retriedSnapshots;
}
