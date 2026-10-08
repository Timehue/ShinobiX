/*
 * Village War Map — the SERVER-AUTHORITATIVE "how many WAR sectors does this
 * village hold right now" count, and the ONE definition of it.
 *
 * `world:territory:<sector>.ownerVillage` is the source of truth for sector
 * ownership (api/_sector-war.ts), and the sector-war engine flips it on capture.
 * Every war-economy consumer reads this count and nothing else: the daily WR and
 * seal faucet (api/_war-daily.ts), the War Map display (api/village/war-map.ts),
 * the occupation-tax tier (api/_war-tax-apply.ts), and the comeback discount on
 * sector-war, village-war and mercenary costs (api/village/sector-war.ts,
 * api/world-state.ts, api/village/war-merc.ts). So the count the War Map shows is
 * the count the faucet pays and the count every cost and the tax are charged on.
 *
 * A territory row counts for village V only when ALL of these hold:
 *   1. It is stored under one of the 32 home WAR sectors (isWarSector). The war
 *      economy is a curated 32-sector contest; the central keep, the special
 *      sectors and the wilderness are "not counted" (docs/village-war-map-economy-
 *      plan.md §4), whatever `ownerVillage` a clan capture or anything else
 *      stamped on them. Counting every row let those stamps raise WR income,
 *      seals, the tax tier and the comeback math. The sector is read from the
 *      row's KEY, the identity it is stored under, never from a field in it.
 *   2. Its `ownerVillage` is V.
 *   3. Its benefits are not suspended (a clan breach or verified clan inactivity,
 *      api/_territory-lifecycle.ts). The faucet has excluded those since
 *      2026-08-22; the other consumers now apply the same rule, because the War
 *      Map shows one number and it has to be the number that is paid.
 *
 * Before this module the call sites used `homeSectorsForVillage(v).length`, the
 * STATIC 8-entry home table, as a Phase-1 placeholder. That made every village
 * permanently an 8-sector village: conquest paid nothing, being conquered to zero
 * cost nothing, and the comeback discount could never fire.
 *
 * A FAILED territory scan is not a count: loadHeldSectorCounts throws, so the
 * daily pass skips the day and retries it, and a cost or a tax assessment fails
 * closed. It used to answer with the 8-sector baseline, which the daily pass then
 * paid and stamped. Only a genuinely unseeded table still reads as the baseline.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { kv } from './_storage.js';
import { setSafeRecordValue } from './_utils.js';
import { WAR_VILLAGES, homeSectorsForVillage, isWarSector } from './_war-map-sectors.js';
import { territoryRewardsSuspended } from './_territory-lifecycle.js';

const TERRITORY_KEY_PREFIX = 'world:territory:';
const TERRITORY_KEY_RE = /^world:territory:(\d+)$/;

/** Minimal store surface so the daily pass can inject its in-memory test store.
 *  Deliberately loose (`unknown[]`) so the live `kv` satisfies it structurally. */
export interface HeldSectorStore {
    keys(pattern: string): Promise<string[]>;
    mget(...keys: string[]): Promise<unknown[]>;
}

export type HeldSectorCounts = Record<string, number>;

/** A territory row together with the world sector it is stored under. */
export type HeldTerritoryRow = Record<string, unknown> & { sector?: unknown; ownerVillage?: unknown };

/** The world sector a `world:territory:<n>` key stores, or 0 for any other key. */
export function sectorFromTerritoryKey(key: string): number {
    const match = TERRITORY_KEY_RE.exec(String(key ?? ''));
    return match ? Number(match[1]) : 0;
}

/** The village a territory row counts toward as a HELD WAR SECTOR, or '' when it
 *  counts toward nobody — rules 1–3 in the header. `includeSuspended` drops rule 3;
 *  only the unseeded-table check uses it. Pure. */
export function heldWarSectorOwner(
    row: HeldTerritoryRow | null | undefined,
    now: number,
    options: { includeSuspended?: boolean } = {},
): string {
    if (!row) return '';
    if (!isWarSector(Number(row.sector))) return '';
    const owner = String(row.ownerVillage ?? '').trim();
    if (!owner) return '';
    if (!options.includeSuspended && territoryRewardsSuspended(row, now)) return '';
    return owner;
}

/** Tally held WAR sectors per village across territory rows that carry their
 *  `sector` (loadHeldSectorCounts stamps it from the row's key). Pure — the
 *  unit-testable core. Central, special and wilderness sectors, unowned rows and
 *  suspended rows are simply not counted. */
