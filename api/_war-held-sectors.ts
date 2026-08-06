/*
 * Village War Map — the SERVER-AUTHORITATIVE "how many sectors does this village
 * actually hold right now" count.
 *
 * `world:territory:<sector>.ownerVillage` is the source of truth for sector
 * ownership (api/_sector-war.ts), and the sector-war engine flips it on capture.
 * Everything that scales with control — the daily WR/seal faucet, the comeback
 * discount on war/sector-war/mercenary costs, the tax tier — is supposed to read
 * that live count.
 *
 * Before this module those call sites used `homeSectorsForVillage(v).length`, the
 * STATIC 8-entry home table, as a Phase-1 placeholder. That made every village
 * permanently an 8-sector village: conquest paid nothing, being conquered to zero
 * cost nothing, and the 0-sectors-free / 1-sector-75%-off comeback brake could
 * never fire. This is the one place that count now comes from.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { kv } from './_storage.js';
import { setSafeRecordValue } from './_utils.js';
import { WAR_VILLAGES, homeSectorsForVillage } from './_war-map-sectors.js';

const TERRITORY_KEY_PREFIX = 'world:territory:';

/** Minimal store surface so the daily pass can inject its in-memory test store.
 *  Deliberately loose (`unknown[]`) so the live `kv` satisfies it structurally. */
export interface HeldSectorStore {
    keys(pattern: string): Promise<string[]>;
    mget(...keys: string[]): Promise<unknown[]>;
}

export type HeldSectorCounts = Record<string, number>;

/** Tally `ownerVillage` across territory records. Pure — the unit-testable core.
 *  Unowned / blank-owner sectors are simply not counted. */
export function tallyHeldSectors(territories: Iterable<{ ownerVillage?: unknown } | null | undefined>): HeldSectorCounts {
    const counts: HeldSectorCounts = {};
    for (const t of territories) {
        if (!t) continue;
        const owner = String(t.ownerVillage ?? '').trim();
        if (!owner) continue;
        setSafeRecordValue(counts, owner, (counts[owner] ?? 0) + 1);
    }
    return counts;
}

/** The home-sector baseline (every war village at its full home allocation). Used
 *  ONLY as the unseeded-world fallback below. */
export function homeSectorBaseline(): HeldSectorCounts {
    const counts: HeldSectorCounts = {};
    for (const v of WAR_VILLAGES) setSafeRecordValue(counts, v, homeSectorsForVillage(v).length);
    return counts;
}

/** True when no war village holds a single sector — i.e. `world:territory:*` has
 *  never been seeded with `ownerVillage` (the one-time admin launch step, see
 *  seedHomeSectorOwnership). A genuinely conquered world always has a positive
 *  total, because a captured sector just changes hands. */
export function looksUnseeded(counts: HeldSectorCounts): boolean {
    return WAR_VILLAGES.every((v) => (counts[v] ?? 0) <= 0);
}

/**
 * Live held-sector counts per village, read from the authoritative territory rows.
 *
 * FAIL-SAFE: if the territory table has never been seeded, every count would be 0
 * and the WR faucet would silently switch off world-wide (and every cost would go
 * free via the comeback discount). In that one case we fall back to the home-sector
 * baseline and warn, so an unseeded deploy degrades to the previous behaviour
 * instead of shutting the economy down.
 */
export async function loadHeldSectorCounts(store?: HeldSectorStore): Promise<HeldSectorCounts> {
    const src: HeldSectorStore = store ?? (kv as unknown as HeldSectorStore);
    try {
        const keys = await src.keys(`${TERRITORY_KEY_PREFIX}*`);
        const rows = keys.length ? await src.mget(...keys) : [];
        const counts = tallyHeldSectors(rows as ({ ownerVillage?: unknown } | null)[]);
        if (looksUnseeded(counts)) {
            console.warn('[village-war] world:territory:* has no ownerVillage set — falling back to the home-sector baseline. Run the admin sector-war "seed" action.');
            return homeSectorBaseline();
        }
        return counts;
    } catch (err) {
        console.error('[village-war] held-sector count failed; using the home-sector baseline:', (err as Error).message);
        return homeSectorBaseline();
    }
}

/** Held-sector count for ONE village, same fail-safe semantics as above. */
export async function heldSectorsForVillage(village: string, store?: HeldSectorStore): Promise<number> {
    const counts = await loadHeldSectorCounts(store);
    return counts[String(village).trim()] ?? 0;
}
