import { isPlayableWildSector, sectorBiomeOf, type SectorBiome } from './sector-geo.js';

export * from './gathering-materials.js';
import { COMMON_GATHER_IDS, BIOME_GATHER_IDS, type CommonGatherId } from './gathering-materials.js';

export type PendingGatherFind = { id: string; sector: number; biome: SectorBiome; rareTrace: boolean; at: number };
export type GatherChoice = { common: CommonGatherId; takeTrace: boolean };
export type GatherYield = { itemId: string; count: number }[];
export function isCommonGatherId(value: unknown): value is CommonGatherId {
    return COMMON_GATHER_IDS.includes(value as CommonGatherId);
}
export function validGatherFind(value: unknown): value is PendingGatherFind {
    if (!value || typeof value !== 'object') return false;
    const f = value as PendingGatherFind;
    return typeof f.id === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(f.id)
        && Number.isInteger(f.sector) && isPlayableWildSector(f.sector)
        && f.biome === sectorBiomeOf(f.sector) && typeof f.rareTrace === 'boolean'
        && Number.isFinite(f.at) && f.at > 0;
}
export function pendingGatherFinds(character: { pendingGatherFinds?: unknown }): PendingGatherFind[] {
    return Array.isArray(character.pendingGatherFinds) ? character.pendingGatherFinds.filter(validGatherFind) : [];
}
export function gatherYield(find: PendingGatherFind, choice: GatherChoice): GatherYield | null {
    if (!validGatherFind(find) || !isCommonGatherId(choice.common) || typeof choice.takeTrace !== 'boolean'
        || (choice.takeTrace && !find.rareTrace)) return null;
    return choice.takeTrace
        ? [{ itemId: choice.common, count: 2 }, { itemId: BIOME_GATHER_IDS[find.biome], count: 1 }]
        : [{ itemId: choice.common, count: 3 }];
}
