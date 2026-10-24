import { sectorFloorLayout } from "../lib/sector-floor-layout";
import { openBuildingCounter } from '../lib/sector-building-counter';

/** The existing town admission flow remains owned by WorldMap. */
export function SectorVillageEntrance({ sector, village, present, onEnter }: {
    sector: number; village: string; present: boolean; onEnter: (name: string) => void;
}) {
    const entrance = sectorFloorLayout(sector)?.village;
    if (!entrance) return null;
    const home = entrance.name === village;
    return <button type="button" className="sector-village-entrance"
        style={{ left: `${entrance.left}%`, top: `${entrance.top}%`, width: `${entrance.width}%` }}
        disabled={!present} onClick={() => openBuildingCounter({buildingId:`village-${sector}`,entrance:{sector,tile:entrance.approach},interior:home?()=>onEnter(entrance.name):undefined,interiorLabel:`Enter ${entrance.name}`,restriction:home?undefined:'The public gate counter receives travelers from every village. Entry beyond the gate is for village members.'})}
        aria-label={`Visit ${entrance.name} gate counter`}>
        <span className="sector-village-entrance-name">{entrance.name}</span>
        <span className="sector-village-entrance-action">Public counter</span>
    </button>;
}
