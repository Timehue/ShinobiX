/**
 * Admin-authored combat content — the jutsu AND item objects a fight needs from
 * the `save:admin1` / `save:admin2` slots, read once and memoized together.
 *
 * Why this exists: the server resolves a fighter's equipped loadout from ids
 * (`equippedJutsuIds`, `equipment`), and an id it cannot resolve is SILENTLY
 * DROPPED — the fighter simply enters the match without that jutsu or that piece
 * of gear. Both content types have a source the player's own save record cannot
 * be trusted to carry:
 *
 *   • jutsu — `creatorJutsus` is a SERVER_LEDGER_TOPLEVEL_FIELD (api/save/[name].ts),
 *     so a regular player's record NEVER holds authored jutsu at all.
 *   • items — `creatorItems` is NOT server-owned, so it IS on the player's record,
 *     but the save rule REPLACES it from the incoming POST rather than merging, so
 *     a stale client body can erase an authored definition while its id stays in
 *     `equipment`. Consulting the admin slots gives the resolver a server-side
 *     source that a client write cannot clobber.
 *
 * Reads both slots ONCE for both content types (60s memoized, in-flight deduped,
 * falling back to the last good read on a KV error), mirroring
 * api/shop/_catalog.ts loadSettlementCatalogs(). Load it BEFORE taking a save
 * lock — the lock must not be held across the admin reads.
 *
 * See api/_admin-jutsu-catalog.ts for the jutsu-only entry points (the training
 * endpoint needs just the id set); the jutsu catalog builder is shared, so the
 * two never disagree.
 */
import { kv } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { buildAdminJutsuCatalog, type AdminJutsu } from './_admin-jutsu-catalog.js';

const ADMIN_SAVE_KEYS = ['save:admin1', 'save:admin2'] as const;
const CACHE_TTL_MS = 60_000;
const MAX_ID_LENGTH = 120;

/** Sentinel `name` an admin-deleted item carries so the deletion propagates. */
export const ADMIN_DELETED_ITEM_MARKER = '__ADMIN_DELETED_ITEM__';

export type AdminItem = Record<string, unknown> & { id: string };
export type AdminCombatContent = {
    jutsu: ReadonlyMap<string, AdminJutsu>;
    items: ReadonlyMap<string, AdminItem>;
};

type AdminContentRecord = { creatorJutsus?: unknown; creatorItems?: unknown };

/**
 * Authored ITEM objects from both slots, keyed by id.
 *
 * Collisions resolve by slot order (the later slot wins) — the client merges
 * `creatorItems` with `mergeById`, which is plain last-wins, so slot order is the
 * faithful mirror here. (Jutsu differ: they use `mergeJutsusByRecency`, hence the
 * separate `updatedAt` rule in buildAdminJutsuCatalog.)
 *
 * A deletion marker removes the id and keeps it removed. Objects come back AS
 * AUTHORED — no clamping here; `buildItemLookup` applies the same
 * `budgetItemBonuses` pass to these as it does to a player's own creatorItems, so
 * authored gear is treated identically wherever it came from.
 */
export function buildAdminItemCatalog(records: readonly (AdminContentRecord | null | undefined)[]): Map<string, AdminItem> {
    const out = new Map<string, AdminItem>();
    const deleted = new Set<string>();
    for (const record of records) {
        const list = Array.isArray(record?.creatorItems) ? record.creatorItems as unknown[] : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > MAX_ID_LENGTH) continue;
            if (value.name === ADMIN_DELETED_ITEM_MARKER) {
                deleted.add(id);
                out.delete(id);
                continue;
            }
            if (deleted.has(id)) continue;
            out.set(id, { ...value, id } as AdminItem);
        }
    }
    return out;
}

let cache: { at: number; value: AdminCombatContent } | null = null;
let inflight: Promise<AdminCombatContent> | null = null;
const EMPTY: AdminCombatContent = { jutsu: new Map(), items: new Map() };

/**
 * The admin-authored jutsu + item objects a fight needs (60s memoized).
 * Never throws: a KV failure falls back to the last good read, or to empty maps,
 * which is exactly today's behaviour — so a storage hiccup can't fail a fight.
 */
export async function loadAdminCombatContent(): Promise<AdminCombatContent> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const records = await Promise.all(ADMIN_SAVE_KEYS.map((key) => kv.get<AdminContentRecord>(key)));
            const value: AdminCombatContent = {
                jutsu: buildAdminJutsuCatalog(records),
                items: buildAdminItemCatalog(records),
            };
            cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[admin-content]', safeLogValue(error));
            return cache?.value ?? EMPTY;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Test hook — drop the memo so a test can control what the next read returns. */
export function __resetAdminCombatContentCache(): void {
    cache = null;
    inflight = null;
}
