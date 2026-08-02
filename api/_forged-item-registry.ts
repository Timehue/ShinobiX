/*
 * Durable registry for player-forged named gear (P0-3).
 *
 * A forged `named-weapon-*` / `named-armor-*` definition historically existed
 * in exactly one place: the owner's top-level `creatorItems` array — a
 * client-mirrored save field. Lose that entry (stale POST, historical data
 * loss) while the id stays in `character.equipment`, and the piece resolves to
 * nothing and is dropped from every fight (logged since de50b3385, but still
 * dropped). This is the named-weapon risk gating STRICT_RAW_SAVE_LEDGER=1.
 *
 * Fix: api/craft/named.ts now records every minted definition under its own
 * KV key (`forged-item:<id>`, no TTL — a forged item is permanent), and the
 * fighter-sealing entry points graft missing definitions back into the save
 * before hydration (`augmentSaveWithForgedDefs`). The save's own copy still
 * wins when present; the registry is a recovery source, not a new authority.
 *
 * Pre-existing forged items (minted before this landed) are not in the
 * registry until backfilled — the P1-4 live-data scanner is the planned
 * backfill (walk saves, record every FORGED_ITEM_ID definition found).
 */
import type { KvLike } from './_storage.js';
import { safeLogValue } from './_safe-log.js';

type RegistryKv = Pick<KvLike, 'get' | 'set'>;

async function getDefaultKv(): Promise<RegistryKv> {
    return (await import('./_storage.js')).kv;
}

// KEEP IN SYNC with FORGED_ITEM_ID in api/save/[name].ts. Duplicated (same as
// api/_admin-item-catalog.ts) to keep this module free of the save handler's
// import graph; the sync is pinned by _forged-item-registry.test.ts.
export const FORGED_ITEM_ID = /^named-(weapon|armor)-[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export const FORGED_ITEM_KEY_PREFIX = 'forged-item:';

export function forgedItemKey(id: string): string {
    return `${FORGED_ITEM_KEY_PREFIX}${id.toLowerCase()}`;
}

/** Mint-time write. Best-effort: the in-save copy is still written first. */
export async function recordForgedItem(item: Record<string, unknown>, opts: { kv?: RegistryKv } = {}): Promise<void> {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || !FORGED_ITEM_ID.test(id)) return;
    const store = opts.kv ?? await getDefaultKv();
    await store.set(forgedItemKey(id), item).catch((err) => {
        console.error('[forged-registry] record failed', safeLogValue(id), safeLogValue(err));
    });
}

/**
 * Return the save record with any equipped-but-missing forged definitions
 * grafted back into `creatorItems` from the registry. Returns the SAME record
 * when nothing is missing (the overwhelmingly common case — zero KV reads
 * beyond none; the scan is pure). Never throws: recovery must not stop a
 * fight from starting.
 */
export async function augmentSaveWithForgedDefs<T extends Record<string, unknown>>(save: T | null, opts: { kv?: RegistryKv } = {}): Promise<T | null> {
    if (!save) return save;
    try {
        const char = save.character as Record<string, unknown> | undefined;
        const equipment = char?.equipment;
        if (!equipment || typeof equipment !== 'object') return save;
        const equippedForged = [...new Set(
            Object.values(equipment as Record<string, unknown>)
                .filter((v): v is string => typeof v === 'string' && FORGED_ITEM_ID.test(v)),
        )];
        if (equippedForged.length === 0) return save;
        const creatorItems = Array.isArray(save.creatorItems) ? save.creatorItems as Array<Record<string, unknown>> : [];
        const present = new Set(creatorItems.map((it) => (it && typeof it === 'object' ? String(it.id ?? '').toLowerCase() : '')));
        const missing = equippedForged.filter((id) => !present.has(id.toLowerCase()));
        if (missing.length === 0) return save;
        const store = opts.kv ?? await getDefaultKv();
        const recovered = (await Promise.all(missing.map(async (id) => store.get<Record<string, unknown>>(forgedItemKey(id)).catch(() => null))))
            .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && typeof it.id === 'string');
        if (recovered.length === 0) {
            // Still unresolvable — the existing [pvp-items] warn fires downstream.
            return save;
        }
        console.warn(
            '[forged-registry] recovered equipped forged definition(s)',
            safeLogValue(char?.name),
            safeLogValue(recovered.map((it) => it.id).join(',')),
        );
        return { ...save, creatorItems: [...creatorItems, ...recovered] };
    } catch (err) {
        console.error('[forged-registry] augment failed', safeLogValue(err));
        return save;
    }
}
