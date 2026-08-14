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

/**
 * The session password, held in MEMORY ONLY — never sessionStorage, never
 * localStorage. `clearPersistedPassword` above exists to purge the old durable
 * copies, and durable plaintext must never come back (audit M5).
 *
 * This variable is what makes the documented SESSION_SECRET-unset fallback real.
 * In that mode the server issues no token at all, and the request interceptor
 * attaches a credential only when one is in hand — so with the password discarded
 * (it used to be an ignored parameter) a player could log in "successfully" and then
 * have EVERY authenticated request 401. Registration was worse: the account existed
 * server-side but its first save failed, so a refresh found nothing and cleared it.
 *
 * Memory-only means a refresh costs a re-login, never a lockout — which is exactly
 * the failure mode the auth model promises. Dropped as soon as a token supersedes it.
 */
let _memPassword: string | null = null;

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
        // The token supersedes the password as the credential, so drop the in-memory
        // copy too. A later token expiry then surfaces the re-auth modal rather than
        // silently falling back to a password the player never re-confirmed.
        _memPassword = null;
        // A fresh token re-arms the expiry notice so a future expiry can prompt
        // re-login again. (#14)
        _sessionExpiredNotified = false;
        _consecutive401s = 0;
        _first401At = 0;
    } catch {
        /* storage disabled — ignore */
    }
}

// ── Admin session token (Phase 4) ────────────────────────────────────────────
// The admin panel used to keep the reusable ADMIN_PASSWORD in sessionStorage and
// attach it (x-admin-password) to every admin request. When the server issues a
// signed admin session token at login (ADMIN_SESSION_SECRET set), we store the
// token instead and the interceptor sends `x-admin-token`, swapping out any
// x-admin-password so the plaintext admin password never leaves the browser.
const ADMIN_TOKEN_KEY = 'admin:token';
const ADMIN_PW_KEY = 'admin:pw';

function getAdminToken(): string | null {
    try {
        return sessionStorage.getItem(ADMIN_TOKEN_KEY);
    } catch {
        return null;
    }
}

/**
 * Establish (or clear) the admin session credential.
 *   - `token` present → store the signed session token; the reusable password is
 *     removed so it can neither linger in storage nor be sent (authFetch swaps
 *     x-admin-password → x-admin-token on the wire).
 *   - no `token` but a `passwordFallback` → legacy path (ADMIN_SESSION_SECRET
 *     unset on the server): persist the password so admin requests keep working.
 *   - neither → clear the admin session (logout).
 */
