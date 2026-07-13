/*
 * Optional Sentry error reporting for the client.
 *
 * Fully env-gated: when VITE_SENTRY_DSN is unset (local dev, or a build that
 * opts out) every export here is a no-op, so the game runs identically with or
 * without Sentry. Even when enabled, the SDK is imported only after an error.
 * Healthy players therefore never download it and it cannot delay first paint
 * or compete with the first screen chunk.
 *
 * The DSN is a publishable client key — it ships in the public bundle by design
 * and only permits *sending* events, never reading them. Curb abuse with
 * Sentry's inbound filters / allowed-domains, not by trying to hide it.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

type SentryModule = typeof import("./sentry-runtime");

let activeModule: SentryModule | null = null;
let loadPromise: Promise<SentryModule | null> | null = null;
let listenersInstalled = false;
let currentUser: string | null = null;

function setUser(module: SentryModule, name: string | null): void {
    try {
        module.setUser(name ? { username: name } : null);
    } catch {
        /* reporting must never throw into the game */
    }
}

function loadSentry(): Promise<SentryModule | null> {
    if (!DSN) return Promise.resolve(null);
    if (activeModule) return Promise.resolve(activeModule);
    if (loadPromise) return loadPromise;

    loadPromise = import("./sentry-runtime")
        .then((module) => {
            try {
                module.init({
                    dsn: DSN,
                    environment: import.meta.env.MODE,
                    release: (import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_BUILD_COMMIT) as string | undefined,
                    // Our tiny listeners below load the SDK on the first error.
                    // Disable Sentry's duplicate global handlers once it arrives.
                    integrations: (defaults) => defaults.filter((integration) => integration.name !== "GlobalHandlers"),
                    tracesSampleRate: 0,
                    sendDefaultPii: false,
                });
                activeModule = module;
                setUser(module, currentUser);
                return module;
            } catch {
                loadPromise = null;
                return null;
            }
        })
        .catch(() => {
            loadPromise = null;
            return null;
        });

    return loadPromise;
}

function browserError(event: ErrorEvent): unknown {
    return event.error ?? new Error(event.message || "Unhandled browser error");
}

/**
 * Install lightweight global listeners before first render. The Sentry SDK is
 * not requested until one of these listeners (or an ErrorBoundary) reports an
 * actual error.
 */
export function initSentry(): void {
    if (!DSN || listenersInstalled || typeof window === "undefined") return;
    listenersInstalled = true;
    window.addEventListener("error", (event) => {
        reportError(browserError(event), {
            source: "window.error",
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        reportError(event.reason, { source: "window.unhandledrejection" });
    });
}

/** Report a caught exception. No-op when Sentry is disabled. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
    if (!DSN) return;
    void loadSentry().then((module) => {
        if (!module) return;
        try {
            module.captureException(error, context ? { extra: context } : undefined);
        } catch {
            /* reporting must never throw into the caller */
        }
    });
}

/** Tag subsequent events with the logged-in player so crashes are attributable. */
export function setSentryUser(name: string | null): void {
    currentUser = name;
    if (activeModule) setUser(activeModule, name);
}
