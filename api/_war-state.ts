/*
 * Village War Map — the per-village war-state record schema, defaults, and
 * normalizer (Phase 0, pure). Stored at `shared:village-war:<slug>` once wired:
 * the village's WR pool, its 6 structures, its 8 home sectors (each with a
 * win-condition and terrain), dormancy, mercenary leases, and the
 * daily-pass stamp. Plan §7, §8, §17.
 *
 * IO-free; nothing reads/writes this yet (villageWarMap.v1 OFF). The normalizer
 * is the load-bearing piece — it fills missing home sectors, clamps every value,
 * and enforces the max-7-per-win-condition diversity rule on read.
 */

import { leadershipNameKey } from '../shared/village-anbu.js';
import {
    VILLAGE_STRUCTURE_MAX_LEVEL,
    WR_POOL_CAP,
    structureMaintenanceWr,
    sectorBenefitWr,
    mercBandSize,
    MERC_BAND_MAX,
} from './_war-economy.js';
import { parseStoresLedger, type StoresLedgerEntry } from './_village-stores.js';
import {
    HOME_SECTORS,
    VILLAGE_BIOME,
    homeVillageForSector,
    isWarSector,
    isWarVillage,
    type WarVillage,
} from './_war-map-sectors.js';

export type WinCondition = 'combat' | 'card' | 'pet';
export const WIN_CONDITIONS: readonly WinCondition[] = ['combat', 'card', 'pet'];
/** Diversity rule (§17.2): no single win-condition on more than 7 of 8 sectors. */
export const MAX_SECTORS_PER_WIN_CONDITION = 7;

export type StructureKey =
    | 'ramparts' | 'watchtower' | 'barracks' | 'warAcademy' | 'supplyDepot' | 'treasuryVault';
export const STRUCTURE_KEYS: readonly StructureKey[] = [
    'ramparts', 'watchtower', 'barracks', 'warAcademy', 'supplyDepot', 'treasuryVault',
];

// Terrain = the 4 jutsu-school buff biomes + neutral central (matches the
// existing terrainBuffStat semantics in api/world-state.ts / world.ts).
export type Terrain = 'forest' | 'snow' | 'volcano' | 'shadow' | 'central';
export const TERRAINS: readonly Terrain[] = ['forest', 'snow', 'volcano', 'shadow', 'central'];

export interface SectorWarState {
    winCondition: WinCondition;   // defender's chosen contest type
    terrain: Terrain;             // leader-set terrain (defaults to the biome)
}

export interface MercLease {
    tierId: string;
    player: string;     // hirer (safeName slug)
    expiresAt: number;  // epoch ms
    count: number;      // AI mercs still alive in the band (the player kills them down)
    /** Set by the daily stores pass when the band went UNFED: api/_merc-auto.ts
     *  skips exactly one auto-deploy tick, then clears it. */
    skipNextAutoDeploy?: boolean;
    /** Band id (its hire's id) and the war it serves — always set together on a
     *  band hired since the redesign. A LEGACY band has neither: it keeps its
     *  (tierId, player) identity and fights only in village wars until it lapses. */
    id?: string;
    context?: MercLeaseContext;
}

/** The one war a hired band serves (owner redesign 2026-10-08): the band acts
 *  only there, and only while that exact war instance is live. */
export type MercLeaseContext =
    | { kind: 'village'; warId: string; generation: number }
    | { kind: 'sector'; contestId: string; instance: string; sector: number };

/** One War Map hire, kept while its war could still be live. The per-war hire
 *  allowances count these (a lease lapses after 2 days, a village war runs up
 *  to 14), and a retried request replays its receipt instead of paying twice. */
export interface MercHireReceipt {
    id: string;
    context: string;    // mercContextKey of the war it was hired for
    seat: string;       // the allowance it spent: 'kage' | 'elder-1..3'
    player: string;
    tierId: string;
    cost: number;
    at: number;
    expiresAt: number;
    keepUntil: number;
}
/** Hard backstop on stored hire receipts (newest kept). The hire route prunes
 *  receipts whose war is over and refuses — never evicts — before this fills. */
export const MERC_HIRE_RECEIPTS_MAX = 128;

export function mercContextKey(context: MercLeaseContext): string {
    return context.kind === 'village'
        ? `village:${context.warId}:g${context.generation}`
        : `sector:${context.contestId}:${context.instance}`;
}