export function tallyHeldSectors(
    territories: Iterable<HeldTerritoryRow | null | undefined>,
    options: { now?: number; includeSuspended?: boolean } = {},
): HeldSectorCounts {
    const now = options.now ?? Date.now();
    const counts: HeldSectorCounts = {};
    for (const t of territories) {
        const owner = heldWarSectorOwner(t, now, options);
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

/** True when no war village holds a single WAR sector — i.e. the war sectors of
 *  `world:territory:*` have never been seeded with `ownerVillage` (the one-time
 *  admin launch step, see seedHomeSectorOwnership). A genuinely conquered world
 *  always has a positive total, because a captured sector just changes hands. */
export function looksUnseeded(counts: HeldSectorCounts): boolean {
    return WAR_VILLAGES.every((v) => (counts[v] ?? 0) <= 0);
}

/**
 * Live held WAR sector counts per village, read from the authoritative territory
 * rows under the one definition in the header.
 *
 * UNSEEDED FALLBACK: if the war sectors have never been seeded, every count would
 * be 0 and the WR faucet would silently switch off world-wide (and every cost
 * would go free via the comeback discount). In that one case we fall back to the
 * home-sector baseline and warn. Suspension is ignored for that check, so a world
 * whose sectors are all suspended still reads as seeded.
 *
 * A FAILED scan throws. It is not an unseeded table, and answering it with the
 * baseline let the daily pass pay and stamp a day on numbers nobody read.
 */
export async function loadHeldSectorCounts(
    store?: HeldSectorStore,
    options: { now?: number } = {},
): Promise<HeldSectorCounts> {
    return (await loadHeldSectors(store, options)).counts;
}

/** The territory rows, each stamped with the sector its key stores. */
async function scanTerritoryRows(store: HeldSectorStore): Promise<HeldTerritoryRow[]> {
    const keys = await store.keys(`${TERRITORY_KEY_PREFIX}*`);
    const rows = keys.length ? await store.mget(...keys) : [];
    const out: HeldTerritoryRow[] = [];
    keys.forEach((key, i) => {
        const row = rows[i];
        if (!row || typeof row !== 'object' || Array.isArray(row)) return;
        out.push({ ...(row as HeldTerritoryRow), sector: sectorFromTerritoryKey(key) });
    });
    return out;
}

/** Counts (loadHeldSectorCounts) and lists (loadHeldSectorLists) from ONE scan
 *  of the territory rows, for a caller that needs both. */
export async function loadHeldSectors(
    store?: HeldSectorStore,
    options: { now?: number } = {},
): Promise<{ counts: HeldSectorCounts; lists: HeldSectorLists }> {
    const src: HeldSectorStore = store ?? (kv as unknown as HeldSectorStore);
    const now = options.now ?? Date.now();
    const territories = await scanTerritoryRows(src);
    const unseeded = looksUnseeded(tallyHeldSectors(territories, { now, includeSuspended: true }));
    if (unseeded) {
        console.warn('[village-war] no war sector in world:territory:* has an ownerVillage — falling back to the home-sector baseline. Run the admin sector-war "seed" action.');
    }
    return {
        counts: unseeded ? homeSectorBaseline() : tallyHeldSectors(territories, { now }),
        lists: heldSectorListsOf(territories, now, unseeded),
    };
}

/** Held WAR sector count for ONE village, same rules (and the same throw on a
 *  failed scan) as loadHeldSectorCounts. */
export async function heldSectorsForVillage(village: string, store?: HeldSectorStore): Promise<number> {
    const counts = await loadHeldSectorCounts(store);
    return counts[String(village).trim()] ?? 0;
}

export type HeldSectorLists = Record<string, number[]>;

/**
 * WHICH war sectors each village holds right now: its own home sectors still in
 * its hands (home-table order), then the sectors it captured (ascending). These
 * are the sectors a village configures, win-condition and terrain, and the ones
 * the War Map lists under it: the current holder sets a sector's rules (owner
 * ruling 2026-10-08).
 *
 * Rules 1 and 2 of the header apply; rule 3 does not, because a suspension pauses
 * a sector's benefits, not who holds it. An unseeded world falls back to the home
 * table, as the counts do, and a failed scan throws.
 */
export async function loadHeldSectorLists(
    store?: HeldSectorStore,
    options: { now?: number } = {},
): Promise<HeldSectorLists> {
    return (await loadHeldSectors(store, options)).lists;
}

/** The pure core of loadHeldSectorLists over already-stamped territory rows. */
export function heldSectorListsOf(
    territories: Iterable<HeldTerritoryRow | null | undefined>,
    now: number,
    unseeded: boolean,
): HeldSectorLists {
    const held: Record<string, Set<number>> = {};
    for (const v of WAR_VILLAGES) setSafeRecordValue(held, v, new Set<number>());
    for (const row of territories) {
        const owner = heldWarSectorOwner(row, now, { includeSuspended: true });
        if (owner && Object.prototype.hasOwnProperty.call(held, owner)) held[owner].add(Number(row!.sector));
    }
    const lists: HeldSectorLists = {};
    for (const v of WAR_VILLAGES) {
        const home = homeSectorsForVillage(v);
        if (unseeded) {
            setSafeRecordValue(lists, v, [...home]);
            continue;
        }
        const captured = [...held[v]].filter((s) => !home.includes(s)).sort((a, b) => a - b);
        setSafeRecordValue(lists, v, [...home.filter((s) => held[v].has(s)), ...captured]);
    }
    return lists;
}

/** The war sectors ONE village holds, same rules as loadHeldSectorLists. */
export async function heldSectorListForVillage(village: string, store?: HeldSectorStore): Promise<number[]> {
    return (await loadHeldSectorLists(store))[String(village).trim()] ?? [];
}
