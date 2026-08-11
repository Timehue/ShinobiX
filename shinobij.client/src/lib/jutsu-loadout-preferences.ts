/**
 * Place a newly learned id without truncating a dormant supporter tail.
 * A full active loadout requires an explicit active slot to replace.
 */
export function placeNewJutsuPreservingDormant(
    equippedIds: readonly string[],
    jutsuId: string,
    activeCap: number,
    requestedSlot?: number,
): string[] | null {
    const cap = Math.max(0, Math.floor(activeCap));
    const ids = [...equippedIds];
    const activeCount = Math.min(ids.length, cap);

    if (activeCount < cap) {
        const insertAt = requestedSlot === undefined
            ? activeCount
            : Math.min(Math.max(0, Math.floor(requestedSlot)), activeCount);
        ids.splice(insertAt, 0, jutsuId);
        return ids;
    }

    if (requestedSlot === undefined || requestedSlot < 0 || requestedSlot >= cap) return null;
    ids[Math.floor(requestedSlot)] = jutsuId;
    return ids;
}
