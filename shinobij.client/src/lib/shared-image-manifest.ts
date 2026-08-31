/*
 * Shared-image manifest: ids in, per-image URLs out.
 *
 * `GET /api/images?cat=<cat>&ids=1&ver=1` answers with the category's image ids
 * plus a version counter. The version is what lets `/api/img` mark the bytes
 * `immutable` instead of revalidating every image every five minutes forever —
 * see api/_image-version.ts for the full reasoning and for why the counter is
 * per-category rather than per-image.
 *
 * Two response shapes are accepted on purpose. The endpoint answered with a bare
 * `string[]` for its whole life before versioning, and that response is cached at
 * the edge, so a client can still be handed the old shape after this ships. A
 * bare array simply yields unversioned URLs, which is exactly the behaviour that
 * preceded this module — no branch anywhere else has to care.
 */

export type ImageManifest = {
    /** Absent when the server could not read the counter, or on a legacy reply. */
    version?: string;
    ids: string[];
};

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/**
 * Normalize either manifest shape, or return null if the body is neither.
 *
 * Returning null (rather than an empty manifest) matters: the caller treats null
 * as a failed fetch and retries, while an empty manifest would be cached and the
 * category marked loaded — the "silently ran a whole session with missing art"
 * failure the `ids=1` mode was built to avoid.
 */
export function parseImageManifest(body: unknown): ImageManifest | null {
    if (Array.isArray(body)) {
        return { ids: body.filter(isNonEmptyString) };
    }
    if (body && typeof body === 'object') {
        const { version, ids } = body as { version?: unknown; ids?: unknown };
        if (!Array.isArray(ids)) return null;
        return {
            ids: ids.filter(isNonEmptyString),
            // Mirror the server's accepted shape (api/_image-version.ts). A
            // version the server would reject is dropped rather than forwarded:
            // it would produce a URL that silently falls back to the short TTL,
            // which is harmless but confusing to debug.
            ...(isNonEmptyString(version) && /^[0-9]{1,20}$/.test(version) ? { version } : {}),
        };
    }
    return null;
}

/** Per-image URL. With a version the server serves it immutable for a year. */
export function imageUrl(id: string, version?: string): string {
    const base = `/api/img?id=${encodeURIComponent(id)}`;
    return version ? `${base}&v=${encodeURIComponent(version)}` : base;
}

/** `{ id: url }` for every id in the manifest. */
export function imageEntries(manifest: ImageManifest): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const id of manifest.ids) entries[id] = imageUrl(id, manifest.version);
    return entries;
}
