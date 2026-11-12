import { sectorFloorLayout } from "../lib/sector-floor-layout";
import { openBuildingCounter } from '../lib/sector-building-counter';
import { isNpcVillage } from "../../../shared/npc-village";

/** The existing town admission flow remains owned by WorldMap. */
export function SectorVillageEntrance({ sector, village, present, onEnter }: {
    sector: number; village: string; present: boolean; onEnter: (name: string) => void;
}) {
    const layout = sectorFloorLayout(sector), entrance = layout?.village;
    if (!layout || !entrance) return null;
    const home = entrance.name === village;
    // Cinderhold is run by its own shinobi and is nobody's home. It has no
    // village raid (its shinobi are fought in the field and in sector and
    // village wars), so its gate opens the public counter only.
    const closed = isNpcVillage(entrance.name);
    const footprint = layout.mask.flatMap((row, y) => [...row].flatMap((cell, x) => cell === 'B' ? [y * 12 + x] : [])).join(' ');
    return <button type="button" className="sector-village-entrance"
        data-footprint={footprint}
        style={{ left: `${entrance.left}%`, top: `${entrance.top}%`, width: `${entrance.width}%` }}
        disabled={!present} onClick={() => closed
            ? openBuildingCounter({buildingId:`village-${sector}`,entrance:{sector,tile:entrance.approach},restriction:`${entrance.name} admits no outsiders.`})
            : home
            ? openBuildingCounter({buildingId:`village-${sector}`,entrance:{sector,tile:entrance.approach},interior:()=>onEnter(entrance.name),interiorLabel:`Enter ${entrance.name}`})
            : onEnter(entrance.name)}
        aria-label={closed || home ? `Visit ${entrance.name} gate counter` : `View ${entrance.name} raid options`}>
        <span className="sector-village-entrance-name">{entrance.name}</span>
        <span className="sector-village-entrance-action">{closed ? 'Gate counter' : home ? 'Public counter' : 'Raid village'}</span>
    </button>;
}