function normalizeMercLeaseContext(raw: unknown): MercLeaseContext | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const c = raw as Record<string, unknown>;
    if (c.kind === 'village') {
        const warId = String(c.warId ?? '').trim();
        const generation = Math.floor(Number(c.generation));
        return warId && generation >= 1 ? { kind: 'village', warId, generation } : null;
    }
    if (c.kind === 'sector') {
        const contestId = String(c.contestId ?? '').trim();
        const instance = String(c.instance ?? '').trim();
        const sector = Math.floor(Number(c.sector));
        return contestId && instance && sector >= 1 ? { kind: 'sector', contestId, instance, sector } : null;
    }
    return null;
}

export interface VillageWarRecord {
    warResources: number;                       // village WR pool (0..WR_POOL_CAP)
    structures: Record<StructureKey, number>;   // level 0..MAX each
    sectors: Record<string, SectorWarState>;    // key = String(worldSectorNumber)
    mercLeases: MercLease[];
    mercHires?: MercHireReceipt[];              // War Map hire receipts (see MercHireReceipt)
    dormant: boolean;                           // structures suspended (upkeep unpaid)
    lastWarPassDate: string;                    // 'YYYY-MM-DD' UTC daily-pass stamp
    terrainSetBy: Record<string, string>;       // sectorKey → player who set its terrain (§17.3 quota)
    /** Non-evicting exact-once declaration debits, co-written with WR subtraction. */
    warDeclarationFundingReceipts?: Record<string, unknown>;
    /** Village Stores audit trail (api/_village-stores.ts), newest last, cap 30. */
    storesLedger?: StoresLedgerEntry[];
    /** Exact-once stores receipts (home-sector-loss burns): receiptId → epoch ms. */
    storesReceipts?: Record<string, number>;
    /** Home sectors this village held at the last stores pass — the diff against
     *  the live territory rows is how a HOME loss is detected and burned once. */
    storesHomeHeld?: number[];
}

// Terrain-pick quota (§17.3): the Kage may set 3 sectors' terrain, each elder 1.
export const TERRAIN_QUOTA_KAGE = 3;
export const TERRAIN_QUOTA_ELDER = 1;
export type TerrainRole = 'kage' | 'elder' | 'none';

/*
 * Stores-receipt retention.
 *
 * `storesReceipts` was the one stored structure in this record with no bound:
 * the daily pass stamps `home-loss:<sector>:<YYYY-MM-DD>` per home sector lost
 * and nothing ever removed one, so an 8-home-sector village accrued up to ~2,920
 * keys (~130 KB) a year — on a row the daily pass READS AND WRITES under two
 * nested locks, and that every war-map / intel read normalizes.
 *
 * A receipt exists solely to stop a second 25% provisions burn for the same
 * sector on the same DAY (api/_village-stores-daily.ts writes the key and checks
 * the identical key), so only the current day's entries are ever consulted. A
 * 7-day window is therefore an order of magnitude more than the semantics need,
 * while bounding the map at 8 sectors x 8 days = 64 entries (~2.5 KB).
 *
 * The window is measured from the NEWEST day stamped into the row itself, not
 * from a wall clock: the normalizer is pure and IO-free (see the file header),
 * and a clock-derived cutoff would silently expire a receipt on a paused or
 * back-dated village — reintroducing exactly the double-burn this guards. Being
 * data-relative keeps the bound regardless of how stale the row is.
 */
export const STORES_RECEIPT_RETENTION_DAYS = 7;
/** Hard backstop so a receipt kind with no day in its key can never grow without limit. */
export const STORES_RECEIPT_MAX_ENTRIES = 256;

/** The `YYYY-MM-DD` a receipt key ends in, or null when it carries no day. */
function storesReceiptDay(key: string): string | null {
    const m = /(\d{4}-\d{2}-\d{2})$/.exec(key);
    return m ? m[1] : null;
}

