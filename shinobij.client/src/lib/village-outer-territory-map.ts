import { sectorArtKey, VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";
import { sectorFloorImage, sectorFloorLayout } from "./sector-floor-layout";

/** Presentation board only; callers keep their existing gameplay sector. */
export function villageOuterTerritoryMapSector(villageName: string, virtualSector: number): number {
    return VILLAGE_OUTSKIRTS[villageName] ?? virtualSector;
}

/** Show the village compound to every visitor, independently of the virtual
 * sector retained by exploration and raid gameplay. */
export function villageOuterTerritoryMapUrl(villageName: string, virtualSector: number): string {
    const boardSector = villageOuterTerritoryMapSector(villageName, virtualSector);
    if (boardSector !== virtualSector) return sectorFloorImage(boardSector);
    if (sectorFloorLayout(virtualSector)) return sectorFloorImage(virtualSector);
    return `/sector-map/s${sectorArtKey(virtualSector)}.webp`;
}
