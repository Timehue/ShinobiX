/**
 * Global fetch interceptor that automatically attaches authentication
 * headers to /api/ requests.
 *
 * The backend now requires either:
 *   - x-player-name + x-player-token headers (player auth), or
 *   - x-admin-password (admin auth)
 *
 * Rather than editing every fetch() call site, this hooks window.fetch once
 * at app boot. The interceptor:
 *
 *   1. Only touches relative /api/ URLs (skips Vercel proxy + 3rd parties)
 *   2. Reads the active player from sessionStorage (set by App.tsx when
 *      a character is loaded / cleared)
 *   3. Reads the revocable session token minted by player-auth
 *   4. Adds headers only when none of the keys are already present
 *      (so existing call sites that pass x-admin-password / x-kv-token /
 *      x-player-password manually still win)
 *
 * No-op on the server side (no window).
 */

// The player name and revocable session token are stored in both
// sessionStorage and localStorage. Reusable plaintext passwords are never
// persisted; an expired token requires a clean login.
//
// sessionStorage: per-tab, cleared when the tab is closed or (in some mobile
//   browsers) when the browser kills and restores the tab. Fast to read.
//
// localStorage: survives page refreshes (F5), new tabs, and browser restarts.
//   Without this fallback the auto-load on startup fires fetch('/api/save/...')
//   with no auth headers → 401 → the player is silently sent to the login screen
//   even though they never intentionally logged out.
//
const ACTIVE_PLAYER_KEY = 'shinobix:activePlayer';
// Separate localStorage keys so the rest of the app's localStorage blob
// (which explicitly strips passwords) is unaffected.
const ACTIVE_PLAYER_LS_KEY = 'shinobix:activePlayerPersist';
// Session token (stateless HMAC, minted by /api/player-auth). It expires after
// 24h and is revocable through the per-user session epoch or SESSION_SECRET.
const ACTIVE_TOKEN_KEY = 'shinobix:activeToken';
const ACTIVE_TOKEN_LS_KEY = 'shinobix:activeTokenPersist';

function getActivePlayer(): string | null {
    try {
        return sessionStorage.getItem(ACTIVE_PLAYER_KEY)
            ?? localStorage.getItem(ACTIVE_PLAYER_LS_KEY);
    } catch {
        return null;
    }
}

/**
 * Remove the persisted plaintext password from BOTH stores. Called the moment a
 * session token becomes available — the token supersedes the password as the
 * credential, so the reusable plaintext should not linger (audit M5).
 */
function clearPersistedPassword(): void {
    try {
        sessionStorage.removeItem('shinobix:activePassword');
        localStorage.removeItem('shinobix:activePasswordPersist');
    } catch {
        /* storage disabled — ignore */
    }
}

function getActiveToken(): string | null {
    try {
        return sessionStorage.getItem(ACTIVE_TOKEN_KEY)
            ?? localStorage.getItem(ACTIVE_TOKEN_LS_KEY);
    } catch {
        return null;
    }
}

/**
 * Store (or clear) the session token. Called after a successful auth response
 * carries a `token`, and cleared on logout via setActivePlayer(null).
 */
export function setActiveToken(token: string | null): void {
    try {
        if (!token) {
            sessionStorage.removeItem(ACTIVE_TOKEN_KEY);
            localStorage.removeItem(ACTIVE_TOKEN_LS_KEY);
            return;
        }
        sessionStorage.setItem(ACTIVE_TOKEN_KEY, token);
        localStorage.setItem(ACTIVE_TOKEN_LS_KEY, token);
        // M5: the token is now the durable credential — drop the reusable
        // plaintext password from storage. Cleared only AFTER the token is
        // safely stored above, so a storage failure can never strand us with
        // neither credential.
        clearPersistedPassword();
        // A fresh token re-arms the expiry notice so a future expiry can prompt
        // re-login again. (#14)
        _sessionExpiredNotified = false;
    } catch {
        /* storage disabled — ignore */
    }
}

