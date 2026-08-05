/*
 * Narrow lazy boundary for the Sentry browser SDK.
 *
 * Dynamically importing the package namespace retains every public export.
 * Re-exporting only the APIs the game uses lets Rollup tree-shake the
 * error-only chunk while sentry.ts keeps it off the healthy startup path.
 */
import { captureException, init } from "@sentry/react";

export { init };

function scrub(value: unknown): string | number | boolean {
    if (typeof value === "number" || typeof value === "boolean") return value;
    return String(value ?? "").slice(0, 4_000)
        .replace(/\bBearer\s+\S+|\b(?:sk|phc|sentry|posthog)[-_][A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]")
        .replace(/((?:authorization|cookie|password|session[_-]?secret|api[_-]?key)\s*[=:]\s*)[^\s,;}&]+/gi, "$1[REDACTED]");
}

export function beforeSend(event: Parameters<NonNullable<Parameters<typeof init>[0]["beforeSend"]>>[0]) {
    // Browser events need the exception and stack only. Drop every Sentry
    // container that could carry player state, request data, breadcrumbs, or
    // arbitrary application objects, then scrub the remaining error text.
    delete event.request;
    delete event.user;
    delete event.extra;
    delete event.contexts;
    delete event.breadcrumbs;
    delete event.tags;
    delete event.transaction;
    if (event.message) event.message = String(scrub(event.message));
    for (const value of event.exception?.values ?? []) {
        if (value.type) value.type = String(scrub(value.type));
        if (value.value) value.value = String(scrub(value.value));
        delete value.mechanism;
    }
    return event;
}

export function captureSanitizedException(error: unknown, _context?: Record<string, unknown>): boolean {
    try {
        captureException(error);
        return true;
    } catch {
        return false;
    }
}
