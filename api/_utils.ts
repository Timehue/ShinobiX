// Shared utilities for Vercel API functions

export function safeName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
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

export function mergePreservingImages(incoming: unknown, existing: unknown): unknown {
    // Arrays: take the incoming sequence verbatim (preserving order +
    // intentional deletions), but per-item recurse so embedded images and
    // nested objects merge cleanly with the matching existing entry.
    if (Array.isArray(incoming)) {
        return incoming.map((item, index) => {
            const existingArray = Array.isArray(existing) ? existing : [];
            const itemId = recordId(item);
            const existingById = itemId
                ? existingArray.find((c: unknown) => recordId(c) === itemId)
                : undefined;
            return mergePreservingImages(item, existingById ?? existingArray[index]);
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
            ? mergePreservingImages(value, ex[key])
            : value;
    }
    return merged;
}

// Origins we trust to call our API. Anything not on this list won't get
// browser-side CORS approval — protects authenticated calls from XSRF via
// random sites.
const ALLOWED_ORIGINS = new Set([
    'https://theravensark.com',
    'https://www.theravensark.com',
    'https://test-five-delta-37.vercel.app',
    // Local dev — Vite default ports
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
]);

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
    if (origin && ALLOWED_ORIGINS.has(origin)) {
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-kv-token, x-client-fp');
}
