/*
 * Registers the narrow-scope asset service worker (public/sw.js): cache-first
 * for content-hashed assets, plus last-known-good caching for image requests.
 * It never touches HTML or non-image API data. Prod-only: the Vite dev server rewrites
 * modules on the fly, so a SW there only causes confusion. Registration is
 * deferred to window load so it can never compete with boot-critical fetches.
 * Registration failure is silently ignored — the app works identically
 * without it, just with colder warm loads.
 */

export function registerAssetServiceWorker(): void {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
}
