import { sectorArtKey } from "../../../shared/sector-geo";
import { sectorFloorImage, sectorFloorLayout } from "./sector-floor-layout";

const BESPOKE_OUTER_TERRITORY_MAPS: Readonly<Record<string, string>> = {
    "Stormveil Village": "/sector-map/stormveil-outskirts.webp",
    "Frostfang Village": "/sector-map/frostfang-outskirts.webp",
    "Moonshadow Village": "/sector-map/moonshadow-outskirts.webp",
};

/** Resolve the painted board for a village's outer-territory gameplay sector. */
export function villageOuterTerritoryMapUrl(villageName: string, virtualSector: number): string {
    if (sectorFloorLayout(virtualSector)) return sectorFloorImage(virtualSector);
    return BESPOKE_OUTER_TERRITORY_MAPS[villageName]
        ?? `/sector-map/s${sectorArtKey(virtualSector)}.webp`;
}
