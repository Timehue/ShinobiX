// Decides whether a player save should rewrite the shared `player:registry`
// row. Extracted as a pure function so the throttle is unit-testable (the save
// handler itself is too entangled with auth/locks/kv to drive in tests).
//
// Why throttle: kv.hset re-serializes the ENTIRE registry row (one hot row
// holding every player) on each call — a full-row write + WAL image + row-lock
// contention point that every autosave (~1 / 3s per active player) otherwise
// hits. The roster only shows name/level/village/specialty + a "last seen X
// ago" timestamp, so we only need to rewrite when one of those identity fields
// changed, or when the cached lastSeen would drift past `refreshMs` (kept ~1
// min so the drift is invisible to the "X ago" display + UserHub sort).
//
// IMPORTANT: this gates ONLY the registry index write. The save blob itself is
// always written by the caller regardless of this decision — no progress is
// ever skipped.

export type RegistryIdentity = {
    name: string;
    level: number;
    village: string;
    specialty: string;
};

export function shouldWriteRegistry(opts: {
    /** Clan saves always rewrite (they're infrequent + keyed differently). */
    isClanSave: boolean;
    /** The previously-stored character, or null for a brand-new save. */
    existingChar: Record<string, unknown> | null;
    /** Identity derived from the sanitized incoming save. */
    next: RegistryIdentity;
    /** `_registryAt` carried in the prior save blob (0 if never stamped). */
    prevRegistryAt: number;
    now: number;
    refreshMs: number;
}): boolean {
    const { isClanSave, existingChar, next, prevRegistryAt, now, refreshMs } = opts;
    // Clan saves and brand-new players always index so the registry is never
    // missing an entry (the roster/bloodline/injured readers derive their key
    // list from it). Throttling only ever skips a REFRESH of an existing entry.
    if (isClanSave) return true;
    if (!existingChar) return true;
    const identityChanged =
        String(existingChar.name ?? '') !== next.name
        || Number(existingChar.level ?? -1) !== next.level
        || String(existingChar.village ?? '') !== next.village
        || String(existingChar.specialty ?? '') !== next.specialty;
    if (identityChanged) return true;
    // Nothing roster-visible changed — only refresh lastSeen if it would drift.
    return now - prevRegistryAt > refreshMs;
}
