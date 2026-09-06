// Pure helpers for the multi-tab autosave version guard in api/save/[name].ts.
// Split out from the IO-heavy handler so the parsing + key logic is
// unit-testable on its own (same pattern as the _*-validate.ts cores).

/**
 * Parse a client-supplied `_baseSaveVersion`. Returns the numeric version only
 * for a non-negative safe integer. Missing, fractional, negative, unsafe,
 * non-finite, and wrong-type values return null; player saves reject null.
 */
export function parseBaseSaveVersion(raw: unknown): number | null {
    // A version is a persisted counter, not an arbitrary number. Accepting a
    // fraction, negative value, or unsafe/future sentinel weakens the exact
    // compare in the save handler and can let a stale writer clobber data.
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/** Validate a stored version, treating only a truly absent legacy stamp as 0. */
export function storedSaveVersion(raw: unknown): number {
    if (raw === undefined || raw === null) return 0;
    const parsed = parseBaseSaveVersion(raw);
    if (parsed === null) throw new RangeError('Stored save version is invalid.');
    return parsed;
}

/** Return max(input versions)+1 without ever producing an unsafe counter. */
export function nextSaveVersion(...rawVersions: unknown[]): number {
    const max = rawVersions.reduce<number>((current, raw) => Math.max(current, storedSaveVersion(raw)), 0);
    if (max >= Number.MAX_SAFE_INTEGER) throw new RangeError('Save version space exhausted.');
    return max + 1;
}

/** True only when the client is replacing the exact stored snapshot it read. */
export function matchesStoredSaveVersion(baseVersion: number | null, storedVersion: number): boolean {
    return baseVersion !== null && baseVersion === storedVersion;
}

/**
 * UTC daily key for the "player saves arriving WITHOUT a version stamp"
 * telemetry counter (#14 rollout signal). Pass `new Date().toISOString()`.
 * Keyed by day so an operator can watch the per-day count trend toward zero;
 * once it stays ~0 the client has rolled over and the guard can be made
 * mandatory for player saves.
 */
export function saveVersionTelemetryKey(dateIso: string): string {
    return `telemetry:save-noversion:${dateIso.slice(0, 10)}`;
}

/**
 * #14 step 2 — should this write be REJECTED for lacking a version stamp?
 *
 * A non-clan PLAYER save (identityName set) with no parsed `_baseSaveVersion`
 * (baseVersion === null) can only come from a client old enough to predate the
 * autosave guard (pre-2026-05-26 / `3455f8d`): the current client always echoes
 * a numeric version (0 by default) on EVERY own-save path. A versionless write
 * bypasses the optimistic-concurrency check and can silently clobber a newer
 * tab's progress, so we require the field for player saves.
 *
 * Returns false (allowed) for:
 *  - clan saves (`isClanSave`) — shared blob, guarded by the field-level delta
 *    validator instead;
 *  - admin saves (`identityName === null`, incl. cross-player grants) — the
 *    version ref tracks the actor, not the target, and admin is trusted;
 *  - any save that DID send a numeric version (`baseVersion !== null`) — that's
 *    handled by the separate stale-version 409 check, not here.
 */
export function isVersionlessPlayerSave(
    isClanSave: boolean,
    identityName: string | null,
    baseVersion: number | null,
): boolean {
    return !isClanSave && !!identityName && baseVersion === null;
}

/**
 * Bump the optimistic-concurrency version on a player `save:<name>` record that a
 * SERVER-side credit/mutation endpoint is about to write. Mutates and returns the
 * SAME record object (so it can be inlined into the kv.set argument).
 *
 * WHY every server credit must call this (audit 2026-06-26, root cause #2):
 * the autosave guard in api/save/[name].ts only 409s a client write whose echoed
 * `_baseSaveVersion` is BELOW the stored `_saveVersion`. If a server credit writes
 * the save but leaves `_saveVersion` unchanged, an open client tab still holding
 * the pre-credit version sails through the guard and its stale autosave clobbers
 * the just-credited values (ryo/currency via the sanitizer's Math.min favouring
 * the lower stale number; inventory via verbatim array overwrite). Bumping the
 * version forces that next stale autosave to 409 → the client's
 * refetchAfterSaveConflict reapplies the credited snapshot. Mirrors the handler's
 * own increment semantics (`Number(stored ?? 0) + 1`, `_saveAt: Date.now()`).
 *
 * Call AFTER building the record and BEFORE kv.set, under the same lock as the
 * write. Pass the record that ALREADY carries the stored `_saveVersion` (e.g.
 * `{ ...freshRecord, character: {...} }`) so the +1 is relative to what's stored.
 * Do NOT call for clan/pool records (those use the field-delta validator, not a
 * version stamp) or for admin-save writes (the handler already bumps those).
 */
export function bumpSaveVersion<T extends Record<string, unknown>>(
    record: T,
    opts: { regenAt?: number } = {},
): T & { _saveVersion: number; _saveAt: number; _regenAt: number } {
    const r = record as T & { _saveVersion: number; _saveAt: number; _regenAt: number };
    r._saveVersion = nextSaveVersion(r._saveVersion);
    r._saveAt = Date.now();
    // The regeneration cursor (api/_elapsed-state.ts settleVitalsRegen). A
    // server write fences it to the write instant — combat, hospital and any
    // other server-written vitals change must never be counted as idle
    // recovery afterwards — unless the caller settled elapsed recovery first
    // and passes the cursor it computed (mutatePlayerSave does), which keeps
    // the sub-second remainder instead of discarding it on every mutation.
    const regenAt = Number(opts.regenAt);
    r._regenAt = Number.isFinite(regenAt) && regenAt > 0 ? Math.floor(regenAt) : r._saveAt;
    return r;
}

/**
 * Mark a player-save write as DELIBERATELY versionless. Returns the record
 * untouched.
 *
 * Its only job is to make "this write must not publish a new `_saveVersion`" an
 * explicit, greppable decision instead of an omission.
 * `_versioned-save-writes.test.ts` accepts this name alongside `bumpSaveVersion`,
 * so the reward-integrity guard still catches a mutation that merely FORGOT to
 * version itself — and a second test there pins this helper to its single
 * legitimate call site so it cannot quietly become a general escape hatch.
 *
 * ⛔ Legitimate ONLY when the write carries nothing a later read could not
 * recompute for itself. The one caller is the vitals-regen projection in
 * `settleSaveRecordForRead`: regen is re-derived from `_saveAt` on every read,
 * so publishing a version for it declared the owner's open client stale and 409'd
 * its own next autosave. Anything that credits ryo, XP, items or progress is NOT
 * this — it must bump, or a stale tab will clobber it (see `bumpSaveVersion`).
 */
export function unversionedSettledRecord<T extends Record<string, unknown>>(record: T): T {
    return record;
}
