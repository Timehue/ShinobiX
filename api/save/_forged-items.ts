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
 * Re-attach server-forged items the incoming save omits.
 *
 * `creatorItems` is normally replaced wholesale by the client's copy, which is
 * fine for the admin-content mirror that makes up the rest of the array. It is
 * NOT fine for a forged named weapon/armor: that definition exists nowhere else
 * (no ITEM_CATALOG entry, not on the admin slots), so a POST from a client that
 * had not yet seen the forge silently erased it while its id stayed in
 * `character.equipment` — leaving gear that resolves to nothing and is dropped
 * from every fight. The `_baseSaveVersion` guard rejects most such writes; this
 * closes the rest.
 *
 * Deliberately narrow: only ids matching the server-minted pattern are revived,
 * and only when absent from the incoming array. Everything else keeps
 * replace-semantics, so an admin-deleted item still disappears normally and the
 * array cannot grow without bound.
 */
export function preserveForgedItems(sanitized: unknown, stored: unknown, cap: number): unknown {
    if (!Array.isArray(sanitized) || !Array.isArray(stored)) return sanitized;
    const present = new Set(
        (sanitized as Array<Record<string, unknown>>)
            .map((item) => (item && typeof item === 'object' ? String(item.id ?? '') : ''))
            .filter(Boolean),
    );
    const missingForged = (stored as Array<Record<string, unknown>>).filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const id = String(item.id ?? '');
        return FORGED_ITEM_ID.test(id) && !present.has(id);
    });
    if (missingForged.length === 0) return sanitized;
    // Forged pieces go first so the cap can never be what drops them.
    return [...missingForged, ...(sanitized as unknown[])].slice(0, cap);
}
