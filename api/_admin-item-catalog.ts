/**
 * Admin-authored ("creator") ITEM catalog — server-side.
 *
 * The item twin of api/_admin-jutsu-catalog.ts. Custom items written in the Admin
 * Panel live on the `save:admin1` / `save:admin2` slots; the client hydrates them
 * as shared admin content and every player's own `creatorItems` array is only a
 * synced MIRROR of them (plus that player's own forged named weapons, minted by
 * api/craft/named.ts).
 *
 * That mirror is not a trustworthy definition source for the server:
 *   - it is client-written on the normal save path (`out.creatorItems =
 *     sanitizedCreatorItems` replaces rather than merges), so a stale POST can
 *     erase a definition whose id is still equipped;
 *   - under STRICT_RAW_SAVE_LEDGER=1 `creatorItems` becomes server-owned and a new
 *     player's array starts EMPTY, so an admin-authored item would never reach it.
 *
 * Either way the id resolves to nothing and the piece is silently dropped from the
 * fight (api/pvp/session.ts resolveEquippedPvpItems). Reading the admin slots here
 * gives the resolver an authoritative definition that does not depend on any
 * player's copy.
 *
 * Reads are memoized for 60s (both slots together), mirroring
 * api/_admin-jutsu-catalog.ts and api/shop/_catalog.ts loadSettlementCatalogs(),
 * which serve items/cards from these same two keys. Load it BEFORE taking a save
 * lock — the lock should not be held across the admin reads.
 */
import { kv } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { loadPublishedContent } from './_content-store.js';

const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const CACHE_TTL_MS = 60_000;
const MAX_ID_LENGTH = 120;
// Admin "delete" tombstone — same marker api/shop/_catalog.ts honors.
const ADMIN_DELETED_ITEM_MARKER = '__ADMIN_DELETED_ITEM__';
// Player-forged gear (api/craft/named.ts). KEEP IN SYNC with FORGED_ITEM_ID in
// api/save/[name].ts — the uuid is accepted with or without dashes because
// buildNamedItem strips them today but every forged item already stored predates
// that. Duplicated rather than imported to keep this module free of the save
// handler's import graph.
const FORGED_ITEM_ID = /^named-(weapon|armor)-[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type AdminItem = Record<string, unknown> & { id: string };
export type AdminItemCatalog = Map<string, AdminItem> & { readonly deletedIds: ReadonlySet<string> };
type AdminContentRecord = { creatorItems?: unknown };

/**
 * Reproduce the client merge for authored items: later slots win an id collision
 * (Admin 2 over Admin 1), and a tombstone entry removes the id.
 *
 * The item objects are returned AS AUTHORED, and they STAY that way: buildItemLookup
 * (api/pvp/_multipliers.ts) deliberately does not run budgetItemBonuses over admin
 * entries — owner-authored gear is meant to be able to exceed built-in items, and an
 * admin save already skips the save sanitizer. Only the DERIVED combat multipliers
 * are bounded (hydrateCharacterFromSave clamps itemDamagePct / absorb / reflect /
 * lifesteal / shield / armorRawDR regardless of source). A player's OWN creatorItems
 * are still budgeted — that array is client-written.
 *
 * Exported for tests and for callers that already hold the admin records.
 */
export function buildAdminItemCatalog(records: readonly (AdminContentRecord | null | undefined)[]): AdminItemCatalog {
    const deletedIds = new Set<string>();
    const out = new Map<string, AdminItem>() as AdminItemCatalog;
    Object.defineProperty(out, 'deletedIds', { value: deletedIds, enumerable: false });
    for (const record of records) {
        const list = Array.isArray(record?.creatorItems) ? record.creatorItems as unknown[] : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > MAX_ID_LENGTH) continue;
            // A player-forged piece is personal, never shared content. One that
            // leaked onto a slot must not become a definition the server hands
            // to other fighters — its real owner resolves it from their OWN
            // creatorItems, which this catalog never shadows.
            if (FORGED_ITEM_ID.test(id)) continue;
            if (value.name === ADMIN_DELETED_ITEM_MARKER) {
                deletedIds.add(id);
                out.delete(id);
                continue;
            }
            // Deletion is persistent across all dual-read sources. This matches
            // the shop catalog and prevents a stale later slot from resurrecting
            // content that an earlier authoritative source deleted.
            if (deletedIds.has(id)) continue;
            out.set(id, { ...value, id } as AdminItem);
        }
    }
    return out;
}

let cache: { at: number; value: Map<string, AdminItem> } | null = null;
let inflight: Promise<Map<string, AdminItem>> | null = null;

/**
 * The authored item OBJECTS from both admin slots, keyed by id (60s memoized).
 * A KV failure never throws — it falls back to the last good read (or an empty
 * map), so a storage hiccup can't take a fight down with it (the resolver then
 * behaves exactly as it did before this catalog existed).
 */
export async function loadAdminItemObjects(): Promise<ReadonlyMap<string, AdminItem>> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            // Dual-read (P0-4): the canonical content store is the LAST source,
            // matching this catalog's later-slot-wins rule (and its tombstone
            // handling — a published tombstone deletes exactly like a slot one).
            // Empty until the first publish, so this is a no-op until then.
            const [slots, published] = await Promise.all([
                Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminContentRecord>(key))),
                loadPublishedContent().catch(() => ({}) as Record<string, unknown>),
            ]);
            const records = [...slots, published as AdminContentRecord];
            const value = buildAdminItemCatalog(records);
            cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[admin-item-catalog]', safeLogValue(error));
            return cache?.value ?? new Map<string, AdminItem>();
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Test hook — drop the memo so a test can control what the next read returns. */
export function __resetAdminItemCatalogCache(): void {
    cache = null;
    inflight = null;
}
