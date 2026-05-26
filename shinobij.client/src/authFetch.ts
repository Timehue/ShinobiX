/**
 * Global fetch interceptor that automatically attaches authentication
 * headers to /api/ requests.
 *
 * The backend now requires either:
 *   - x-player-name + x-player-password headers (player auth), or
 *   - x-admin-password (admin auth)
 *
 * Rather than editing every fetch() call site, this hooks window.fetch once
 * at app boot. The interceptor:
 *
 *   1. Only touches relative /api/ URLs (skips Vercel proxy + 3rd parties)
 *   2. Reads the active player from sessionStorage (set by App.tsx when
 *      a character is loaded / cleared)
 *   3. Looks up that player's password from the existing accounts blob
 *      in localStorage (already maintained by the login flow)
 *   4. Adds headers only when none of the keys are already present
 *      (so existing call sites that pass x-admin-password / x-kv-token /
 *      x-player-password manually still win)
 *
 * No-op on the server side (no window).
 */

// Credentials are stored in both sessionStorage AND localStorage.
//
// sessionStorage: per-tab, cleared when the tab is closed or (in some mobile
//   browsers) when the browser kills and restores the tab. Fast to read.
//
// localStorage: survives page refreshes (F5), new tabs, and browser restarts.
//   Without this fallback the auto-load on startup fires fetch('/api/save/...')
//   with no auth headers → 401 → the player is silently sent to the login screen
//   even though they never intentionally logged out.
//
// Security note: sessionStorage and localStorage have the same XSS exposure
// in a browser context, so using localStorage is not meaningfully less secure.
// The password is transmitted over HTTPS and hashed server-side.
const ACTIVE_PLAYER_KEY = 'shinobix:activePlayer';
const ACTIVE_PASSWORD_KEY = 'shinobix:activePassword';
// Separate localStorage keys so the rest of the app's localStorage blob
// (which explicitly strips passwords) is unaffected.
const ACTIVE_PLAYER_LS_KEY = 'shinobix:activePlayerPersist';
const ACTIVE_PASSWORD_LS_KEY = 'shinobix:activePasswordPersist';

function getActivePlayer(): string | null {
    try {
        return sessionStorage.getItem(ACTIVE_PLAYER_KEY)
            ?? localStorage.getItem(ACTIVE_PLAYER_LS_KEY);
    } catch {
        return null;
    }
}

function getActivePassword(): string | null {
    try {
        return sessionStorage.getItem(ACTIVE_PASSWORD_KEY)
            ?? localStorage.getItem(ACTIVE_PASSWORD_LS_KEY);
    } catch {
        return null;
    }
}

function isApiUrl(input: string | URL | Request): boolean {
    if (typeof input === 'string') return input.startsWith('/api/');
    if (input instanceof URL) return input.pathname.startsWith('/api/');
    if (input instanceof Request) {
        try {
            return new URL(input.url, location.href).pathname.startsWith('/api/');
        } catch {
            return false;
        }
    }
    return false;
}

function hasAuthHeader(init: RequestInit | undefined, input: RequestInfo | URL): boolean {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    return (
        headers.has('x-player-password') ||
        headers.has('x-admin-password') ||
        headers.has('x-kv-token')
    );
}

/**
 * Update the active session identity. Call:
 *   - after a successful login        → setActivePlayer(name, password)
 *   - after a successful registration → setActivePlayer(name, password)
 *   - on logout / clear               → setActivePlayer(null)
 *
 * If `password` is omitted, only the name is updated (existing password kept).
 * Pass `null` for name to clear both.
 */
export function setActivePlayer(name: string | null, password?: string | null): void {
    try {
        if (name === null) {
            // Clear from both stores on logout.
            sessionStorage.removeItem(ACTIVE_PLAYER_KEY);
            sessionStorage.removeItem(ACTIVE_PASSWORD_KEY);
            localStorage.removeItem(ACTIVE_PLAYER_LS_KEY);
            localStorage.removeItem(ACTIVE_PASSWORD_LS_KEY);
            return;
        }
        sessionStorage.setItem(ACTIVE_PLAYER_KEY, name);
        localStorage.setItem(ACTIVE_PLAYER_LS_KEY, name);
        if (password !== undefined && password !== null) {
            sessionStorage.setItem(ACTIVE_PASSWORD_KEY, password);
            localStorage.setItem(ACTIVE_PASSWORD_LS_KEY, password);
        }
    } catch {
        /* storage disabled — ignore */
    }
}

import { getFingerprintSync, primeFingerprint } from './fingerprint';

/** Helper to attach the browser fingerprint header if one has been computed. */
function attachFingerprint(headers: Headers): void {
    if (headers.has('x-client-fp')) return;
    const fp = getFingerprintSync();
    if (fp) headers.set('x-client-fp', fp);
}

let installed = false;
export function installAuthFetch(): void {
    if (installed || typeof window === 'undefined' || !window.fetch) return;
    installed = true;
    // Kick off fingerprint computation in the background so it's ready for
    // the second + subsequent requests. First request may not carry the
    // header, which is fine — server only uses fp opportunistically.
    primeFingerprint();
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        if (!isApiUrl(input)) {
            return originalFetch(input, init);
        }
        // Always attach fingerprint on /api/ calls (regardless of auth mode)
        // so the server can record the device used even for unauthenticated
        // probes (registration, etc).
        const newInit: RequestInit = { ...(init ?? {}) };
        const newHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        attachFingerprint(newHeaders);

        if (hasAuthHeader(init, input)) {
            newInit.headers = newHeaders;
            return originalFetch(input, newInit);
        }

        // Try admin auth first (higher priority when both exist)
        let adminPw: string | null = null;
        try {
            adminPw = sessionStorage.getItem('admin:pw');
        } catch {
            /* storage disabled */
        }

        if (adminPw) {
            if (!newHeaders.has('x-admin-password')) newHeaders.set('x-admin-password', adminPw);
            newInit.headers = newHeaders;
            return originalFetch(input, newInit);
        }

        // Fall back to player auth
        const activeName = getActivePlayer();
        const pw = getActivePassword();
        if (!activeName || !pw) {
            newInit.headers = newHeaders;
            return originalFetch(input, newInit);
        }

        if (!newHeaders.has('x-player-name')) newHeaders.set('x-player-name', activeName);
        if (!newHeaders.has('x-player-password')) newHeaders.set('x-player-password', pw);
        newInit.headers = newHeaders;
        return originalFetch(input, newInit);
    };
}
