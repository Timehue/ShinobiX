import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Drop-in replacement for React.lazy that keeps a HUNG chunk load from
 * stranding a screen.
 *
 * Plain `React.lazy` caches the FIRST promise its factory returns. A fetch that
 * *hangs* (connection lost mid-download) leaves that promise un-settled, so the
 * "Loading…" fallback shows forever with nothing to recover from — the classic
 * "the page sometimes just doesn't load on mobile" failure. A chunk that fails
 * outright (a dropped request, or a 404 while a deploy rotates the hashes) is
 * no better: the lazy component re-throws that rejection on every render.
 *
 * What the retry loop below can and cannot do, measured 2026-09-13 against a
 * real `npm run build` in Playwright's Chromium, Firefox and WebKit, with the
 * first request for a screen chunk aborted and every later one allowed:
 *
 *  - It CANNOT rescue a chunk whose fetch failed. The browser keeps the failed
 *    fetch in the page's module map, so every later import() of that URL
 *    rejects at once without a network request. The chunk was requested
 *    exactly once; all four attempts rejected, and the module never loaded in
 *    that page. import() itself holds the failure (a bare import() with no
 *    preload link behaves the same), a 404 is held the same way, and in
 *    Chromium and Firefox the `<link rel=modulepreload>` that Vite's preload
 *    helper inserts first is enough to poison it too. So on a failed fetch the
 *    retries only hold the error back for the backoff, ~3.6 s at the defaults.
 *  - It DOES settle a hung fetch: the per-attempt timeout turns the stall into
 *    a failure. An attempt made while the first download is still in flight
 *    can still succeed (Chromium and Firefox attach it to that same request;
 *    WebKit starts a second one).
 *  - One failure a retry does get past is a screen's own CSS file. Vite's
 *    preload helper rejects when that stylesheet fails, but it remembers every
 *    dep it has linked and skips it on the next attempt, so attempt two
 *    resolves and the screen renders WITHOUT that CSS: no reload, no error.
 *    (Measured with HallOfLegends' stylesheet in all three engines.)
 *
 * The real recovery is a page reload, which starts a fresh module map. After
 * the last attempt, the error is re-thrown with a chunk-load-shaped message so
 * components/ScreenErrorBoundary or the top-level ErrorBoundary recognises it
 * and does its automatic reload (lib/chunk-load-recovery). In WebKit one reload
 * was not always enough: after a failed modulepreload, reloads in the next
 * ~30 s got the same failure without a request (a failed bare import()
 * recovered on the first reload).
 */
/**
 * Exported because the timeout and the chunk-shaped final error are NOT
 * specific to React.lazy: any bare `import()` can hang, and a caller that
 * awaits it then never settles either. Library-level deferrals — e.g.
 * lib/hollow-gate-generator-loader — route through this for the same timeout.
 * Outside React.lazy no error boundary sees the rejection, so nothing reloads
 * on its own and the caller has to handle it. Letting the player try again in
 * the same page can work after a timeout, but after a failed fetch only a
 * reload loads the chunk.
 */
export function retryDynamicImport<T>(
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
