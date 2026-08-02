/**
 * Admin-authored ("creator") jutsu catalog — server-side.
 *
 * Custom jutsu written in the Admin Panel live ONLY on the `save:admin1` /
 * `save:admin2` slots. `creatorJutsus` is in SERVER_LEDGER_TOPLEVEL_FIELDS
 * (api/save/[name].ts), so a regular player's POST has its copy discarded and
 * replaced with the stored value — a normal player record therefore NEVER
 * carries authored jutsu, no matter what the client sends. The client hydrates
 * them separately (SHARED_ADMIN_CONTENT_FIELDS) and lists them next to the
 * built-ins.
 *
 * The consequence for the server: any handler that resolves or validates a
 * jutsu id against `record.creatorJutsus` misses every admin-authored jutsu,
 * because JUTSU_CATALOG (api/pvp/_jutsu-catalog.ts) only mirrors the BUILT-INS
 * from shinobij.client/src/data/jutsu.ts and cannot know authored content.
 * Read both admin slots through here instead.
 *
 * Reads are memoized for 60s (both slots together), mirroring how
 * api/shop/_catalog.ts loadSettlementCatalogs() serves items/cards from the same
 * two keys. Load it BEFORE taking a save lock — the lock should not be held
 * across the admin reads.
 */
import { kv } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { isDeletedJutsuEntry } from '../shared/admin-content-tombstone.js';
import { loadPublishedContent } from './_content-store.js';

const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const CACHE_TTL_MS = 60_000;
const MAX_ID_LENGTH = 120;

export type AdminJutsu = Record<string, unknown> & { id: string };
type AdminContentRecord = { creatorJutsus?: unknown };

const stamp = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Reproduce the client merge for authored jutsu: an id collision across the two
 * slots is resolved by `updatedAt` RECENCY, ties falling to the later slot —
 * exactly `mergeJutsusByRecency` in App.tsx, which the client applies over
 * Admin 1 then Admin 2. Slot order alone is NOT equivalent and would serve a
 * different jutsu than the player is looking at: `starter-universal-blitz` is
 * the edited "Overload" (ap 40, stamped updatedAt) on admin1 and a stale
 * "Blitz" (ap 60, no updatedAt) on admin2.
 *
 * The jutsu objects are returned AS AUTHORED — no rebalancing, no clamping of
 * balance fields (the client is explicit about this: "admin-saved values must be
 * preserved as-is"). Callers that feed combat still run them through their own
 * sanitizer (e.g. sanitizeJutsuList in api/pvp/session.ts).
 *
 * Exported for tests and for callers that already hold the admin records.
 */
export function buildAdminJutsuCatalog(records: readonly (AdminContentRecord | null | undefined)[]): Map<string, AdminJutsu> {
    // Resolve per id FIRST, then emit — so a deletion tombstone competes on
    // recency like any other entry and cannot be resurrected by a live copy
    // sitting in a later slot. (The item catalog deletes in-place instead,
    // which is exactly why a later slot CAN resurrect a deleted item there —
    // shared-content audit finding 6. Do not copy that shape here.)
    const best = new Map<string, { value: Record<string, unknown>; ts: number; deleted: boolean }>();
    for (const record of records) {
        const list = Array.isArray(record?.creatorJutsus) ? record.creatorJutsus as unknown[] : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > MAX_ID_LENGTH) continue;
            const ts = stamp(value.updatedAt);
            const held = best.get(id);
            // Ties fall to the later record, matching the previous behaviour.
            if (held && held.ts > ts) continue;
            best.set(id, { value, ts, deleted: isDeletedJutsuEntry(value) });
        }
    }
    const out = new Map<string, AdminJutsu>();
    for (const [id, entry] of best) {
        if (entry.deleted) continue; // the newest word on this id is "deleted"
        out.set(id, { ...entry.value, id } as AdminJutsu);
    }
    return out;
}

let cache: { at: number; value: Map<string, AdminJutsu> } | null = null;
let inflight: Promise<Map<string, AdminJutsu>> | null = null;

/**
 * The authored jutsu OBJECTS from both admin slots, keyed by id (60s memoized).
 * A KV failure never throws — it falls back to the last good read (or an empty
 * map), so a storage hiccup can't take a fight or a training start down with it.
 */
export async function loadAdminJutsuObjects(): Promise<ReadonlyMap<string, AdminJutsu>> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            // Dual-read (P0-4): the canonical content store joins the merge as
            // one more source, ordered LAST so it wins an updatedAt tie. It is
            // empty until something is published through
            // /api/admin/content-publish, so this is a no-op until then — and
            // once it is populated both publish paths keep it and the slots in
            // step, so the two agree anyway.
            const [slots, published] = await Promise.all([
                Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminContentRecord>(key))),
                loadPublishedContent().catch(() => ({}) as Record<string, unknown>),
            ]);
            const records = [...slots, published as AdminContentRecord];
            const value = buildAdminJutsuCatalog(records);
            cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[admin-jutsu-catalog]', safeLogValue(error));
            return cache?.value ?? new Map<string, AdminJutsu>();
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/**
 * Just the ids — for "does this jutsu exist / is it ownable" checks.
 * Ids come back exactly as authored; compare case-insensitively if the caller
 * normalizes the requested id (api/training/jutsu-ryo.ts lowercases it).
 */
export async function loadAdminJutsuIds(): Promise<ReadonlySet<string>> {
    return new Set((await loadAdminJutsuObjects()).keys());
}

/** Test hook — drop the memo so a test can control what the next read returns. */
export function __resetAdminJutsuCatalogCache(): void {
    cache = null;
    inflight = null;
}