export function setAdminSession(token: string | null, passwordFallback?: string | null): void {
    try {
        if (token) {
            sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
            sessionStorage.removeItem(ADMIN_PW_KEY);
        } else {
            sessionStorage.removeItem(ADMIN_TOKEN_KEY);
            if (passwordFallback) sessionStorage.setItem(ADMIN_PW_KEY, passwordFallback);
        }
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

// ── Sliding refresh + transient-401 tolerance ────────────────────────────────
// The server hands back a freshly minted token on this header once the current
// one passes the halfway point of its life (see maybeRefreshPlayerToken in
// api/_auth.ts). Swapping it in here means an actively-playing session never
// expires, so the re-auth modal above stops firing for ordinary players.
const TOKEN_REFRESH_HEADER = 'x-player-token-refresh';

/**
 * Read the expiry stamped into a token. Both formats put it in field 3
 * (`v2.<name>.<expMs>.<epoch>.<sig>` / `v1.<name>.<expMs>.<sig>`). Structural
 * only — the client cannot verify the signature, and never needs to: this is
 * used solely to tell "definitely dead" from "should still work", never to
 * grant access.
 */
function tokenExpiryMs(token: string): number | null {
    const parts = token.split('.');
    if (parts[0] !== 'v2' && parts[0] !== 'v1') return null;
    const expMs = Number(parts[2]);
    return Number.isFinite(expMs) ? expMs : null;
}

/** True only when the token's own expiry has demonstrably passed. */
function isTokenExpired(token: string): boolean {
    const expMs = tokenExpiryMs(token);
    return expMs !== null && expMs <= Date.now();
}

/** True when the stored token exists and is past its expiry. */
export function isActiveTokenExpired(): boolean {
    const token = getActiveToken();
    return Boolean(token) && isTokenExpired(token!);
}

// Not every 401 on a token-bearing request means the session died. A blip in the
// server's session-epoch read fails closed (401), and a few endpoints answer 401
// for reasons unrelated to the player's session — e.g. api/player/travel.ts
// rejects an admin-only identity. Those used to pop the re-auth modal at a fully
// logged-in player. So: if the token is genuinely past its expiry, surface it
// immediately; otherwise require several consecutive failures, since any single
// successful response proves the session is alive and resets the count.
//
// The count alone is not enough, because it is RATE-dependent. The heartbeat fires
// once per second during combat, so three consecutive failures meant a ~3-second
// storage blip put a blocking, full-screen re-auth modal over an active fight —
// while the same blip on a 20s idle cadence would have been ignored for a minute.
// Requiring a sustained DURATION as well makes the tolerance mean the same thing on
// every code path: a real outage still surfaces, a brief hiccup never does.
const TRANSIENT_401_TOLERANCE = 3;
const TRANSIENT_401_GRACE_MS = 15_000;
let _consecutive401s = 0;
let _first401At = 0;

/**
 * Adopt a server-minted replacement token if the response carried one. Applied
 * on EVERY response path — including requests whose caller supplied its own
 * credential — so a session can never miss its renewal just because of which
 * branch of the interceptor it took.
 */
function adoptRefreshedToken(response: Response): Response {
    try {
        const refreshed = response.headers.get(TOKEN_REFRESH_HEADER);
        if (refreshed && refreshed !== getActiveToken()) setActiveToken(refreshed);
    } catch {
        /* header access unavailable (opaque response) — ignore */
    }
    return response;
}

export type SaveVersionEventDetail = {
    version: number;
    accountName: string | null;
    source: "full-save" | "mutation";
};

export function buildSaveVersionEventDetail(
    data: unknown,
    accountName: string | null,
    source: SaveVersionEventDetail["source"],
): SaveVersionEventDetail | null {
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    // Character-bearing responses must be adopted through the App's atomic
    // character+version commit. Advancing only the version here could let a
    // dropped/unmounted screen leave stale local character data at the new base.
    if (record.character && typeof record.character === "object") return null;
    if (!Number.isSafeInteger(record._saveVersion) || Number(record._saveVersion) <= 0) return null;
    return { version: Number(record._saveVersion), accountName, source };
}

function isFullSaveRequest(input: RequestInfo | URL): boolean {
    try {
        const path = typeof input === "string"
            ? new URL(input, window.location.href).pathname
            : input instanceof URL
                ? input.pathname
                : new URL(input.url, window.location.href).pathname;
        return path === "/api/save" || path.startsWith("/api/save/");
    } catch {
        return false;
    }
}

function observeSaveVersion(response: Response, accountName: string | null, input: RequestInfo | URL): Response {
    try {
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) return response;
        void response.clone().json().then((data: unknown) => {
            const detail = buildSaveVersionEventDetail(data, accountName, isFullSaveRequest(input) ? "full-save" : "mutation");
            if (!detail) return;
            window.dispatchEvent(new CustomEvent(SAVE_VERSION_EVENT, { detail }));
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
export function getSocketAuth(): { token: string | null; name: string | null; password: string | null } {
    // Mirrors the HTTP interceptor, INCLUDING the no-token password fallback. This
    // returned a hard-coded `password: null`, so presence-socket's own
    // `if (!token && password)` branch was unreachable and realtime presence could
    // never connect when the server issues no tokens.
    return { token: getActiveToken(), name: getActivePlayer(), password: _memPassword };
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
        headers.has('x-admin-token') ||
        headers.has('x-kv-token')
    );
}

/**
 * Update the active session identity. Call:
 *   - after a successful login        → setActivePlayer(name, password)
 *   - after a successful registration → setActivePlayer(name, password)
 *   - on logout / clear               → setActivePlayer(null)
 *
 * `password` is retained IN MEMORY only (see `_memPassword`) and is used solely as
 * the credential when the server issues no session token. Callers that already hold
 * a token should pass `undefined`. Pass `null` for name to clear the identity.
 */
export function setActivePlayer(name: string | null, password?: string | null): void {
    // Outside the try: storage being unavailable must not stop the in-memory
    // credential from being set, or private-mode browsers lose the fallback too.
    _memPassword = name !== null && typeof password === 'string' && password.length > 0 ? password : null;
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
    // Cold start with a token that already died (>24h away, now that active play
    // slides the window). Restoring the session with it would 401 every call and
    // dump the player into the re-auth modal; dropping it instead lets the boot
    // path fall through to the normal login screen, which is both honest and one
    // fewer thing to dismiss. No credential is lost — an expired token could not
    // authenticate anything anyway.
    if (isActiveTokenExpired()) setActiveToken(null);
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

        // ── Admin credential (Phase 4) ───────────────────────────────────────
        // A signed admin session token supersedes the reusable password
        // EVERYWHERE. When a token is stored, ensure the plaintext admin password
        // never leaves the browser — even for the many call sites that manually
        // set x-admin-password — by swapping it for the token. Fall back to the
        // stored password only when there is no token (ADMIN_SESSION_SECRET unset
        // on the server, or a pre-token client).
        const adminToken = getAdminToken();
        if (adminToken) {
            if (newHeaders.has('x-admin-password')) newHeaders.delete('x-admin-password');
            newHeaders.set('x-admin-token', adminToken);
        } else {
            let adminPw: string | null = null;
            try {
                adminPw = sessionStorage.getItem('admin:pw');
            } catch {
                /* storage disabled */
            }
            if (adminPw && !newHeaders.has('x-admin-password')) {
                newHeaders.set('x-admin-password', adminPw);
            }
        }

        if (hasAuthHeader(init, input)) {
            // A caller supplied an auth credential (player token/password, kv
            // token, or a manual admin header we normalized above). The admin
            // credential is already resolved on newHeaders — attach nothing else.
            newInit.headers = newHeaders;
            const requestAccountName = newHeaders.get('x-player-name');
            return observeSaveVersion(adoptRefreshedToken(await originalFetch(input, newInit)), requestAccountName, input);
        }

        // We do NOT gate on admin here: if the operator is ALSO signed in as their
        // own player, attach the player token too (below) so player-only actions
        // (travel/combat/missions) work while admin mode is active. The server's
        // authedPlayerOrAdmin prefers the player identity when both are present.

        // Player auth: attach the session token when signed in.
        const activeName = getActivePlayer();
        const token = getActiveToken();
        if (activeName && token) {
            if (!newHeaders.has('x-player-name')) newHeaders.set('x-player-name', activeName);
            if (!newHeaders.has('x-player-token')) newHeaders.set('x-player-token', token);
        } else if (activeName && _memPassword) {
            // No token — the documented SESSION_SECRET-unset fallback. Without this
            // branch a token-less session carries NO credential and every
            // authenticated request 401s, which made login "succeed" into an unusable
            // account. The password is memory-only, so this lasts the tab's lifetime.
            if (!newHeaders.has('x-player-name')) newHeaders.set('x-player-name', activeName);
            if (!newHeaders.has('x-player-password')) newHeaders.set('x-player-password', _memPassword);
        }
        newInit.headers = newHeaders;
        const requestAccountName = newHeaders.get('x-player-name');

        const response = await originalFetch(input, newInit);

        // Sliding refresh: adopt a server-minted replacement token before doing
        // anything else, so a session that was about to lapse is already renewed
        // by the time the expiry check below runs. setActiveToken also re-arms
        // the one-shot expiry latch.
        adoptRefreshedToken(response);

        // A rejected session token requires a clean login. Only surface this when a
        // player token was actually sent — an admin-only request's 401 is not a
        // player session expiry. We intentionally do not persist a reusable
        // password merely to refresh tokens in-place.
        if (token && !isAuthEndpoint(input)) {
            if (response.status !== 401) {
                _consecutive401s = 0; // the session demonstrably still works
                _first401At = 0;
            } else {
                _consecutive401s += 1;
                if (_first401At === 0) _first401At = Date.now();
                // Both gates: enough failures AND long enough to rule out a blip.
                const sustained = Date.now() - _first401At >= TRANSIENT_401_GRACE_MS;
                if (isTokenExpired(token) || (_consecutive401s >= TRANSIENT_401_TOLERANCE && sustained)) {
                    notifySessionExpired();
                }
            }
        }
        return observeSaveVersion(response, requestAccountName, input);
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
