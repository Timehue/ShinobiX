import { sectorArtKey } from "../../../shared/sector-geo";
import { SECTOR_FLOOR_LAYOUTS, FLOOR_ART_SHA256, LANDMARK_ART_SHA256 } from "../../../shared/sector-floor-layouts";
export function sectorFloorLayout(sector: number) { return SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)]; }
export function sectorSiteImage(sector: number, kind: "shrine" | "stronghold" | "rift") {
    const layout = sectorFloorLayout(sector);
    if (!layout) return undefined;
    const region = layout.biome === "volcano" ? "lavafront" : layout.region;
    const hash = LANDMARK_ART_SHA256[`${region}:${kind}`];
    return `/landmarks/sector-${region}-${kind}.webp${hash ? `?v=${hash.slice(0, 12)}` : ""}`;
}
export function sectorFloorImage(sector: number) {
    const key = sectorArtKey(sector), hash = FLOOR_ART_SHA256[key];
    return `/sector-map/s${key}.webp${hash ? `?v=${hash.slice(0, 12)}` : ""}`;
}
