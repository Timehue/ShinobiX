import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Drop-in replacement for React.lazy that survives a flaky network.
 *
 * Plain `React.lazy` caches the FIRST promise its factory returns. So if that
 * dynamic import() rejects once — a single dropped request on a spotty mobile
 * connection, or a chunk that 404s for a few seconds during a deploy — the lazy
 * component can NEVER recover for the life of the page: every later attempt to
 * render it re-throws the cached rejection, and the screen is stuck behind the
 * <Suspense> fallback or kicked to the error boundary. Worse, a fetch that
 * *hangs* (connection lost mid-download) leaves the promise un-settled, so the
 * "Loading…" fallback shows forever with nothing to recover from. This is the
 * classic "the page sometimes just doesn't load on mobile" failure.
 *
 * `lazyWithRetry` wraps the import in a retry loop: each attempt re-issues
 * import() (modern browsers re-fetch a previously-failed module), with a short
 * backoff between tries and a per-attempt timeout so a hung request is treated
 * as a failure and retried instead of stalling indefinitely. A transient blip
 * now self-heals WITHOUT a full page reload. If every attempt fails, the error
 * is re-thrown with a chunk-load-shaped message so the top-level ErrorBoundary
 * recognises it and does its one-shot reload (see components/ErrorBoundary).
 */
function retryDynamicImport<T>(
    factory: () => Promise<T>,
    retries = 3,
    backoffMs = 600,
    timeoutMs = 12_000,
): Promise<T> {
    let lastErr: unknown;
    const attempt = (n: number): Promise<T> =>
        withTimeout(factory(), timeoutMs).catch((err) => {
            lastErr = err;
            if (n >= retries) {
                // Surface a message the ErrorBoundary's chunk-error detector
                // matches, so a persistent failure takes the benign auto-reload
                // path rather than being reported as a render crash.
                throw new Error(
                    `error loading dynamically imported module (after ${retries + 1} attempts): ${
                        lastErr instanceof Error ? lastErr.message : String(lastErr)
                    }`,
                );
            }
            return delay(backoffMs * (n + 1)).then(() => attempt(n + 1));
        });
    return attempt(0);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
            () => reject(new Error("dynamically imported module timed out")),
            ms,
        );
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                window.clearTimeout(timer);
                reject(err);
            },
        );
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

// Mirror React.lazy's own generic exactly so per-screen prop types are
// preserved at every <Screen /> call site. React types this with
// ComponentType<any>; matching it keeps the single justified `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
    return lazy(() => retryDynamicImport(factory));
}
