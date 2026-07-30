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

const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const CACHE_TTL_MS = 60_000;
const MAX_ID_LENGTH = 120;

export type AdminJutsu = Record<string, unknown> & { id: string };
type AdminContentRecord = { creatorJutsus?: unknown };

/**
 * Reproduce the client merge for authored jutsu: later slots win an id
 * collision (Admin 2 over Admin 1), same as the Map in App.tsx getAllJutsus.
 *
 * The jutsu objects are returned AS AUTHORED — no rebalancing, no clamping of
 * balance fields (the client is explicit about this: "admin-saved values must be
 * preserved as-is"). Callers that feed combat still run them through their own
 * sanitizer (e.g. sanitizeJutsuList in api/pvp/session.ts).
 *
 * Exported for tests and for callers that already hold the admin records.
 */
export function buildAdminJutsuCatalog(records: readonly (AdminContentRecord | null | undefined)[]): Map<string, AdminJutsu> {
    const out = new Map<string, AdminJutsu>();
    for (const record of records) {
        const list = Array.isArray(record?.creatorJutsus) ? record.creatorJutsus as unknown[] : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > MAX_ID_LENGTH) continue;
            out.set(id, { ...value, id } as AdminJutsu);
        }
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
            const records = await Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminContentRecord>(key)));
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
