// Personal forged gear retains its server-minted identity across old and new UUID shapes.
export const FORGED_ITEM_ID = /^named-(weapon|armor)-[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Drop every server-forged item from a `creatorItems` array.
 *
 * Forged gear is PERSONAL: `api/craft/named.ts` mints it into one player's own
 * array and its definition belongs nowhere else. The `Admin 1` / `Admin 2`
 * accounts are ordinary player saves that double as the shared-content store, so
 * a client that still held a personal `creatorItems` state when it saved as an
 * admin published that forged item to every player — the client merges shared
 * admin content into its own array and persists it. Admin content and forged
 * gear must therefore never mix.
 */
export function stripForgedItems(list: unknown): unknown[] {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        return !FORGED_ITEM_ID.test(String((item as Record<string, unknown>).id ?? ''));
    });
}

/**
 * Preserve server-forged item definitions when reconciling a client save.
 *
 * `creatorItems` is normally replaced wholesale by the client's copy, which is
 * fine for the admin-content mirror that makes up the rest of the array. A
 * forged named weapon/armor exists nowhere else (no ITEM_CATALOG entry, not on
 * the admin slots), so save sanitization keeps the stored definition for any
 * existing forged ID. This prevents stale clients from erasing the item or
 * changing its combat bonuses under the same ID. The `_baseSaveVersion` guard
 * rejects most stale writes; this closes the rest.
 *
 * Deliberately narrow: only ids matching the server-minted pattern are retained
 * from stored state. Everything else keeps replace-semantics, so an admin-deleted
 * item still disappears normally and the array cannot grow without bound.
 */
export function preserveForgedItems(sanitized: unknown, stored: unknown, cap: number): unknown {
    if (!Array.isArray(sanitized) || !Array.isArray(stored)) return sanitized;
    const storedForged = new Map<string, Record<string, unknown>>();
    for (const item of stored as Array<Record<string, unknown>>) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id ?? '');
        if (FORGED_ITEM_ID.test(id)) storedForged.set(id, item);
    }
    const present = new Set<string>();
    const canonicalized = (sanitized as Array<Record<string, unknown>>).map((item) => {
        if (!item || typeof item !== 'object') return item;
        const id = String(item.id ?? '');
        if (!id) return item;
        present.add(id);
        // Existing named-item definitions are server-authoritative. Preserve
        // legitimate edits to unrelated creator content, while preventing a
        // stale or edited same-ID row from changing combat bonuses on save.
        return storedForged.get(id) ?? item;
    });
    const missingForged = [...storedForged.entries()]
        .filter(([id]) => !present.has(id))
        .map(([, item]) => item);
    if (missingForged.length === 0) return canonicalized;
    // Forged pieces go first so the cap can never be what drops them.
    return [...missingForged, ...canonicalized].slice(0, cap);
}
