// Shared utilities for Vercel API functions

// Max length for a player / clan-slug name. KV keys like `save:<name>`,
// `ratelimit:save:<name>:gains`, `presence:<name>`, etc. embed this string,
// so an unbounded length inflates every key the player touches. 32 chars
// covers any realistic display name; longer inputs are truncated rather
// than rejected so legacy code that hands raw user input here keeps working.
const SAFE_NAME_MAX_LEN = 32;
export function safeName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, SAFE_NAME_MAX_LEN);
}

// Canonical clan-record key derivation (audit #19). A clan's shared save lives
// at `save:clan-<bareSlug>` where bareSlug strips the display name down to
// [a-z0-9] only ("Storm Clan" → "stormclan"). Many call sites inline this rule;
// centralize it here so a new caller can't drift — e.g. pet-escort/offer.ts
// once derived a HYPHENATED slug ("storm-clan") and so silently failed to find
// any multi-word clan's record. Use clanRecordKey() for the full KV key.
export function clanBareSlug(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function clanRecordKey(name: string): string {
    return `save:clan-${clanBareSlug(name)}`;
}

function recordId(value: unknown) {
    return value && typeof value === 'object' && 'id' in value
        ? String((value as { id?: unknown }).id)
        : undefined;
}

function isImageField(key: string, value: unknown) {
    return (
        key === 'image' ||
        key === 'avatarImage' ||
        key === 'leftImage' ||
        key === 'rightImage'
    ) && typeof value === 'string';
}

// Object subtrees that must FULL-REPLACE rather than key-union-merge (audit
// 2026-06-26, root cause #3). The generic object merge below seeds `merged` from
// `existing`, so a key the client legitimately DELETED (an unequipped gear slot,
// a cleared pet loadout item) is absent from the incoming payload and gets
// silently re-injected from the stored record on reload — visibly "didn't save",
// and for weapons/armor a reload-triggered dupe (the item is also returned to
// inventory[]) that even feeds back into PvP combat hydration. For these keys we
// recurse with NO existing baseline, so the incoming object replaces the stored
// one verbatim (a missing inner key genuinely means "cleared"). Safe because the
// client always sends the COMPLETE current map for these, and foreign/public
// projections omit the key entirely (so this branch never fires for them — the
// partial-payload protection is preserved). Scalars cleared to undefined (e.g.
// activePetId) are handled client-side by sending `null` instead of omitting.
const REPLACE_SUBTREE_KEYS = new Set<string>(['equipment', 'loadout']);

export function mergePreservingImages(incoming: unknown, existing: unknown): unknown {
    // Arrays: take the incoming sequence verbatim (preserving order +
    // intentional deletions), but per-item recurse so embedded images and
    // nested objects merge cleanly with the matching existing entry.
    if (Array.isArray(incoming)) {
        const existingArray = Array.isArray(existing) ? existing : [];
        // Index existing items by id ONCE (first occurrence wins, matching the
        // previous .find() semantics) instead of an O(n) .find() per incoming
        // item — avoids O(n*m) on large id-bearing arrays (defeatedAiIds,
        // jutsuMastery, inventory). Items without an id fall back to positional
        // pairing, exactly as before.
        const existingById = new Map<string, unknown>();
        for (const c of existingArray) {
            const cid = recordId(c);
            if (cid && !existingById.has(cid)) existingById.set(cid, c);
        }
        return incoming.map((item, index) => {
            const itemId = recordId(item);
            const match = itemId ? existingById.get(itemId) : undefined;
            return mergePreservingImages(item, match ?? existingArray[index]);
        });
    }
    if (!incoming || typeof incoming !== 'object') return incoming;
    const inc = incoming as Record<string, unknown>;
    const ex = existing && typeof existing === 'object' ? existing as Record<string, unknown> : {};
    // Objects: start with `existing` so any field present on the stored
    // record but ABSENT from the incoming payload is preserved. The incoming
    // payload then overrides field-by-field. This defends against partial-
    // payload writes (e.g. a foreign-save fetch returning a public projection
    // of ~19 fields then being POSTed back, which used to silently wipe the
    // remaining ~30 fields of the recipient's save — inventory, pets,
    // jutsuMastery, equipment, stats, etc.). Players send their full state on
    // normal auto-save, so this change is a no-op there.
    const merged: Record<string, unknown> = { ...ex };
    for (const [key, value] of Object.entries(inc)) {
        if (isImageField(key, value) && value === '' && typeof ex[key] === 'string' && String(ex[key]).startsWith('data:image')) {
            merged[key] = ex[key];
            continue;
        }
        merged[key] = value && typeof value === 'object'
            ? mergePreservingImages(value, REPLACE_SUBTREE_KEYS.has(key) ? undefined : ex[key])
            : value;
    }
    return merged;
}

// Origins we trust to call our API. Anything not on this list won't get
// browser-side CORS approval — protects authenticated calls from XSRF via
// random sites.
//
// SINGLE SOURCE OF TRUTH for the CORS origin allowlist: server.ts (the Express
// global CORS middleware) and api/_realtime/socket.ts (Socket.IO cors) both
// import this exact array, so the three surfaces can no longer drift apart
// (CLAUDE.md: keep CORS in api/_utils.ts and server.ts synchronized).
export const ALLOWED_ORIGINS: readonly string[] = [
    // Player-facing site (Railway primary). Pinned here in code so the Socket.IO
    // handshake + any cross-origin call keep working even if EXTRA_ALLOWED_ORIGINS
    // is ever dropped/mistyped on a redeploy — realtime no longer depends on that
    // env var being set correctly.
    'https://shinobijourney.com',
    'https://www.shinobijourney.com',
    // cPanel backend tier (KV-proxy + image bulk storage; not front-facing).
    'https://theravensark.com',
    'https://www.theravensark.com',
    // Local dev — Vite default ports
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
];
// Operators can add the deployment's OWN origin without a code change via the
// EXTRA_ALLOWED_ORIGINS env var (comma-separated) — e.g. a Railway custom
// domain, or a transient preview URL during the migration. Every CORS surface
// (cors() here, the Express middleware in server.ts, and the Socket.IO layer in
// api/_realtime/socket.ts) routes through isAllowedOrigin(), so all three stay
// in lockstep (CLAUDE.md: keep CORS synchronized).
const EXTRA_ALLOWED_ORIGINS: readonly string[] = (process.env.EXTRA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const ALLOWED_ORIGIN_SET = new Set<string>([...ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);

// Railway gives every service a stable `<service>.up.railway.app` origin (and
// `<branch>-<service>.up.railway.app` for PR previews). Allow any HTTPS origin
// on that exact suffix so the API + Socket.IO handshake keep working when the
// app is reached at its Railway URL before a custom domain is attached. Matched
// on the PARSED hostname (not a substring) so a lookalike like
// `up.railway.app.attacker.com` can't slip through.
function isRailwayOrigin(origin: string): boolean {
    try {
        const u = new URL(origin);
        return u.protocol === 'https:' && (u.hostname === 'up.railway.app' || u.hostname.endsWith('.up.railway.app'));
    } catch {
        return false;
    }
}

// The single predicate every CORS surface uses to decide if an Origin is
// trusted. Exported so server.ts + socket.ts share the exact same logic.
export function isAllowedOrigin(origin: string | undefined | null): boolean {
    if (!origin) return false;
    return ALLOWED_ORIGIN_SET.has(origin) || isRailwayOrigin(origin);
}

export type JsonBodyResult =
    | { ok: true; body: unknown }
    | { ok: false; error: string };

export const MALFORMED_JSON_BODY_ERROR = 'Malformed JSON body.';

export function parseJsonBody(rawBody: unknown): JsonBodyResult {
    if (typeof rawBody !== 'string') {
        return { ok: true, body: rawBody ?? {} };
    }

    const trimmed = rawBody.trim();
    if (!trimmed) return { ok: true, body: {} };

    try {
        return { ok: true, body: JSON.parse(trimmed) as unknown };
    } catch {
        return { ok: false, error: MALFORMED_JSON_BODY_ERROR };
    }
}

export function isMalformedJsonBodyError(err: unknown, rawBody?: unknown): boolean {
    if (!(err instanceof SyntaxError)) return false;

    const details = err as SyntaxError & {
        body?: unknown;
        status?: unknown;
        statusCode?: unknown;
        type?: unknown;
    };

    if (details.type === 'entity.parse.failed') return true;
    if ((details.status === 400 || details.statusCode === 400) && typeof details.body === 'string') return true;

    // Vercel-style handlers can still receive an already-buffered string body
    // and parse it themselves. If that parse throws, it is client input, not a
    // server fault. Keep this narrow so unrelated server SyntaxErrors still
    // surface as 500s.
    return typeof rawBody === 'string' && /\bJSON\b/.test(err.message);
}

// Methods that browsers consider "safe" — these can't mutate state, so even
// a CSRF-style attack from a third-party page can't do damage. For these we
// allow the open '*' fallback when no Origin header is present.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function cors(
    res: { setHeader: (k: string, v: string) => void },
    req?: { headers?: Record<string, string | string[] | undefined>; method?: string },
): void {
    const originHeader = req?.headers?.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const method = (req?.method ?? 'GET').toUpperCase();
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin && SAFE_METHODS.has(method)) {
        // Same-origin / curl / server-to-server — no Origin header sent, and
        // the method itself is safe (cannot mutate state). Allowing '*' here
        // is fine. For unsafe methods with no Origin we default-deny by
        // omitting the ACAO header.
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    // If origin is set but not allowed, or method is unsafe without Origin:
    // no ACAO header is emitted. Browser blocks the request.
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-player-token, x-kv-token, x-client-fp');
}
