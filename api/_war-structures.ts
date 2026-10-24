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
import { preparationCost } from '../shared/war-preparations.js';
import {
    STRUCTURE_KEYS,
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
    watchtower: { key: 'watchtower', name: 'Watchtower', perLevel: 1, unit: 'mult', description: 'Attack alerts and +1 intel per tier on each player’s first successful daily Espionage order.' },
    barracks: { key: 'barracks', name: 'Barracks', perLevel: 10, unit: '%', description: '-10% temporary-building upkeep and -5% Combat sector mercenary hire costs per tier.' },
    warAcademy: { key: 'warAcademy', name: 'War Academy', perLevel: 10, unit: '%', description: '+10% raw supporting mission points per tier, within existing PvE and garrison caps.' },
    supplyDepot: { key: 'supplyDepot', name: 'Supply Depot', perLevel: 5, unit: 'wr', description: '+5 War Resources per village daily per level; increased material conversion capacity.' },
    treasuryVault: { key: 'treasuryVault', name: 'Treasury Vault', perLevel: 3, unit: 'mult', description: '-3% of the daily tax rate per level (softer tax).' },
};

// Watchtower, Barracks and Academy are purchased for a live declaration in
// _war-preparations.ts. Legacy Ramparts are retired; Depot and Vault are permanent.
export const PER_WAR_STRUCTURE_KEYS: readonly StructureKey[] = ['ramparts', 'watchtower', 'barracks', 'warAcademy'];
export function isPerWarStructure(key: string): key is 'ramparts' | 'watchtower' | 'barracks' | 'warAcademy' {
    return key === 'ramparts' || key === 'watchtower' || key === 'barracks' || key === 'warAcademy';
}

/** Three temporary tiers cost 40 / 80 / 120 WR. Purchase requires a live instance.
 *  Since the 2026-10 rebalance each tier also costs treasury ryo and Bone Charms
 *  per WR (shared/war-preparations.ts preparationTreasuryCost); this is the WR part. */
export function perWarStructureWrCost(level: number): number {
    return preparationCost(level);
}

/** Clear legacy village-wide temporary levels. Live preparations are bound to individual wars. */
export function resetPerWarStructures(record: VillageWarRecord): VillageWarRecord {
    if (!PER_WAR_STRUCTURE_KEYS.some(k => record.structures[k])) return record;
    return { ...record, structures: { ...record.structures, ramparts: 0, watchtower: 0, barracks: 0, warAcademy: 0 } };
}

export interface PerWarUpgradeResult {
    ok: boolean;
    error?: 'not-per-war' | 'retired-structure' | 'max-level' | 'insufficient-wr' | 'war-required';
    cost?: number;
    record?: VillageWarRecord;
    newLevel?: number;
}

/** Retired unbound purchase path. Use the locked instance purchase instead. */
export function applyPerWarStructureUpgrade(record: VillageWarRecord, key: string): PerWarUpgradeResult {
    if (!isPerWarStructure(key)) return { ok: false, error: 'not-per-war' };
    // Campaign victory uses points. Keep historical HP helpers readable, but
    // never charge for a new fortification whose effect cannot help win a war.
    if (key === 'ramparts') return { ok: false, error: 'retired-structure' };
    void record; return { ok: false, error: 'war-required' }; // Purchases must bind a live instance.

}

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

/** Village war HP cap after Ramparts. api/world-state.ts seals it into the war
 *  row (`hpMax`) at declaration and raises it when Ramparts is bought mid-war. */
export function villageWarHpMax(record: VillageWarRecord): number {
    return Math.round(BASE_VILLAGE_WAR_HP_MAX * (1 + STRUCTURE_DEFS.ramparts.perLevel / 100 * effectiveLevel(record, 'ramparts')));
}
/** The highest village war HP any village can have (max-level Ramparts). The
 *  war row's HP values are clamped to it on read. */
export const VILLAGE_WAR_HP_CEILING = Math.round(
    BASE_VILLAGE_WAR_HP_MAX * (1 + STRUCTURE_DEFS.ramparts.perLevel / 100 * VILLAGE_STRUCTURE_MAX_LEVEL),
);
/** Fixed human defensive points; historical village levels never multiply awards. */
export function defenderPointsMultiplier(record: VillageWarRecord): number {
    void record; return 1;
}
/** Multiplier on a mercenary's WR cost after Barracks (Phase 5 reads this). */
export function mercCostMultiplier(record: VillageWarRecord): number {
    void record; return 1; // The hire route supplies its exact war's Barracks tier.
}
/** Fixed human attacking points. Academy is consumed by supporting-operation scorers. */
export function sectorWarDamageMultiplier(record: VillageWarRecord): number {
    void record; return 1;
}
/** WR earned per controlled sector per day after Supply Depot (wired into the
 *  daily pass now). */
export function wrPerSector(record: VillageWarRecord): number {
    void record; return BASE_WR_PER_SECTOR;
}
/** Supply infrastructure supports recovery even when no sectors remain. */
export function depotDailyIncome(record: VillageWarRecord): number {
    return 5 * effectiveLevel(record, 'supplyDepot');
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
    // Ramparts/Watchtower are WR-funded per-war structures — never buyable with
    // treasury Honor Seals through this path (use applyPerWarStructureUpgrade).
    if (isPerWarStructure(key)) return { ok: false, error: 'unknown-structure' };
    const k = key as StructureKey;
    const cur = Math.max(0, Math.min(VILLAGE_STRUCTURE_MAX_LEVEL, Math.floor(Number(record.structures[k]) || 0)));
    if (cur >= VILLAGE_STRUCTURE_MAX_LEVEL) return { ok: false, error: 'max-level' };
    const cost = structureUpgradeCost(k, cur);
    const seals = Math.max(0, Math.floor(Number(availableSeals) || 0));
    if (seals < cost) return { ok: false, error: 'insufficient-seals', cost };
    const next: VillageWarRecord = { ...record, structures: { ...record.structures, [k]: cur + 1 } };
    return { ok: true, cost, record: next, nextSeals: seals - cost, newLevel: cur + 1 };
}