/** `YYYY-MM-DD` shifted by whole UTC days. ISO dates compare lexicographically. */
function shiftUtcDay(day: string, deltaDays: number): string {
    const ms = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(ms)) return day;
    return new Date(ms + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Clamp a raw receipts map: drop malformed entries, then drop anything more than
 * STORES_RECEIPT_RETENTION_DAYS older than the newest day present. Pure — no clock.
 * Entries whose key carries no day are kept (an unknown receipt kind must keep
 * working) but share the hard entry cap, newest-first by stamped timestamp.
 */
export function pruneStoresReceipts(raw: Record<string, unknown>): Record<string, number> {
    const entries: [string, number][] = [];
    for (const [k, v] of Object.entries(raw)) {
        if (typeof k === 'string' && k && Number(v) > 0) entries.push([k, Math.floor(Number(v))]);
    }
    let newestDay = '';
    for (const [k] of entries) {
        const day = storesReceiptDay(k);
        if (day && day > newestDay) newestDay = day;
    }
    const cutoff = newestDay ? shiftUtcDay(newestDay, -STORES_RECEIPT_RETENTION_DAYS) : '';
    let kept = entries.filter(([k]) => {
        const day = storesReceiptDay(k);
        return !day || !cutoff || day >= cutoff;
    });
    if (kept.length > STORES_RECEIPT_MAX_ENTRIES) {
        kept = [...kept].sort((a, b) => b[1] - a[1]).slice(0, STORES_RECEIPT_MAX_ENTRIES);
    }
    return Object.fromEntries(kept);
}

function clampInt(n: unknown, lo: number, hi: number): number {
    const v = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, v));
}

function asWinCondition(v: unknown): WinCondition {
    return (WIN_CONDITIONS as readonly string[]).includes(v as string) ? (v as WinCondition) : 'combat';
}
function asTerrain(v: unknown, fallback: Terrain): Terrain {
    return (TERRAINS as readonly string[]).includes(v as string) ? (v as Terrain) : fallback;
}

/** A fresh war-state for a village: empty WR, all structures L0, biome terrain. Win-conditions default to a
 *  valid, diverse spread that alternates Combat / Pet (4 each) — Pet's server
 *  sim is now wired (api/village/sector-pet), so it is a first-class default.
 *  Card remains a Kage-selectable option but is not a default. The max-7
 *  per-type diversity rule holds from the start. */
export function defaultVillageWarRecord(village: string): VillageWarRecord {
    const biome: Terrain = isWarVillage(village) ? VILLAGE_BIOME[village as WarVillage] : 'central';
    const structures = Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, 0])) as Record<StructureKey, number>;
    const sectors: Record<string, SectorWarState> = {};
    const home = HOME_SECTORS[village as WarVillage] ?? [];
    home.forEach((s, i) => {
        sectors[String(s)] = {
            winCondition: i % 2 === 0 ? 'combat' : 'pet',
            terrain: biome,
        };
    });
    return { warResources: 0, structures, sectors, mercLeases: [], dormant: false, lastWarPassDate: '', terrainSetBy: {} };
}

/** Normalize a raw record from storage: clamp every value into range, ensure all
 *  of the village's home sectors are present (filling any missing), drop unknown
 *  sectors/structures, and dedupe merc leases. Pure. */
