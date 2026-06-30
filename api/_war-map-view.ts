/*
 * Village War Map — the read-only view assembly for the client War-Map panel
 * (Phase 6, pure). Given a village's war record + its treasury seal balance + how
 * many sectors it currently holds, produce the display shape the UI needs: WR/seal
 * pools, structure levels + daily upkeep + dormancy, the Supply-Depot WR rate, the
 * effective tax tier, and each home sector's win-condition / terrain / Control-HP
 * cap. IO-free — the endpoint (api/village/war-map.ts) does the reads and the
 * territory/contest scans, then calls this per village.
 */

import {
    WR_POOL_CAP,
    taxRateForSectors,
} from './_war-economy.js';
import {
    STRUCTURE_KEYS,
    totalUpkeepWr,
    type StructureKey,
    type VillageWarRecord,
    type WinCondition,
    type Terrain,
} from './_war-state.js';
import {
    sectorControlHpMax,
    wrPerSector,
    taxRateMultiplier,
} from './_war-structures.js';
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
    /** Watchtower-boosted Control-HP cap (the "secure" value when uncontested). */
    controlHpMax: number;
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
    /** Effective daily tax rate (tier × Treasury-Vault softening), as a percentage. */
    taxRatePct: number;
    sectors: SectorConfigView[];
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
}): VillageWarMapView {
    const { village, record } = args;
    const treasurySeals = Math.max(0, Math.floor(Number(args.treasurySeals) || 0));
    const sectorsHeld = Math.max(0, Math.floor(Number(args.sectorsHeld) || 0));
    const biome = isWarVillage(village) ? VILLAGE_BIOME[village as WarVillage] : 'central';
    const home = homeSectorsForVillage(village);
    const controlHpMax = sectorControlHpMax(record);

    const sectors: SectorConfigView[] = home.map((s) => {
        const cfg = record.sectors[String(s)];
        return {
            sector: s,
            alias: sectorAlias(s),
            winCondition: cfg?.winCondition ?? 'combat',
            terrain: cfg?.terrain ?? (biome as Terrain),
            controlHpMax,
        };
    });

    const taxRatePct = round2(taxRateForSectors(sectorsHeld) * taxRateMultiplier(record) * 100);

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
        sectors,
    };
}

/** The structure keys, in display order, for the client (mirror of STRUCTURE_KEYS). */
export const WAR_MAP_STRUCTURE_KEYS: readonly StructureKey[] = STRUCTURE_KEYS;
