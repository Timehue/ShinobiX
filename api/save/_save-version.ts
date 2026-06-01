// Pure helpers for the multi-tab autosave version guard in api/save/[name].ts.
// Split out from the IO-heavy handler so the parsing + key logic is
// unit-testable on its own (same pattern as the _*-validate.ts cores).

/**
 * Parse a client-supplied `_baseSaveVersion`. Returns the numeric version, or
 * null when it's absent / non-finite — i.e. an old client that doesn't echo
 * the field. `null` means "no version known", which the guard treats as an
 * allow (backwards-compat for stale tabs) and the #14 telemetry counts.
 */
export function parseBaseSaveVersion(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
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
