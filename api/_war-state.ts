/*
 * Village War Map — the per-village war-state record schema, defaults, and
 * normalizer (Phase 0, pure). Stored at `shared:village-war:<slug>` once wired:
 * the village's WR pool, its 6 structures, its 8 home sectors (each with a
 * win-condition, terrain, and Control HP), dormancy, mercenary leases, and the
 * daily-pass stamp. Plan §7, §8, §17.
 *
 * IO-free; nothing reads/writes this yet (villageWarMap.v1 OFF). The normalizer
 * is the load-bearing piece — it fills missing home sectors, clamps every value,
 * and enforces the max-7-per-win-condition diversity rule on read.
 */

import {
    VILLAGE_STRUCTURE_MAX_LEVEL,
    WR_POOL_CAP,
    structureMaintenanceWr,
    sectorBenefitWr,
    mercBandSize,
    MERC_BAND_MAX,
} from './_war-economy.js';
import {
    HOME_SECTORS,
    VILLAGE_BIOME,
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

export const SECTOR_CONTROL_HP_MAX = 600;          // §17.6
export const SECTOR_CONTROL_HP_PER_WIN = 150;      // attacker win → −150
export const SECTOR_CONTROL_HP_DEFENDER_REGEN = 50; // defender win → +50

export interface SectorWarState {
    winCondition: WinCondition;   // defender's chosen contest type
    terrain: Terrain;             // leader-set terrain (defaults to the biome)
    controlHp: number;            // 0..SECTOR_CONTROL_HP_MAX
}

export interface MercLease {
    tierId: string;
    player: string;     // hirer (safeName slug)
    expiresAt: number;  // epoch ms
    count: number;      // AI mercs still alive in the band (the player kills them down)
}

export interface VillageWarRecord {
    warResources: number;                       // village WR pool (0..WR_POOL_CAP)
    structures: Record<StructureKey, number>;   // level 0..MAX each
    sectors: Record<string, SectorWarState>;    // key = String(worldSectorNumber)
    mercLeases: MercLease[];
    dormant: boolean;                           // structures suspended (upkeep unpaid)
    lastWarPassDate: string;                    // 'YYYY-MM-DD' UTC daily-pass stamp
    terrainSetBy: Record<string, string>;       // sectorKey → player who set its terrain (§17.3 quota)
}

// Terrain-pick quota (§17.3): the Kage may set 3 sectors' terrain, each elder 1.
export const TERRAIN_QUOTA_KAGE = 3;
export const TERRAIN_QUOTA_ELDER = 1;
export type TerrainRole = 'kage' | 'elder' | 'none';

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

/** A fresh war-state for a village: empty WR, all structures L0, every home
 *  sector secure (full Control HP), biome terrain. Win-conditions default to a
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
            controlHp: SECTOR_CONTROL_HP_MAX,
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

    // Only the village's own home sectors are tracked; fill defaults, clamp present.
    if (raw.sectors && typeof raw.sectors === 'object') {
        for (const key of Object.keys(base.sectors)) {
            const r = (raw.sectors as Record<string, Partial<SectorWarState>>)[key];
            if (!r || typeof r !== 'object') continue;
            base.sectors[key] = {
                winCondition: asWinCondition(r.winCondition),
                terrain: asTerrain(r.terrain, base.sectors[key].terrain),
                controlHp: clampInt(r.controlHp, 0, SECTOR_CONTROL_HP_MAX),
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
            const dedupeKey = `${tierId}:${player}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            const count = clampInt((l as MercLease).count ?? mercBandSize(tierId), 0, MERC_BAND_MAX);
            base.mercLeases.push({ tierId, player, expiresAt, count });
        }
    }

    if (raw.terrainSetBy && typeof raw.terrainSetBy === 'object') {
        for (const key of Object.keys(base.sectors)) {
            const p = (raw.terrainSetBy as Record<string, unknown>)[key];
            if (typeof p === 'string' && p) base.terrainSetBy[key] = p;
        }
    }

    return base;
}

/** Count how many sectors use each win-condition. */
export function winConditionCounts(record: VillageWarRecord): Record<WinCondition, number> {
    const counts: Record<WinCondition, number> = { combat: 0, card: 0, pet: 0 };
    for (const s of Object.values(record.sectors)) counts[s.winCondition]++;
    return counts;
}

/** Whether `sector` may be (re)assigned to `wc` without breaking the max-7 rule.
 *  Re-assigning a sector already on `wc` is always allowed (no-op). */
export function canAssignWinCondition(record: VillageWarRecord, sector: number, wc: WinCondition): boolean {
    const cur = record.sectors[String(Math.floor(Number(sector) || 0))];
    if (!cur) return false;            // not a home sector of this village
    if (cur.winCondition === wc) return true;
    return winConditionCounts(record)[wc] < MAX_SECTORS_PER_WIN_CONDITION;
}

/** How many sectors' terrain a given player currently owns the pick for. */
export function terrainSetCountFor(record: VillageWarRecord, player: string): number {
    return Object.values(record.terrainSetBy).filter((p) => p === player).length;
}

/** Whether `player` (acting as `role`) may set `sector`'s terrain under the
 *  §17.3 quota: Kage 3 / elder 1. Re-setting a sector you already own is free; an
 *  elder cannot override a sector another leader picked; the Kage may override. */
export function canSetTerrain(
    record: VillageWarRecord, sector: number, player: string, role: TerrainRole,
): { ok: boolean; error?: 'not-authorized' | 'not-home-sector' | 'set-by-another' | 'quota-reached' } {
    if (role === 'none') return { ok: false, error: 'not-authorized' };
    const key = String(Math.floor(Number(sector) || 0));
    if (!record.sectors[key]) return { ok: false, error: 'not-home-sector' };
    const current = record.terrainSetBy[key];
    if (current && current !== player && role !== 'kage') return { ok: false, error: 'set-by-another' };
    const alreadyMine = current === player;
    const limit = role === 'kage' ? TERRAIN_QUOTA_KAGE : TERRAIN_QUOTA_ELDER;
    if (!alreadyMine && terrainSetCountFor(record, player) >= limit) return { ok: false, error: 'quota-reached' };
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
