"use strict";
// Pure helpers for the multi-tab autosave version guard in api/save/[name].ts.
// Split out from the IO-heavy handler so the parsing + key logic is
// unit-testable on its own (same pattern as the _*-validate.ts cores).
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBaseSaveVersion = parseBaseSaveVersion;
exports.storedSaveVersion = storedSaveVersion;
exports.nextSaveVersion = nextSaveVersion;
exports.matchesStoredSaveVersion = matchesStoredSaveVersion;
exports.saveVersionTelemetryKey = saveVersionTelemetryKey;
exports.isVersionlessPlayerSave = isVersionlessPlayerSave;
exports.bumpSaveVersion = bumpSaveVersion;
/**
 * Parse a client-supplied `_baseSaveVersion`. Returns the numeric version only
 * for a non-negative safe integer. Missing, fractional, negative, unsafe,
 * non-finite, and wrong-type values return null; player saves reject null.
 */
function parseBaseSaveVersion(raw) {
    // A version is a persisted counter, not an arbitrary number. Accepting a
    // fraction, negative value, or unsafe/future sentinel weakens the exact
    // compare in the save handler and can let a stale writer clobber data.
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}
/** Validate a stored version, treating only a truly absent legacy stamp as 0. */
function storedSaveVersion(raw) {
    if (raw === undefined || raw === null)
        return 0;
    const parsed = parseBaseSaveVersion(raw);
    if (parsed === null)
        throw new RangeError('Stored save version is invalid.');
    return parsed;
}
/** Return max(input versions)+1 without ever producing an unsafe counter. */
function nextSaveVersion(...rawVersions) {
    const max = rawVersions.reduce((current, raw) => Math.max(current, storedSaveVersion(raw)), 0);
    if (max >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Save version space exhausted.');
    return max + 1;
}
/** True only when the client is replacing the exact stored snapshot it read. */
function matchesStoredSaveVersion(baseVersion, storedVersion) {
    return baseVersion !== null && baseVersion === storedVersion;
}
/**
 * UTC daily key for the "player saves arriving WITHOUT a version stamp"
 * telemetry counter (#14 rollout signal). Pass `new Date().toISOString()`.
 * Keyed by day so an operator can watch the per-day count trend toward zero;
 * once it stays ~0 the client has rolled over and the guard can be made
 * mandatory for player saves.
 */
function saveVersionTelemetryKey(dateIso) {
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
function isVersionlessPlayerSave(isClanSave, identityName, baseVersion) {
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
function bumpSaveVersion(record) {
    const r = record;
    r._saveVersion = nextSaveVersion(r._saveVersion);
    r._saveAt = Date.now();
    return record;
}
