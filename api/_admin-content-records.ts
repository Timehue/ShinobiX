import { kv } from './_storage.js';
import { loadPublishedContent } from './_content-store.js';

type ContentRecord = Record<string, unknown>;
let inflight: Promise<(ContentRecord | null)[]> | null = null;

/** Share only concurrent reads; each catalog retains its existing freshness policy. */
export function loadAdminContentRecords(): Promise<(ContentRecord | null)[]> {
    if (inflight) return inflight;
    inflight = Promise.all([
        kv.mget<ContentRecord[]>('save:admin1', 'save:admin2'),
        loadPublishedContent().catch(() => ({})),
    ]).then(([slots, published]) => [...slots, published]).finally(() => { inflight = null; });
    return inflight;
}
