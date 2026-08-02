/*
 * Deletion tombstones for admin-authored content.
 *
 * Authored content lives in TWO stores (save:admin1 / save:admin2) that every
 * reader merges. Removing an entry from one array therefore does not delete
 * anything: the merge unions the slots, so the other slot's copy resurrects it
 * and the admin sees the jutsu they just deleted come straight back.
 *
 * Items already solved this with a tombstone — an entry whose `name` is a
 * reserved marker means "this id is deleted", and the merge drops it. Jutsu
 * (and the other authored types) never got one. This is that marker, in a
 * place both the client and the server can import, so the two cannot drift the
 * way the duplicated item marker did.
 *
 * A tombstone carries an `updatedAt` like any other entry, so it competes on
 * recency: deleting then re-creating an id works, because the newer entry wins.
 */

export const ADMIN_DELETED_JUTSU_MARKER = '__ADMIN_DELETED_JUTSU__';

/** True when an authored-jutsu entry is a deletion marker rather than a jutsu. */
export function isDeletedJutsuEntry(entry: unknown): boolean {
    if (!entry || typeof entry !== 'object') return false;
    return (entry as { name?: unknown }).name === ADMIN_DELETED_JUTSU_MARKER;
}

/** The tombstone to store in place of a deleted authored jutsu. */
export function deletedJutsuEntry(id: string, now: number): { id: string; name: string; updatedAt: number } {
    return { id, name: ADMIN_DELETED_JUTSU_MARKER, updatedAt: now };
}