// ── Session-expiry signal (audit #14) ────────────────────────────────────────
// A token-first client clears its stored password once it has a token (M5), so
// after the 24h token expires — or SESSION_SECRET is rotated — there is nothing
// left to re-mint from. The interceptor below detects that "401 and can't
// refresh" case and fires this ONCE so the app can show a clear re-login prompt
// instead of leaving the player on a frozen, silently-unauthenticated screen.
// Listen for it with: window.addEventListener('shinobix:session-expired', ...).
// The latch resets whenever a fresh token is stored (setActiveToken above).
export const SESSION_EXPIRED_EVENT = 'shinobix:session-expired';
export const SAVE_VERSION_EVENT = 'shinobix:save-version';
let _sessionExpiredNotified = false;
function notifySessionExpired(): void {
    if (_sessionExpiredNotified) return;
    _sessionExpiredNotified = true;
    try {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    } catch {
        /* SSR / no window — ignore */
    }
}

function observeSaveVersion(response: Response): Response {
    try {
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) return response;
        void response.clone().json().then((data: unknown) => {
            if (!data || typeof data !== 'object') return;
            const version = Number((data as Record<string, unknown>)._saveVersion);
            if (!Number.isFinite(version)) return;
            window.dispatchEvent(new CustomEvent(SAVE_VERSION_EVENT, { detail: { version } }));
        }).catch(() => undefined);
    } catch {
        /* response clone / JSON parse unavailable — ignore */
    }
    return response;
}

/**
 * Snapshot of the credentials a Socket.IO handshake needs, mirroring the HTTP
 * interceptor's token-only player authentication. Read fresh at connect /
 * reconnect time. No-op-safe if storage is unavailable.
 */
export function getSocketAuth(): { token: string | null; name: string | null; password: null } {
    return { token: getActiveToken(), name: getActivePlayer(), password: null };
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
        headers.has('x-player-token') ||
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
 * The password argument remains for source compatibility with older call sites
 * but is intentionally ignored. Pass `null` for name to clear the identity.
 */
export function setActivePlayer(name: string | null, _password?: string | null): void {
    try {
        clearPersistedPassword();
        if (name === null) {
            // Clear from both stores on logout — including the session token.
            sessionStorage.removeItem(ACTIVE_PLAYER_KEY);
            localStorage.removeItem(ACTIVE_PLAYER_LS_KEY);
            setActiveToken(null);
            return;
        }
        sessionStorage.setItem(ACTIVE_PLAYER_KEY, name);
        localStorage.setItem(ACTIVE_PLAYER_LS_KEY, name);
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
            return observeSaveVersion(await originalFetch(input, newInit));
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
            return observeSaveVersion(await originalFetch(input, newInit));
        }

        // Fall back to player auth
        const activeName = getActivePlayer();
        const token = getActiveToken();
        // Nothing to attach (logged out) — pass through unauthenticated.
        if (!activeName || !token) {
            newInit.headers = newHeaders;
            return observeSaveVersion(await originalFetch(input, newInit));
        }

        if (!newHeaders.has('x-player-name')) newHeaders.set('x-player-name', activeName);
        if (!newHeaders.has('x-player-token')) newHeaders.set('x-player-token', token);
        newInit.headers = newHeaders;

        const response = await originalFetch(input, newInit);

        // A rejected session token requires a clean login. We intentionally do
        // not persist a reusable password merely to refresh tokens in-place.
        if (response.status === 401 && token && !isAuthEndpoint(input)) {
            notifySessionExpired();
        }
        return observeSaveVersion(response);
    };
}

/** True for the player-auth endpoint — never trigger refresh-on-401 on it. */
function isAuthEndpoint(input: RequestInfo | URL): boolean {
    try {
        if (typeof input === 'string') return input.startsWith('/api/player-auth');
        if (input instanceof URL) return input.pathname.startsWith('/api/player-auth');
        if (input instanceof Request) return new URL(input.url, location.href).pathname.startsWith('/api/player-auth');
    } catch {
        /* ignore */
    }
    return false;
}
