import { sectorArtKey } from "../../../shared/sector-geo";

const BESPOKE_OUTER_TERRITORY_MAPS: Readonly<Record<string, string>> = {
    "Stormveil Village": "/sector-map/stormveil-outskirts.webp",
    "Frostfang Village": "/sector-map/frostfang-outskirts.webp",
    "Moonshadow Village": "/sector-map/moonshadow-outskirts.webp",
};

/** Resolve the painted board for a village's outer-territory gameplay sector. */
export function villageOuterTerritoryMapUrl(villageName: string, virtualSector: number): string {
    return BESPOKE_OUTER_TERRITORY_MAPS[villageName]
        ?? `/sector-map/s${sectorArtKey(virtualSector)}.webp`;
}
