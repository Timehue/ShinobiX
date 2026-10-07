import { sectorFloorLayout } from "../lib/sector-floor-layout";

/** The existing town admission flow remains owned by WorldMap. */
export function SectorVillageEntrance({ sector, village, present, onEnter }: {
    sector: number; village: string; present: boolean; onEnter: (name: string) => void;
}) {
    const entrance = sectorFloorLayout(sector)?.village;
    if (!entrance) return null;
    const home = entrance.name === village;
    return <button type="button" className="sector-village-entrance"
        style={{ left: `${entrance.left}%`, top: `${entrance.top}%`, width: `${entrance.width}%` }}
        disabled={!present || !home} onClick={() => onEnter(entrance.name)}
        aria-label={home ? `Enter ${entrance.name}` : `${entrance.name} — village members only`}>
        <span className="sector-village-entrance-name">{entrance.name}</span>
        <span className="sector-village-entrance-action">{home ? "Enter village" : "Members only"}</span>
    </button>;
}
