/** Return a fixed-length, duplicate-free, slot-addressable selection. */
export function normalizeArenaSelection(ids: readonly string[], size: number): string[] {
    const result = Array.from({ length: size }, () => "");
    const used = new Set<string>();
    for (let index = 0; index < size; index++) {
        const id = typeof ids[index] === "string" ? ids[index].trim() : "";
        if (!id || used.has(id)) continue;
        used.add(id);
        result[index] = id;
    }
    return result;
}

export const arenaSelectionCount = (ids: readonly string[]): number => ids.reduce((count, id) => count + (id ? 1 : 0), 0);

export function isExactAvailableArenaSelection(
    ids: readonly string[],
    availableIds: ReadonlySet<string>,
    size: number,
): boolean {
    if (ids.length !== size || new Set(ids).size !== size) return false;
    return ids.every((id) => Boolean(id) && availableIds.has(id));
}

/** Assign a pet to a named slot. If it was in another slot, swap the two slots
 * rather than shifting every later lane. */
export function assignArenaSelectionSlot(
    ids: readonly string[],
    targetSlot: number,
    petId: string,
    size: number,
): string[] {
    const next = normalizeArenaSelection(ids, size);
    if (!petId || targetSlot < 0 || targetSlot >= size) return next;
    const previousSlot = next.indexOf(petId);
    if (previousSlot === targetSlot) return next;
    const displaced = next[targetSlot];
    next[targetSlot] = petId;
    if (previousSlot >= 0) next[previousSlot] = displaced;
    return next;
}

export function clearArenaSelectionSlot(ids: readonly string[], slot: number, size: number): string[] {
    const next = normalizeArenaSelection(ids, size);
    if (slot >= 0 && slot < size) next[slot] = "";
    return next;
}

export function nextOpenArenaSlot(ids: readonly string[], fromSlot: number): number {
    for (let offset = 1; offset <= ids.length; offset++) {
        const candidate = (fromSlot + offset) % ids.length;
        if (!ids[candidate]) return candidate;
    }
    return (fromSlot + 1) % Math.max(1, ids.length);
}
