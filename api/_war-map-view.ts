/*
 * Village War Map — the read-only view assembly for the client War-Map panel
 * (Phase 6, pure). Given a village's war record + its treasury seal balance + how
 * many sectors it currently holds, produce the display shape the UI needs: WR/seal
 * pools, structure levels + daily upkeep + dormancy, the Supply-Depot WR rate, the
 * effective tax tier, and the win-condition / terrain of each sector it holds.
 * IO-free — the endpoint (api/village/war-map.ts) does the reads and the
 * territory/contest scans, then calls this per village.
 */

import {
    WR_POOL_CAP,
    taxRateForSectors,
} from './_war-economy.js';
import {
    STRUCTURE_KEYS,
    sectorConfigFor,
    totalUpkeepWr,
    type StructureKey,
    type VillageWarRecord,
    type WinCondition,
    type Terrain,
} from './_war-state.js';
import {
    wrPerSector,
    taxRateMultiplier,
    effectiveLevel,
} from './_war-structures.js';
import { depotConversionCap, parseStoresLedger, STORES_LEDGER_VIEW_ROWS, type StoresLedgerEntry } from './_village-stores.js';
import {
    homeSectorsForVillage,
    sectorAlias,
    VILLAGE_BIOME,
    isWarVillage,
    type WarVillage,
} from './_war-map-sectors.js';

export interface SectorConfigView {
    sector: number;
    alias: string | undefined;
    winCondition: WinCondition;
    terrain: Terrain;
}

export interface VillageWarMapView {
    village: string;
    biome: string;
    homeSectors: number[];
    warResources: number;
    warResourcesCap: number;
    treasurySeals: number;
    structures: Record<StructureKey, number>;
    upkeepWr: number;
    dormant: boolean;
    wrPerSector: number;
    sectorsHeld: number;
    /** Effective daily tax rate (tier × Treasury-Vault softening), as a percentage.
     *  Forced to 0 while the village has no seated Kage — see `kageSeated`. */
    taxRatePct: number;
    /** Whether a player currently holds the Kage seat. No Kage → no tax. */
    kageSeated: boolean;
    /** The sectors this village HOLDS (home ones still in its hands, then those
     *  it captured), with the settings it chose for them: the current holder
     *  sets a sector's rules (owner ruling 2026-10-08). */
    sectors: SectorConfigView[];
    // ── Village Stores (api/_village-stores.ts) ──
    /** Rations in the treasury (treasury.provisions). */
    provisions: number;
    /** Craft points in the treasury (treasury.materialPoints). */
    materialPoints: number;
    /** Max WR the Supply Depot converts from materials per day (10 pts = 1 WR). */
    depotConversionCap: number;
    /** Last 10 stores ledger rows, oldest first. */
    storesLedger: StoresLedgerEntry[];
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Assemble one village's War-Map view from its (already-normalized) war record,
 *  treasury seal balance, and current held-sector count. Pure. */
export function villageWarMapView(args: {
    village: string;
    record: VillageWarRecord;
    treasurySeals: number;
    sectorsHeld: number;
    /** Whether the village has a seated Kage. Omitted = treated as seated, so
     *  existing callers keep their behaviour. */
    kageSeated?: boolean;
    /** Village Stores balances off the treasury (default 0). */
    provisions?: number;
    materialPoints?: number;
    /** The sectors the village holds (api/_war-held-sectors.ts
     *  loadHeldSectorLists). Omitted = its home sectors, the old view. */
    heldSectors?: readonly number[];
}): VillageWarMapView {
    const { village, record } = args;
    const treasurySeals = Math.max(0, Math.floor(Number(args.treasurySeals) || 0));
    const sectorsHeld = Math.max(0, Math.floor(Number(args.sectorsHeld) || 0));
    const biome = isWarVillage(village) ? VILLAGE_BIOME[village as WarVillage] : 'central';
    const home = homeSectorsForVillage(village);

    const sectors: SectorConfigView[] = (args.heldSectors ?? home).map((s) => {
        const cfg = sectorConfigFor(record, s);
        return {
            sector: s,
            alias: sectorAlias(s),
            winCondition: cfg.winCondition,
            terrain: cfg.terrain,
        };
    });

    // Mirror api/_war-tax-apply.ts exactly: no seated Kage forces the rate to zero,
    // so what the War Map DISPLAYS is always what a player is actually CHARGED.
    const kageSeated = args.kageSeated !== false;
    const taxRatePct = kageSeated
        ? round2(taxRateForSectors(sectorsHeld) * taxRateMultiplier(record) * 100)
        : 0;

    return {
        village,
        biome,
        homeSectors: [...home],
        warResources: record.warResources,
        warResourcesCap: WR_POOL_CAP,
        treasurySeals,
        structures: { ...record.structures } as Record<StructureKey, number>,
        upkeepWr: totalUpkeepWr(record),
        dormant: record.dormant,
        wrPerSector: round2(wrPerSector(record)),
        sectorsHeld,
        taxRatePct,
        kageSeated,
        sectors,
        provisions: Math.max(0, Math.floor(Number(args.provisions) || 0)),
        materialPoints: Math.max(0, Math.floor(Number(args.materialPoints) || 0)),
        depotConversionCap: depotConversionCap(effectiveLevel(record, 'supplyDepot')),
        storesLedger: parseStoresLedger(record.storesLedger).slice(-STORES_LEDGER_VIEW_ROWS),
    };
}

/**
 * What every player may see about ANOTHER village on the War Map: who it is,
 * where it stands, whether it has a Kage, and the rules of the sectors it holds
 * (an attacker must know what kind of battle a sector is). Its war chest,
 * treasury seals, structures, upkeep, dormancy, tax, stores and ledger are its
 * members' business (owner ruling 2026-10-09); other villages learn them only
 * through intel (api/village/intel.ts).
 */
export type VillageWarMapPublicView = Pick<VillageWarMapView, 'village' | 'biome' | 'homeSectors' | 'sectorsHeld' | 'kageSeated' | 'sectors'> & {
    /** Set on every view of a village that is not the viewer's own. */
    restricted: true;
};

/** The view a non-member gets of a village. Pure. */
export function publicVillageWarMapView(view: VillageWarMapView): VillageWarMapPublicView {
    return {
        village: view.village,
        biome: view.biome,
        homeSectors: [...view.homeSectors],
        sectorsHeld: view.sectorsHeld,
        kageSeated: view.kageSeated,
        sectors: view.sectors.map((sector) => ({ ...sector })),
        restricted: true,
    };
}

/** The structure keys, in display order, for the client (mirror of STRUCTURE_KEYS). */
export const WAR_MAP_STRUCTURE_KEYS: readonly StructureKey[] = STRUCTURE_KEYS;
