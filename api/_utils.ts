// Shared utilities for Vercel API functions

export function safeName(name: string) {
    return name.replace(/[^a-z0-9\-_]/g, '').toLowerCase();
}

function recordId(value: unknown) {
    return value && typeof value === 'object' && 'id' in value
        ? String((value as { id?: unknown }).id)
        : undefined;
}

function isImageField(key: string, value: unknown) {
    return (key === 'image' || key === 'avatarImage') && typeof value === 'string';
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

export function cors(res: { setHeader: (k: string, v: string) => void }) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
