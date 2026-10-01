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

/**
 * Pull the shared admin slots through the device cache, loading that module on
 * demand. A failed chunk import is cached for the rest of the page, so on that
 * failure fall back to a plain live pull of both slots — today's behaviour
 * without the cache, never an unhandled rejection.
 */
export async function pullSharedAdminSnapshots<T>(fetchSlot: (slotName: string) => Promise<T | null>): Promise<T[]> {
    const cache = await import('./shared-admin-content-cache').catch(() => null);
    if (cache) return cache.pullAdminSnapshotsWithDeviceCache(fetchSlot);
    const live: (T | null)[] = await Promise.all(['Admin 1', 'Admin 2'].map((slot) => fetchSlot(slot).catch(() => null)));
    return live.filter((snap): snap is T => Boolean(snap));
}

/** Test hook. */
export function __resetSharedAdminItems(): void {
    sharedAdminItems = new Map();
}
