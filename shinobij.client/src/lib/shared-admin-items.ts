/*
 * Shared admin items, remembered for save refetches.
 *
 * A slimmed player save holds only the player's own items (forged gear, ids no
 * catalog knows). Login merges the admin items in afterwards, but a mid-session
 * refetch (a 409 conflict, a force reload) re-applies the save alone and would
 * otherwise drop every admin item definition from memory until the next login.
 * The last admin items applied this page are kept here so a refetch can re-merge
 * them. Module-level on purpose: shared content is global, never per account.
 *
 * Kept apart from the IndexedDB device cache (shared-admin-content-cache.ts) so
 * the boot bundle carries only these few lines; the cache is loaded on demand.
 */
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

type CacheModule = typeof import('./shared-admin-content-cache');
type SlotFetch<T> = (slotName: string) => Promise<T | null>;
let cacheModule: Promise<CacheModule | null> | null = null;
// A failed chunk import is cached for the rest of the page, so null means "no
// device cache this page" — never an unhandled rejection.
const loadCacheModule = () => (cacheModule ??= import('./shared-admin-content-cache').catch(() => null));

/**
 * Pull the shared admin slots. The live reads start at once and, when both
 * answer, are returned at once — exactly as fast as before the device cache
 * existed (a story beat or shop that opens right after login must see the live
 * admin content, not wait on a chunk). The device cache, loaded on demand, then
 * stores them in the background; it is awaited only when a live read failed and
 * its last good copy is needed. The live answers already in hand are handed to
 * it, so nothing is fetched twice; its own later retry still fetches fresh.
 */
export async function pullSharedAdminSnapshots<T>(fetchSlot: SlotFetch<T>): Promise<T[]> {
    const slots = ['Admin 1', 'Admin 2'];
    const live: (T | null)[] = await Promise.all(slots.map((slot) => fetchSlot(slot).catch(() => null)));
    const answered = new Map(slots.map((slot, index) => [slot, live[index]]));
    const reuseOnce: SlotFetch<T> = (slot) => {
        if (!answered.has(slot)) return fetchSlot(slot);
        const value = answered.get(slot) ?? null;
        answered.delete(slot);
        return Promise.resolve(value);
    };
    const present = live.filter((snap): snap is T => Boolean(snap));
    if (present.length === slots.length) {
        void loadCacheModule().then((cache) => cache?.pullAdminSnapshotsWithDeviceCache(reuseOnce)).catch(() => undefined);
        return present;
    }
    const cache = await loadCacheModule();
    return cache ? cache.pullAdminSnapshotsWithDeviceCache(reuseOnce) : present;
}

/** Test hook. */
export function __resetSharedAdminItems(): void {
    sharedAdminItems = new Map();
}
