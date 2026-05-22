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

const ACTIVE_PLAYER_KEY = 'shinobix:activePlayer';
const ACCOUNTS_KEY = 'ninjav-player-accounts-v1';

function getActivePlayer(): string | null {
    try {
        return sessionStorage.getItem(ACTIVE_PLAYER_KEY);
    } catch {
        return null;
    }
}

function getPasswordFor(name: string): string | null {
    try {
        const raw = localStorage.getItem(ACCOUNTS_KEY);
        if (!raw) return null;
        const accounts = JSON.parse(raw) as Record<string, { password?: string }>;
        const lookup = name.trim().toLowerCase();
        return accounts[lookup]?.password ?? null;
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

export function setActivePlayer(name: string | null): void {
    try {
        if (name) sessionStorage.setItem(ACTIVE_PLAYER_KEY, name);
        else sessionStorage.removeItem(ACTIVE_PLAYER_KEY);
    } catch {
        /* sessionStorage disabled — ignore */
    }
}

let installed = false;
export function installAuthFetch(): void {
    if (installed || typeof window === 'undefined' || !window.fetch) return;
    installed = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        if (!isApiUrl(input) || hasAuthHeader(init, input)) {
            return originalFetch(input, init);
        }
        const activeName = getActivePlayer();
        if (!activeName) return originalFetch(input, init);
        const pw = getPasswordFor(activeName);
        if (!pw) return originalFetch(input, init);

        // Clone init and merge headers without clobbering anything the caller set.
        const newInit: RequestInit = { ...(init ?? {}) };
        const newHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!newHeaders.has('x-player-name')) newHeaders.set('x-player-name', activeName);
        if (!newHeaders.has('x-player-password')) newHeaders.set('x-player-password', pw);
        newInit.headers = newHeaders;
        return originalFetch(input, newInit);
    };
}
