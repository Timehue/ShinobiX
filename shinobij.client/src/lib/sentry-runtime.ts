/*
 * Narrow lazy boundary for the Sentry browser SDK.
 *
 * Dynamically importing the package namespace retains every public export.
 * Re-exporting only the APIs the game uses lets Rollup tree-shake the
 * error-only chunk while sentry.ts keeps it off the healthy startup path.
 */
import { captureException, init } from "@sentry/react";
import {
    invokeSafeCapture,
    sanitizeSentryEvent,
} from "../../../shared/observability-sanitize";

export { init };

export function beforeSend(event: Parameters<NonNullable<Parameters<typeof init>[0]["beforeSend"]>>[0]) {
    return sanitizeSentryEvent(event);
}

export function captureSanitizedException(error: unknown, context?: Record<string, unknown>): boolean {
    return invokeSafeCapture(captureException, error, context);
}
