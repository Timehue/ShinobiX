import data from './sector-floor-layout-data.json';
/** Painting-keyed layouts. Only reviewed painting/mask pairs enter this registry. */
export type SectorSite = { left: number; top: number; width: number; approach: number; footprint: readonly number[] };
export type SectorFloorLayout = {
    sector: number; artKey: number; region: string; biome: string; name: string; mask: readonly string[];
    sites: { stronghold?: SectorSite; rift?: SectorSite; shrine?: SectorSite; cairn?: SectorSite };
    cairnId?: string;
    bakedLandmarks?: boolean;
    exits?: readonly { tile: number; direction: string; destination: number }[];
    hydrology?: { kind: string; waterTiles: readonly number[]; bridgeTiles: readonly number[] };
    village?: { name: string; left: number; top: number; width: number; approach: number };
};
export const SECTOR_FLOOR_LAYOUTS: Readonly<Record<number, SectorFloorLayout>> = data.layouts;
export const FLOOR_WALK_MASKS: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
    Object.entries(SECTOR_FLOOR_LAYOUTS).map(([art, layout]) => [art, layout.mask]));
export const FLOOR_ART_SHA256: Readonly<Record<number, string>> = data.floors;
export const LANDMARK_ART_SHA256: Readonly<Record<string, string>> = data.landmarks;