export function normalizeVillageWarRecord(village: string, raw?: Partial<VillageWarRecord>): VillageWarRecord {
    const base = defaultVillageWarRecord(village);
    if (!raw || typeof raw !== 'object') return base;

    base.warResources = clampInt(raw.warResources, 0, WR_POOL_CAP);
    base.dormant = raw.dormant === true;
    base.lastWarPassDate = typeof raw.lastWarPassDate === 'string' ? raw.lastWarPassDate.slice(0, 10) : '';

    if (raw.structures && typeof raw.structures === 'object') {
        for (const k of STRUCTURE_KEYS) {
            base.structures[k] = clampInt((raw.structures as Record<string, unknown>)[k], 0, VILLAGE_STRUCTURE_MAX_LEVEL);
        }
    }

    // Home sectors are always present (defaults filled). A war sector the
    // village CAPTURED keeps its entry too: the current holder configures a
    // sector (owner ruling 2026-10-08), so its settings live in the holder's
    // record. Any other key is dropped.
    if (raw.sectors && typeof raw.sectors === 'object') {
        for (const [key, r] of Object.entries(raw.sectors as Record<string, Partial<SectorWarState>>)) {
            if (!r || typeof r !== 'object') continue;
            const home = Object.prototype.hasOwnProperty.call(base.sectors, key);
            const sector = Number(key);
            if (!home && (!Number.isSafeInteger(sector) || String(sector) !== key || !isWarSector(sector))) continue;
            base.sectors[key] = {
                winCondition: asWinCondition(r.winCondition),
                terrain: asTerrain(r.terrain, home ? base.sectors[key].terrain : landTerrainOf(sector)),
            };
        }
    }

    if (Array.isArray(raw.mercLeases)) {
        const seen = new Set<string>();
        for (const l of raw.mercLeases) {
            if (!l || typeof l !== 'object') continue;
            const tierId = String((l as MercLease).tierId ?? '');
            const player = String((l as MercLease).player ?? '');
            const expiresAt = Math.floor(Number((l as MercLease).expiresAt) || 0);
            if (!tierId || !player || expiresAt <= 0) continue;
            // A bound band carries its id and war together. A damaged binding is
            // dropped rather than read as a legacy band, which may fight in any
            // village war: it must never act outside the war it was hired for.
            const bound = (l as MercLease).id !== undefined || (l as MercLease).context !== undefined;
            const id = String((l as MercLease).id ?? '').trim().slice(0, 80);
            const context = normalizeMercLeaseContext((l as MercLease).context);
            if (bound && (!id || !context)) continue;
            const dedupeKey = bound ? `id:${id}` : `${tierId}:${player}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            const count = clampInt((l as MercLease).count ?? mercBandSize(tierId), 0, MERC_BAND_MAX);
            base.mercLeases.push({
                tierId, player, expiresAt, count,
                ...((l as MercLease).skipNextAutoDeploy === true ? { skipNextAutoDeploy: true } : {}),
                ...(bound && context ? { id, context } : {}),
            });
        }
    }
    if (Array.isArray(raw.mercHires)) {
        const hires: MercHireReceipt[] = [];
        const seenHires = new Set<string>();
        for (const h of raw.mercHires as unknown[]) {
            if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
            const r = h as Record<string, unknown>;
            const id = String(r.id ?? '').trim().slice(0, 80);
            const context = String(r.context ?? '').trim();
            const seat = String(r.seat ?? '').trim();
            const player = String(r.player ?? '').trim();
            const tierId = String(r.tierId ?? '').trim();
            const nums = [r.cost, r.at, r.expiresAt, r.keepUntil].map((v) => Math.max(0, Math.floor(Number(v) || 0)));
            if (!id || !context || !seat || !player || !tierId || seenHires.has(id) || nums[1] <= 0 || nums[3] <= 0) continue;
            seenHires.add(id);
            hires.push({ id, context, seat, player, tierId, cost: nums[0], at: nums[1], expiresAt: nums[2], keepUntil: nums[3] });
        }
        base.mercHires = hires.sort((a, b) => a.at - b.at).slice(-MERC_HIRE_RECEIPTS_MAX);
    }

    if (raw.terrainSetBy && typeof raw.terrainSetBy === 'object') {
        for (const key of Object.keys(base.sectors)) {
            const p = (raw.terrainSetBy as Record<string, unknown>)[key];
            if (typeof p === 'string' && p) base.terrainSetBy[key] = p;
        }
    }

    if (raw.warDeclarationFundingReceipts
        && typeof raw.warDeclarationFundingReceipts === 'object'
        && !Array.isArray(raw.warDeclarationFundingReceipts)) {
        base.warDeclarationFundingReceipts = { ...raw.warDeclarationFundingReceipts };
    }

    if (Array.isArray(raw.storesLedger)) base.storesLedger = parseStoresLedger(raw.storesLedger);
    if (raw.storesReceipts && typeof raw.storesReceipts === 'object' && !Array.isArray(raw.storesReceipts)) {
        // Pruned on read, so the daily pass persists the trimmed map (it spreads
        // `record.storesReceipts` forward). See pruneStoresReceipts above.
        base.storesReceipts = pruneStoresReceipts(raw.storesReceipts as Record<string, unknown>);
    }
    if (Array.isArray(raw.storesHomeHeld)) {
        base.storesHomeHeld = [...new Set(raw.storesHomeHeld.map((s) => Math.floor(Number(s) || 0)).filter((s) => s > 0))];
    }

    return base;
}

/** A war sector's own terrain: the biome of the village whose home it is. */
function landTerrainOf(sector: number): Terrain {
    const home = homeVillageForSector(sector);
    return home ? VILLAGE_BIOME[home] : 'central';
}

/**
 * A village's settings for `sector`: its stored entry, or the defaults (Combat,
 * the land's own biome) for a sector it captured and has not configured yet.
 * The HOLDER's settings are the ones a war on the sector uses (owner ruling
 * 2026-10-08). Pure.
 */
export function sectorConfigFor(record: VillageWarRecord, sector: number): SectorWarState {
    const key = String(Math.floor(Number(sector) || 0));
    return Object.prototype.hasOwnProperty.call(record.sectors, key)
        ? record.sectors[key]
        : { winCondition: 'combat', terrain: landTerrainOf(Number(key)) };
}

/** Count how many sectors use each win-condition: the sectors in `heldSectors`
 *  when given (what the max-7 rule counts), else every entry in the record. */
export function winConditionCounts(record: VillageWarRecord, heldSectors?: readonly number[]): Record<WinCondition, number> {
    const counts: Record<WinCondition, number> = { combat: 0, card: 0, pet: 0 };
    const configs = heldSectors ? heldSectors.map((s) => sectorConfigFor(record, s)) : Object.values(record.sectors);
    for (const s of configs) counts[s.winCondition]++;
    return counts;
}

/** Whether `sector` may be (re)assigned to `wc` without breaking the max-7 rule.
 *  Re-assigning a sector already on `wc` is always allowed (no-op).
 *
 *  With `heldSectors` (the sectors the village holds right now) the village may
 *  configure exactly those, home or captured, and the rule counts only them: a
 *  sector it lost is no longer its to set, and no longer counts. Without it,
 *  the record's own entries (its home sectors) are the scope, as before. */
export function canAssignWinCondition(record: VillageWarRecord, sector: number, wc: WinCondition, heldSectors?: readonly number[]): boolean {
    const s = Math.floor(Number(sector) || 0);
    if (heldSectors ? !heldSectors.includes(s) : !record.sectors[String(s)]) return false;
    if (sectorConfigFor(record, s).winCondition === wc) return true;
    return winConditionCounts(record, heldSectors)[wc] < MAX_SECTORS_PER_WIN_CONDITION;
}

/** How many sectors' terrain a given player currently owns the pick for. With
 *  `heldSectors`, only picks on sectors the village still holds count: a lost
 *  sector frees its pick. */
export function terrainSetCountFor(record: VillageWarRecord, player: string, heldSectors?: readonly number[]): number {
    return Object.entries(record.terrainSetBy)
        .filter(([sector, p]) => p === player && (!heldSectors || heldSectors.includes(Number(sector))))
        .length;
}

/** Keep terrain itself, but release offices held by former leaders. A demoted
 * Kage retains at most the current role's quota, in stable sector order. With
 * `heldSectors`, the pick on a sector the village no longer holds is released
 * too: a lost sector frees its pick (owner ruling 2026-10-08). */
export function reconcileTerrainLeadership(record: VillageWarRecord, kage: string, elders: string[], heldSectors?: readonly number[]): void {
    const leader = leadershipNameKey(kage);
    const council = new Set(elders.map(leadershipNameKey).filter(Boolean));
    const counts = new Map<string, number>();
    const assignments: Record<string, string> = {};
    for (const [sector, owner] of Object.entries(record.terrainSetBy).sort(([a], [b]) => Number(a) - Number(b))) {
        if (heldSectors && !heldSectors.includes(Number(sector))) continue;
        const name = leadershipNameKey(owner);
        const quota = name && name === leader ? TERRAIN_QUOTA_KAGE : council.has(name) ? TERRAIN_QUOTA_ELDER : 0;
        const used = counts.get(name) ?? 0;
        if (used >= quota) continue;
        assignments[sector] = name;
        counts.set(name, used + 1);
    }
    record.terrainSetBy = assignments;
}

/** Whether `player` (acting as `role`) may set `sector`'s terrain under the
 *  §17.3 quota: Kage 3 / elder 1. Re-setting a sector you already own is free; an
 *  elder cannot override a sector another leader picked; the Kage may override. */
export function canSetTerrain(
    record: VillageWarRecord, sector: number, player: string, role: TerrainRole, heldSectors?: readonly number[],
): { ok: boolean; error?: 'not-authorized' | 'not-home-sector' | 'set-by-another' | 'quota-reached' } {
    if (role === 'none') return { ok: false, error: 'not-authorized' };
    const s = Math.floor(Number(sector) || 0);
    const key = String(s);
    // With `heldSectors`, the village sets exactly the sectors it holds (see
    // canAssignWinCondition); the error keeps its old name for the callers.
    if (heldSectors ? !heldSectors.includes(s) : !record.sectors[key]) return { ok: false, error: 'not-home-sector' };
    const current = record.terrainSetBy[key];
    if (current && current !== player && role !== 'kage') return { ok: false, error: 'set-by-another' };
    const alreadyMine = current === player;
    const limit = role === 'kage' ? TERRAIN_QUOTA_KAGE : TERRAIN_QUOTA_ELDER;
    if (!alreadyMine && terrainSetCountFor(record, player, heldSectors) >= limit) return { ok: false, error: 'quota-reached' };
    return { ok: true };
}

/** Merc leases that have not yet expired at `now` (epoch ms). */
export function activeMercLeases(record: VillageWarRecord, now: number): MercLease[] {
    return record.mercLeases.filter((l) => l.expiresAt > now);
}

/** Total daily WR upkeep across the village's structures (raw, by level). */
export function totalUpkeepWr(record: VillageWarRecord): number {
    let sum = 0;
    for (const k of STRUCTURE_KEYS) sum += structureMaintenanceWr(record.structures[k]);
    return sum;
}

// ── Storage key ──
/** Slug used for the war-state key (matches the village-treasury slug shape). */
export function villageWarSlug(village: string): string {
    return String(village).toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function villageWarKey(village: string): string {
    return `shared:village-war:${villageWarSlug(village)}`;
}

// ── Daily pass (pure step) ── §8.1
export interface DailyPassSummary {
    ran: boolean;             // false → already ran today (idempotent no-op)
    wrAccrued: number;        // WR added from sectors (before cap)
    maintenanceOwed: number;  // raw daily upkeep
    maintenancePaid: number;  // WR actually spent on upkeep (0 if mothballed)
    dormant: boolean;         // structures mothballed (couldn't afford full upkeep)
    mercsExpired: number;     // leases pruned this pass
    sectorsControlled: number;
}

/** Pure one-day step for a village's war state (§8.1): accrue WR for the sectors
 *  it currently holds (capped), pay structure upkeep if affordable — else mothball
 *  the structures (dormant, no cost, no bonus, WR retained to recover) — expire
 *  merc leases, and stamp the day. Idempotent: a same-day re-run is a no-op.
 *  `sectorsControlled` is supplied by the caller (Phase 1 = home count; later it
 *  includes captures/occupation). */
export function stepVillageWarDay(
    record: VillageWarRecord,
    opts: { sectorsControlled: number; today: string; now: number; wrPerSector?: number },
): { record: VillageWarRecord; summary: DailyPassSummary } {
    const sectors = Math.max(0, Math.floor(Number(opts.sectorsControlled) || 0));
    const idle: DailyPassSummary = {
        ran: false, wrAccrued: 0, maintenanceOwed: totalUpkeepWr(record), maintenancePaid: 0,
        dormant: record.dormant, mercsExpired: 0, sectorsControlled: sectors,
    };
    if (record.lastWarPassDate === opts.today) return { record, summary: idle };

    const next: VillageWarRecord = {
        ...record,
        structures: { ...record.structures },
        sectors: { ...record.sectors },
        mercLeases: [...record.mercLeases],
    };

    // WR income: caller may pass a Supply-Depot-boosted per-sector rate
    // (api/_war-structures.ts wrPerSector); default is the flat §6.1 rate.
    const perSector = Number(opts.wrPerSector);
    const wrAccrued = Number.isFinite(perSector)
        ? Math.floor(Math.max(0, perSector) * sectors)
        : sectorBenefitWr(sectors);
    let pool = Math.min(WR_POOL_CAP, next.warResources + wrAccrued);

    const owed = totalUpkeepWr(next);
    let paid = 0;
    let dormant = false;
    if (owed > 0) {
        if (pool >= owed) { pool -= owed; paid = owed; }
        else { dormant = true; }   // mothballed: keep WR, suspend bonuses until affordable
    }
    next.warResources = pool;
    next.dormant = dormant;

    const before = next.mercLeases.length;
    next.mercLeases = activeMercLeases(next, opts.now);
    const mercsExpired = before - next.mercLeases.length;

    next.lastWarPassDate = opts.today;
    return {
        record: next,
        summary: { ran: true, wrAccrued, maintenanceOwed: owed, maintenancePaid: paid, dormant, mercsExpired, sectorsControlled: sectors },
    };
}
