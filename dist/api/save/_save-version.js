"use strict";
// Pure helpers for the multi-tab autosave version guard in api/save/[name].ts.
// Split out from the IO-heavy handler so the parsing + key logic is
// unit-testable on its own (same pattern as the _*-validate.ts cores).
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBaseSaveVersion = parseBaseSaveVersion;
exports.saveVersionTelemetryKey = saveVersionTelemetryKey;
exports.isVersionlessPlayerSave = isVersionlessPlayerSave;
/**
 * Parse a client-supplied `_baseSaveVersion`. Returns the numeric version, or
 * null when it's absent / non-finite — i.e. an old client that doesn't echo
 * the field. `null` means "no version known", which the guard treats as an
 * allow (backwards-compat for stale tabs) and the #14 telemetry counts.
 */
function parseBaseSaveVersion(raw) {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
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
