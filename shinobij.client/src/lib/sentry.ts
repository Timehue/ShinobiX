/*
 * Optional Sentry error reporting for the client.
 *
 * Fully env-gated: when VITE_SENTRY_DSN is unset (local dev, or a build that
 * opts out) every export here is a no-op, so the game runs identically with or
 * without Sentry — the same "works when the secret is unset" philosophy as the
 * no-token auth fallback.
 *
 * The DSN is a publishable client key — it ships in the public bundle by design
 * and only permits *sending* events, never reading them. Curb abuse with
 * Sentry's inbound filters / allowed-domains, not by trying to hide it.
 */
import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let active = false;

/** Initialise Sentry once, before first render. No-op when the DSN is unset. */
export function initSentry(): void {
    if (!DSN || active) return;
    try {
        Sentry.init({
            dsn: DSN,
            environment: import.meta.env.MODE,
            // Errors only — no performance tracing or replay — to stay well
            // inside the free-tier monthly event quota.
            tracesSampleRate: 0,
            sendDefaultPii: false,
        });
        active = true;
    } catch {
        /* never let telemetry setup break the app */
    }
}

/** Report a caught exception. No-op when Sentry is disabled. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
    if (!active) return;
    try {
        Sentry.captureException(error, context ? { extra: context } : undefined);
    } catch {
        /* swallow — reporting must never throw into the caller */
    }
}

/** Tag subsequent events with the logged-in player so crashes are attributable. */
export function setSentryUser(name: string | null): void {
    if (!active) return;
    try {
        Sentry.setUser(name ? { username: name } : null);
    } catch {
        /* swallow */
    }
}
