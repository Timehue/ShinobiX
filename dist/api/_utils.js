// Shared utilities for Vercel API functions
export function safeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
}
function recordId(value) {
    return value && typeof value === 'object' && 'id' in value
        ? String(value.id)
        : undefined;
}
function isImageField(key, value) {
    return (key === 'image' ||
        key === 'avatarImage' ||
        key === 'leftImage' ||
        key === 'rightImage') && typeof value === 'string';
}
export function mergePreservingImages(incoming, existing) {
    if (Array.isArray(incoming)) {
        return incoming.map((item, index) => {
            const existingArray = Array.isArray(existing) ? existing : [];
            const itemId = recordId(item);
            const existingById = itemId
                ? existingArray.find((c) => recordId(c) === itemId)
                : undefined;
            return mergePreservingImages(item, existingById ?? existingArray[index]);
        });
    }
    if (!incoming || typeof incoming !== 'object')
        return incoming;
    const inc = incoming;
    const ex = existing && typeof existing === 'object' ? existing : {};
    const merged = {};
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
export function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password');
}
