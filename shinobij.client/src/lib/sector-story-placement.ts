import { nearestWalkableTile } from "../../../shared/sector-walk-mask";
import { sectorFloorLayout } from "./sector-floor-layout";

const LEGACY_CAIRNS: Readonly<Record<string, { left: number; top: number }>> = {
    'sv-signal-cairn': { left: 50, top: 34 },
    'sv-rain-split-cairn': { left: 52, top: 39 },
};
export function sectorStoryPlacement(pointId: string, tile: number, sector?: number) {
    const layout = sector === undefined ? undefined : sectorFloorLayout(sector);
    const site = layout?.cairnId === pointId ? layout.sites.cairn : undefined;
    const cairn = Object.hasOwn(LEGACY_CAIRNS, pointId);
    const safe = sector === undefined ? tile : nearestWalkableTile(sector, tile);
    const at = site ?? (!layout && cairn ? LEGACY_CAIRNS[pointId] : {
        left: ((safe % 12) + .5) / 12 * 100, top: (Math.floor(safe / 12) + .5) / 12 * 100,
    });
    return { ...at, cairn, width: site?.width, authored: !!site, baked: !!site && !!layout?.bakedLandmarks };
}
