/*
 * Village War Map — the 6 village-level structures: definitions, upgrade cost,
 * effect magnitudes, and the pure upgrade transform (Phase 2). Plan §7.
 *
 * These are SHARED, Kage-upgraded buildings (distinct from the existing per-player
 * village upgrades in shinobij.client/src/lib/village-upgrades.ts, which are left
 * untouched). Upgrading costs Honor Seals from the village treasury; each level
 * carries daily WR upkeep (api/_war-state.ts totalUpkeepWr). When the village is
 * DORMANT (couldn't pay upkeep), every structure's bonus is suspended — the effect
 * helpers below return the no-bonus value via effectiveLevel().
 *
 * IO-free. Effect caps are small (≤ +15% at L10) to protect war/defense balance.
 * Some effects feed systems already built (Supply Depot → daily-pass WR income,
 * Treasury Vault → tax) and are wired now; others (war HP, sector Control HP,
 * merc cost, sector-war damage) are consumed by later phases and exposed here so
 * the wiring is mechanical when those systems land.
 */

import {
    VILLAGE_STRUCTURE_MAX_LEVEL,
} from './_war-economy.js';
import {
    STRUCTURE_KEYS,
    SECTOR_CONTROL_HP_MAX,
    type StructureKey,
    type VillageWarRecord,
} from './_war-state.js';

// Mirror of api/world-state.ts VILLAGE_WAR_HP_MAX (kept local to avoid importing
// that large module; Phase 3 reconciles when the war engine reads the boosted max).
const BASE_VILLAGE_WAR_HP_MAX = 5000;
const BASE_WR_PER_SECTOR = 25; // mirror of WR_PER_SECTOR_PER_DAY (§6.1)

export interface StructureDef {
    key: StructureKey;
    name: string;
    /** per-level magnitude (see `unit`) */
    perLevel: number;
    unit: '%' | 'wr' | 'mult';
    description: string;
}

// Per-level effect magnitudes. All bounded so L10 ≈ ±15% (or +5 WR/sector). §7.
export const STRUCTURE_DEFS: Record<StructureKey, StructureDef> = {
    ramparts: { key: 'ramparts', name: 'Ramparts', perLevel: 1.5, unit: '%', description: '+1.5% village war HP per level (raises the 5,000 cap).' },
    watchtower: { key: 'watchtower', name: 'Watchtower', perLevel: 1.5, unit: '%', description: '+1.5% sector Control HP per level (slower to capture).' },
    barracks: { key: 'barracks', name: 'Barracks', perLevel: 1.5, unit: '%', description: '-1.5% mercenary WR cost per level.' },
    warAcademy: { key: 'warAcademy', name: 'War Academy', perLevel: 1.5, unit: '%', description: '+1.5% sector-war damage per level.' },
    supplyDepot: { key: 'supplyDepot', name: 'Supply Depot', perLevel: 0.5, unit: 'wr', description: '+0.5 War Resources per controlled sector per level.' },
    treasuryVault: { key: 'treasuryVault', name: 'Treasury Vault', perLevel: 3, unit: 'mult', description: '-3% of the daily tax rate per level (softer tax).' },
};

/** Honor-Seal cost to raise a structure from `currentLevel` to `currentLevel+1`
 *  (0..9). Uniform across structures for v1 — `round(5·(level+1)^1.4)`: 5 at L0→1,
 *  rising to 126 at L9→10 (~587 cumulative to max one structure). Tunable. */
export function structureUpgradeCost(_key: StructureKey, currentLevel: number): number {
    const lvl = Math.max(0, Math.min(VILLAGE_STRUCTURE_MAX_LEVEL - 1, Math.floor(Number(currentLevel) || 0)));
    return Math.round(5 * Math.pow(lvl + 1, 1.4));
}

/** A structure's effective level: 0 when the village is dormant (bonuses
 *  suspended), otherwise its built level. */
export function effectiveLevel(record: VillageWarRecord, key: StructureKey): number {
    if (record.dormant) return 0;
    return Math.max(0, Math.min(VILLAGE_STRUCTURE_MAX_LEVEL, Math.floor(Number(record.structures[key]) || 0)));
}

// ── Effect helpers (each dormancy-aware via effectiveLevel) ──

/** Village war HP cap after Ramparts (Phase 3 war engine reads this). */
export function villageWarHpMax(record: VillageWarRecord): number {
    return Math.round(BASE_VILLAGE_WAR_HP_MAX * (1 + STRUCTURE_DEFS.ramparts.perLevel / 100 * effectiveLevel(record, 'ramparts')));
}
/** Sector Control HP cap after Watchtower (Phase 4 sector war reads this). */
export function sectorControlHpMax(record: VillageWarRecord): number {
    return Math.round(SECTOR_CONTROL_HP_MAX * (1 + STRUCTURE_DEFS.watchtower.perLevel / 100 * effectiveLevel(record, 'watchtower')));
}
/** Multiplier on a mercenary's WR cost after Barracks (Phase 5 reads this). */
export function mercCostMultiplier(record: VillageWarRecord): number {
    return Math.max(0, 1 - STRUCTURE_DEFS.barracks.perLevel / 100 * effectiveLevel(record, 'barracks'));
}
/** Multiplier on sector-war Control-HP damage after War Academy (Phase 4). */
export function sectorWarDamageMultiplier(record: VillageWarRecord): number {
    return 1 + STRUCTURE_DEFS.warAcademy.perLevel / 100 * effectiveLevel(record, 'warAcademy');
}
/** WR earned per controlled sector per day after Supply Depot (wired into the
 *  daily pass now). */
export function wrPerSector(record: VillageWarRecord): number {
    return BASE_WR_PER_SECTOR + STRUCTURE_DEFS.supplyDepot.perLevel * effectiveLevel(record, 'supplyDepot');
}
/** Multiplier on the daily tax rate after Treasury Vault (wired into the tax). */
export function taxRateMultiplier(record: VillageWarRecord): number {
    return Math.max(0, 1 - STRUCTURE_DEFS.treasuryVault.perLevel / 100 * effectiveLevel(record, 'treasuryVault'));
}

export interface StructureUpgradeResult {
    ok: boolean;
    error?: 'unknown-structure' | 'max-level' | 'insufficient-seals';
    cost?: number;
    record?: VillageWarRecord;
    nextSeals?: number;
    newLevel?: number;
}

/** Pure upgrade: validate the structure key, the max-level cap, and affordability
 *  against `availableSeals`; on success return the next record (level +1), the
 *  cost, and the remaining seals. Does NOT touch storage. */
export function applyStructureUpgrade(
    record: VillageWarRecord,
    availableSeals: number,
    key: string,
): StructureUpgradeResult {
    if (!(STRUCTURE_KEYS as readonly string[]).includes(key)) return { ok: false, error: 'unknown-structure' };
    const k = key as StructureKey;
    const cur = Math.max(0, Math.min(VILLAGE_STRUCTURE_MAX_LEVEL, Math.floor(Number(record.structures[k]) || 0)));
    if (cur >= VILLAGE_STRUCTURE_MAX_LEVEL) return { ok: false, error: 'max-level' };
    const cost = structureUpgradeCost(k, cur);
    const seals = Math.max(0, Math.floor(Number(availableSeals) || 0));
    if (seals < cost) return { ok: false, error: 'insufficient-seals', cost };
    const next: VillageWarRecord = { ...record, structures: { ...record.structures, [k]: cur + 1 } };
    return { ok: true, cost, record: next, nextSeals: seals - cost, newLevel: cur + 1 };
}
