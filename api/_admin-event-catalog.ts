/*
 * Server-side dual-read catalog for admin-authored story/VN events.
 *
 * The client merges admin1, admin2, then canonical published content by id,
 * with the later source winning. Reproduce that ordering here so a server that
 * has to rebuild an AUTHORED encounter resolves the same event row the player
 * was reading. Same shape and cache policy as _admin-ai-catalog.ts.
 *
 * This exists because an authored pet encounter must never arrive as stats over
 * the wire: the client names WHICH authored encounter it is standing in, and
 * the server reads the opponent out of its own copy of the authored content.
 */
import { kv } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { loadPublishedContent } from './_content-store.js';

const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const CACHE_TTL_MS = 60_000;
const MAX_EVENTS = 2000;

export type AdminEvent = Record<string, unknown> & { id: string };
type AdminEventRecord = { creatorEvents?: unknown };

export function buildAdminEventCatalog(
    records: readonly (AdminEventRecord | null | undefined)[],
): Map<string, AdminEvent> {
    const out = new Map<string, AdminEvent>();
    for (const record of records) {
        const list = Array.isArray(record?.creatorEvents) ? record.creatorEvents : [];
        for (const raw of list.slice(0, MAX_EVENTS)) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(id)) continue;
            out.set(id, { ...value, id });
        }
    }
    return out;
}

let cache: { at: number; value: Map<string, AdminEvent> } | null = null;
let inflight: Promise<Map<string, AdminEvent>> | null = null;

export async function loadAdminEventObjects(): Promise<ReadonlyMap<string, AdminEvent>> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const [slots, published] = await Promise.all([
                Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminEventRecord>(key))),
                loadPublishedContent().catch(() => ({}) as Record<string, unknown>),
            ]);
            const value = buildAdminEventCatalog([...slots, published as AdminEventRecord]);
            cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[admin-event-catalog]', safeLogValue(error));
            return cache?.value ?? new Map<string, AdminEvent>();
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

export function __resetAdminEventCatalogCache(): void {
    cache = null;
    inflight = null;
}
