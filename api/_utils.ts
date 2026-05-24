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
    const merged: Record<string, unknown> = {};
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-kv-token');
}
